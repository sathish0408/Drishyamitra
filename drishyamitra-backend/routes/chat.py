"""
Chat Blueprint
===============
AI Assistant endpoint with Groq tool calling and LangGraph agent workflow.

Endpoints:
    POST /api/chat
"""

import json
import logging
import os

from flask import Blueprint, request, jsonify, current_app, g

from database.db import db
from models.photo import Photo
from models.person import Person
from models.album import Album
from models.face import Face
from models.sharing import DeliveryHistory
from models.log import AgentLog
from utils.auth_helpers import token_required

logger = logging.getLogger(__name__)
bp = Blueprint("chat", __name__, url_prefix="/api/chat")

# ── System prompt matching the frontend CHAT_SYSTEM constant ──────────────
SYSTEM_PROMPT = (
    "You are the Drishyamitra Help Guide, a knowledgeable, hyper-focused assistant dedicated exclusively to helping "
    "users understand, navigate, and operate the Drishyamitra photo management application. Maintain a warm, clear, "
    "and helpful tone. Keep your responses clean, step-by-step, easy-to-understand, and under 120 words.\n"
    "\n"
    "Application features and step-by-step operations you must know:\n"
    "1. Dashboard (Home): Contains the Search Bar, AI suggestions chips, recent photo grid, Smart Categories (Favorites, "
    "Places & Scenes, Group Photos), and the People row displaying unrecognized and recognized face thumbnails.\n"
    "2. Photos (Gallery): Lists your photos. Features include:\n"
    "   - Horizontal tabs to filter by 'All Photos', 'Favourites', 'Birthdays', 'Weddings', 'Anniversaries', or custom albums.\n"
    "   - Grid/Masonry view toggle, '+ Upload' button to upload new images.\n"
    "   - 'Select' mode to perform bulk operations: delete selected photos or assign a label/name to recognized persons.\n"
    "3. People Page: Lists 'Recognized People' and 'Unrecognized Faces'. Click on any unrecognized card to type a name and "
    "assign/merge it. Click 'Run Face Clustering' to trigger the DBSCAN background face clustering pipeline.\n"
    "4. AI Chat: Type questions to search photos semantically, create albums, or trigger sharing flows.\n"
    "5. Sharing & Delivery Page: Packages photos, person albums, or smart albums and sends them via email (SMTP) or WhatsApp "
    "automation. Toggle tabs to choose between Person, Album, or Photos.\n"
    "6. Navigation: Double-click any photo card to open it. Swipe through photos using on-screen Left/Right arrows or "
    "simply press physical Keyboard Left and Right arrow keys.\n"
    "7. Library Backup: Click 'Backup Library' in the sidebar to download a complete ZIP backup of all photos and metadata.\n"
    "8. Storage & Analytics: Check the progress bar in the sidebar for storage usage. Click it to open a modal with detailed charts.\n"
    "\n"
    "Resilience to Informal Grammar / Intent Interpretation:\n"
    "- If the user uses broken English, slang, or short phrasing (e.g., 'how can i delete', 'tell swipe processing', "
    "'where backup library', 'why email not work'), immediately interpret their core intent (e.g., photo deletion, photo navigation, "
    "ZIP backup, SMTP email sharing troubleshooting) and respond with flawless, crystal-clear, step-by-step English instructions.\n"
    "\n"
    "Real-time Counts Tool Calling Rules:\n"
    "- If the user asks for counts (e.g., 'how many total photos', 'you tell me the count', 'how many people', or counts of deliveries), "
    "you MUST call the 'get_system_counts' tool to retrieve the exact integer directly from the database, and reply with the real count in a friendly manner. "
    "Never tell them to check the tabs or count them manually.\n"
    "\n"
    "Strict Gallery Filter Rules:\n"
    "- If the user asks to see or show photos of a specific person (e.g., 'show sathish photos', 'show photos of Priya'), "
    "you MUST append this exact JSON action block at the end of your response:\n"
    "```json\n"
    "{\n"
    "  \"message\": \"I found X photos of NAME. Opening their gallery for you now!\",\n"
    "  \"action\": \"FILTER_GALLERY_BY_LABEL\",\n"
    "  \"target_label\": \"NAME\"\n"
    "}\n"
    "```\n"
    "Where NAME is the exact name of the person (in lowercase or exact match, e.g. 'sathish', 'priya') and X is the photo count.\n"
    "\n"
    "Strict Sandbox Guardrails:\n"
    "CRITICAL RULE: You must act EXCLUSIVELY as a dedicated technical support guide for the Drishyamitra application. "
    "If the user asks about topics completely unrelated to Drishyamitra (e.g., general programming/coding assistance, "
    "trivia, recipe requests, calculations), you MUST strictly and politely refuse with this exact phrase: "
    "\"I am your Drishyamitra AI assistant. I can only assist you with operations, file sharing, and navigation queries within this application.\""
)

# ── Tool definitions for Groq function calling ────────────────────────────
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_system_counts",
            "description": "Get real-time total counts of photos, recognized people, and delivery logs in the user's library.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_photos",
            "description": "Search photos by text query — person name, event, date, or description.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query text",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_person",
            "description": "Get details about a recognised person and the photos they appear in.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The person's name to look up",
                    }
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_album",
            "description": "Create a new photo album.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Album name",
                    },
                    "description": {
                        "type": "string",
                        "description": "Album description",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analytics_summary",
            "description": "Get a summary of analytics: total photos, people, storage, accuracy.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
]


# ── Tool execution functions ──────────────────────────────────────────────

def _tool_search_photos(query, user_id=None):
    """Execute search_photos tool."""
    results = []

    q_clean = query.lower().strip()
    is_all_photos = False
    if q_clean in ["all", "photos", "pictures", "images", "all photos", "all pictures", "show photos", "show all photos", "show all the photos", "show photos all", "show pictures", "get photos", "list photos", "view photos", "all the photos"]:
        is_all_photos = True
    elif any(phrase in q_clean for phrase in ["all photos", "all pictures", "show all", "list all", "view all", "all of my photos"]):
        is_all_photos = True

    if is_all_photos:
        photos = Photo.query.filter_by(user_id=user_id).all()
        for p in photos:
            face_names = []
            for face in p.faces:
                if face.person_id:
                    person = Person.query.get(face.person_id)
                    if person and person.name and person.name not in face_names:
                        face_names.append(person.name)
            results.append({"id": p.id, "name": p.filename, "date": p.date, "persons": face_names})
        return {"count": len(results), "photos": results[:100]}

    # Check for group query
    if "group" in q_clean:
        photos = Photo.query.filter_by(user_id=user_id).all()
        # Find photos with more than 1 face detected
        group_photos = [p for p in photos if len(p.faces) > 1]
        group_photos.sort(key=lambda p: p.date or "", reverse=True)
        for p in group_photos:
            face_names = []
            for face in p.faces:
                if face.person_id:
                    person = Person.query.get(face.person_id)
                    if person and person.name and person.name not in face_names:
                        face_names.append(person.name)
            results.append({"id": p.id, "name": p.filename, "date": p.date, "persons": face_names})
        return {"count": len(results), "photos": results[:100]}

    # Check for multiple matched person names cross-referencing
    all_persons = Person.query.filter_by(user_id=user_id).all()
    matched_persons = []
    import re
    for p in all_persons:
        if re.search(r'\b' + re.escape(p.name.lower()) + r'\b', q_clean):
            matched_persons.append(p)

    if len(matched_persons) > 1:
        photo_sets = []
        for person in matched_persons:
            p_ids = {f.photo_id for f in person.faces if f.photo_id}
            photo_sets.append(p_ids)
        
        common_photo_ids = list(set.intersection(*photo_sets)) if photo_sets else []
        if common_photo_ids:
            photos = Photo.query.filter(Photo.id.in_(common_photo_ids), Photo.user_id == user_id).all()
            for p in photos:
                face_names = []
                for face in p.faces:
                    if face.person_id:
                        person = Person.query.get(face.person_id)
                        if person and person.name and person.name not in face_names:
                            face_names.append(person.name)
                results.append({"id": p.id, "name": p.filename, "date": p.date, "persons": face_names})
            return {"count": len(results), "photos": results[:100]}

    # Structured: single person name
    persons = Person.query.filter(Person.user_id == user_id, Person.name.ilike(f"%{query}%")).all()
    for person in persons:
        photo_ids = list({f.photo_id for f in person.faces})
        photos = Photo.query.filter(Photo.id.in_(photo_ids), Photo.user_id == user_id).all() if photo_ids else []
        for p in photos:
            results.append({"id": p.id, "name": p.filename, "date": p.date, "persons": [person.name]})

    # Structured: description / location
    db_photos = Photo.query.filter(
        Photo.user_id == user_id,
        db.or_(
            Photo.description.ilike(f"%{query}%"),
            Photo.location.ilike(f"%{query}%"),
            Photo.filename.ilike(f"%{query}%"),
        )
    ).limit(10).all()
    seen_ids = {r["id"] for r in results}
    for p in db_photos:
        if p.id not in seen_ids:
            results.append({"id": p.id, "name": p.filename, "date": p.date})

    # Semantic search
    try:
        from services.vector_service import VectorService
        vector_ids = VectorService.search_photos(query, limit=10)
        for vid in vector_ids:
            if vid not in seen_ids:
                photo = Photo.query.filter_by(id=vid, user_id=user_id).first()
                if photo:
                    results.append({"id": photo.id, "name": photo.filename, "date": photo.date})
    except Exception:
        pass

    return {"count": len(results), "photos": results[:15]}


def _tool_get_person(name, user_id=None):
    """Execute get_person tool."""
    person = Person.query.filter(Person.user_id == user_id, Person.name.ilike(f"%{name}%")).first()
    if not person:
        return {"error": f"No person found matching '{name}'"}

    photo_ids = list({f.photo_id for f in person.faces})
    photos = Photo.query.filter(Photo.id.in_(photo_ids), Photo.user_id == user_id).all()
    photo_ids = [p.id for p in photos]
    return {
        "id": person.id,
        "name": person.name,
        "photoCount": person.photo_count,
        "tags": person.tags or [],
        "photos": photo_ids[:20],
    }


def _tool_create_album(name, description="", user_id=None):
    """Execute create_album tool."""
    existing = Album.query.filter(Album.user_id == user_id, db.func.lower(Album.name) == name.lower()).first()
    if existing:
        return {"message": f'Album "{name}" already exists', "id": existing.id}

    album = Album(name=name, description=description, user_id=user_id)
    db.session.add(album)
    db.session.commit()
    return {"message": f'Album "{name}" created', "id": album.id}


def _tool_share_photos(person_name, recipient, platform, user_id=None):
    """Execute share_photos tool."""
    try:
        from services.sharing_service import SharingService

        person = Person.query.filter(Person.user_id == user_id, Person.name.ilike(f"%{person_name}%")).first()
        if not person:
            return {"error": f"No person found matching '{person_name}'"}

        photo_ids = list({f.photo_id for f in person.faces})
        photos = Photo.query.filter(Photo.id.in_(photo_ids), Photo.user_id == user_id).all() if photo_ids else []
        photo_paths = [p.file_path for p in photos]

        if platform == "whatsapp":
            result = SharingService.send_whatsapp(recipient, person.name, photo_paths, user_id=user_id)
        else:
            result = SharingService.send_email(recipient, person.name, photo_paths, user_id=user_id)

        return {
            "message": f"Sent {len(photo_paths)} photos of {person.name} to {recipient} via {platform}",
            "delivery": result,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_analytics_summary(user_id=None):
    """Execute analytics_summary tool."""
    total_photos = Photo.query.filter_by(user_id=user_id).count()
    total_people = Person.query.filter_by(user_id=user_id).count()
    total_faces = Face.query.join(Face.photo).filter(Photo.user_id == user_id).count()
    unrecognised = Face.query.join(Face.photo).filter(Photo.user_id == user_id, Face.person_id.is_(None)).count()
    recognised = total_faces - unrecognised
    accuracy = round((recognised / total_faces * 100), 1) if total_faces else 0
    deliveries = DeliveryHistory.query.filter_by(user_id=user_id).count()

    return {
        "total_photos": total_photos,
        "total_people": total_people,
        "faces_detected": total_faces,
        "recognised": recognised,
        "unrecognised": unrecognised,
        "accuracy": f"{accuracy}%",
        "deliveries_sent": deliveries,
    }


def _tool_get_system_counts(user_id=None):
    """Query the database for real-time counts of photos, people, and deliveries."""
    total_photos = Photo.query.filter_by(user_id=user_id).count()
    total_people = Person.query.filter_by(user_id=user_id).count()
    total_deliveries = DeliveryHistory.query.filter_by(user_id=user_id).count()
    return {
        "total_photos": total_photos,
        "total_people": total_people,
        "total_deliveries": total_deliveries
    }


TOOL_HANDLERS = {
    "get_system_counts": lambda args, user_id: _tool_get_system_counts(user_id=user_id),
    "search_photos": lambda args, user_id: _tool_search_photos(args.get("query", ""), user_id=user_id),
    "get_person": lambda args, user_id: _tool_get_person(args.get("name", ""), user_id=user_id),
    "create_album": lambda args, user_id: _tool_create_album(args.get("name", ""), args.get("description", ""), user_id=user_id),
    "analytics_summary": lambda args, user_id: _tool_analytics_summary(user_id=user_id),
}


def _resolve_entities(photo_ids, person_ids, album_id, user_id):
    import os
    photos = []
    persons = []
    album = None

    if photo_ids:
        seen = set()
        p_ids = []
        for pid in photo_ids:
            if pid not in seen:
                seen.add(pid)
                p_ids.append(pid)
        photo_objs = Photo.query.filter(Photo.id.in_(p_ids), Photo.user_id == user_id).all()
        id_order = {pid: idx for idx, pid in enumerate(p_ids)}
        photo_objs.sort(key=lambda p: id_order.get(p.id, 999))
        photos = [p.to_dict() for p in photo_objs]

    if person_ids:
        seen_pe = set()
        pe_ids = []
        for peid in person_ids:
            if peid not in seen_pe:
                seen_pe.add(peid)
                pe_ids.append(peid)
        person_objs = Person.query.filter(Person.id.in_(pe_ids), Person.user_id == user_id).all()
        persons = [p.to_dict() for p in person_objs]

    if album_id:
        album_obj = Album.query.filter_by(id=album_id, user_id=user_id).first()
        if album_obj:
            album = album_obj.to_dict()

    return photos, persons, album


def run_groq_chat_online(prompt, history, photo_ids, user_id):
    """Helper to execute online Groq Chat completion with tool calling."""
    from groq import Groq
    from flask import current_app
    import json

    api_key = current_app.config.get("GROQ_API_KEY", "")
    if not api_key or api_key == "your-groq-api-key-here":
        raise ValueError("GROQ_API_KEY not configured")

    client = Groq(api_key=api_key)
    model = current_app.config.get("GROQ_MODEL", "llama-3.3-70b-versatile")

    # Build active photos critical context info
    active_photos_info = ""
    if photo_ids:
        photos = Photo.query.filter(Photo.id.in_(photo_ids), Photo.user_id == user_id).all()
        image_paths = [p.file_path if (p.file_path and p.file_path.startswith(('http://', 'https://'))) else os.path.abspath(p.file_path) for p in photos]
        if image_paths:
            active_photos_info = (
                f"\n\nCRITICAL CONTEXT: The user is currently viewing these photos on the screen (active photos): {json.dumps(image_paths)}.\n"
                "If and only if the user has completed the two-step sharing flow and provided their phone number or email address:\n"
                "1. For WhatsApp (after user provides phone number):\n"
                "   You MUST reply exactly: \"Got it! Processing your transfer now...\"\n"
                "   And append this JSON action block at the end of your response:\n"
                "```json\n"
                "{\n"
                "  \"action\": \"EXECUTE_WHATSAPP_SHARE\",\n"
                "  \"payload\": {\n"
                "    \"images\": " + json.dumps(image_paths) + ",\n"
                "    \"default_contact\": \"USER_PROVIDED_PHONE_NUMBER\"\n"
                "  }\n"
                "}\n"
                "```\n"
                "2. For Email (after user provides email address):\n"
                "   You MUST reply exactly: \"Got it! Processing your transfer now...\"\n"
                "   And append this JSON action block at the end of your response:\n"
                "```json\n"
                "{\n"
                "  \"action\": \"EXECUTE_EMAIL_SHARE\",\n"
                "  \"payload\": {\n"
                "    \"images\": " + json.dumps(image_paths) + ",\n"
                "    \"recipient\": \"USER_PROVIDED_EMAIL_ADDRESS\"\n"
                "  }\n"
                "}\n"
                "```"
            )
    if not active_photos_info:
        active_photos_info = (
            "\n\nCRITICAL CONTEXT: There are NO active photos currently rendered on the screen. "
            "If the user asks to share, share these photos, or send via WhatsApp, you must politely explain to them "
            "that they need to search for or display some photos first so you know which ones to share!"
        )

    messages = [{"role": "system", "content": SYSTEM_PROMPT + active_photos_info}]
    for h in (history or [])[-8:]:
        role = h.get("role", "user")
        if role == "bot":
            role = "assistant"
        messages.append({"role": role, "content": h.get("content", h.get("text", ""))})
    messages.append({"role": "user", "content": prompt})

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        tools=TOOL_DEFINITIONS,
        tool_choice="auto",
        max_tokens=500,
        temperature=0.7,
    )

    msg = response.choices[0].message
    actions = []

    if msg.tool_calls:
        messages.append(msg)
        for tool_call in msg.tool_calls:
            fn_name = tool_call.function.name
            try:
                fn_args = json.loads(tool_call.function.arguments)
            except json.JSONDecodeError:
                fn_args = {}

            handler = TOOL_HANDLERS.get(fn_name)
            if handler:
                tool_result = handler(fn_args, user_id=user_id)
                actions.append({"tool": fn_name, "args": fn_args, "result": tool_result})
            else:
                tool_result = {"error": f"Unknown tool: {fn_name}"}

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(tool_result),
            })

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=500,
            temperature=0.7,
        )
        reply = response.choices[0].message.content or "I've completed the action."
    else:
        reply = msg.content or "I couldn't process that request."

    return {
        "response": reply,
        "actions": actions
    }


@bp.route("/clear", methods=["POST"])
@token_required
def clear_history():
    """Clear active chat log history for the user."""
    try:
        AgentLog.query.filter_by(user_id=g.current_user.id).delete()
        db.session.commit()
        return jsonify({"status": "success", "message": "Chat history deleted successfully."}), 200
    except Exception as exc:
        db.session.rollback()
        logger.exception("Failed to clear chat history")
        return jsonify({"error": str(exc)}), 500


def _append_gallery_filter_if_needed(prompt, response_text, user_id):
    """If the query is a request to show photos of a person, ensure FILTER_GALLERY_BY_LABEL is appended."""
    if "FILTER_GALLERY_BY_LABEL" in response_text:
        return response_text
        
    prompt_lower = prompt.lower()
    is_sharing_intent = any(w in prompt_lower for w in ["share", "send", "email", "whatsapp", "mail", "deliver"])
    if is_sharing_intent:
        return response_text

    # Check if prompt contains show/see/photos/find/display/gallery
    has_show_intent = any(w in prompt_lower for w in ["show", "see", "photos", "find", "display", "gallery", "look", "view"])
    if not has_show_intent:
        return response_text

    from models.person import Person
    all_persons = Person.query.filter(Person.user_id == user_id).all()
    for p in all_persons:
        p_name_lower = p.name.lower()
        if p_name_lower in prompt_lower:
            target_photo_count = len({f.photo_id for f in p.faces if f.photo_id})
            action_json = {
                "message": f"I found {target_photo_count} photos of {p.name}. Opening their gallery for you now!",
                "action": "FILTER_GALLERY_BY_LABEL",
                "target_label": p.name
            }
            return response_text + f"\n\n```json\n{json.dumps(action_json, indent=2)}\n```"
            
    return response_text


# ── POST /api/chat ────────────────────────────────────────────────────────

@bp.route("/", methods=["POST"])
@token_required
def chat():
    """AI Assistant chat endpoint.

    Expects JSON::

        {
            "prompt": "Show me photos of Priya",
            "history": [                          // optional
                {"role": "user", "content": "..."},
                {"role": "assistant", "content": "..."}
            ]
        }

    First attempts the LangGraph agent workflow.  Falls back to direct
    Groq API with tool calling.
    """
    data = request.get_json(silent=True) or {}
    prompt = data.get("prompt", "").strip()
    history = data.get("history", [])
    photo_ids = data.get("photo_ids", [])

    if not prompt:
        return jsonify({"error": "prompt is required"}), 400

    actions = []
    
    # Target variables
    resolved_photos = []
    resolved_persons = []
    resolved_album = None

    # ── Attempt 1: LangGraph agent workflow ───────────────────────────
    try:
        from workflows.agent_workflow import run_agent_workflow

        result = run_agent_workflow(prompt, history, photo_ids=photo_ids, user_id=g.current_user.id)
        if result and result.get("response"):
            resolved_photos, resolved_persons, resolved_album = _resolve_entities(
                result.get("photo_ids", []),
                result.get("person_ids", []),
                result.get("album_id"),
                g.current_user.id
            )
            _log_interaction(prompt, "langgraph", "agent_workflow", result["response"], g.current_user.id)
            final_res = _append_gallery_filter_if_needed(prompt, result["response"], g.current_user.id)
            return jsonify({
                "response": final_res,
                "actions": result.get("actions", []),
                "photos": resolved_photos,
                "persons": resolved_persons,
                "album": resolved_album
            }), 200
    except Exception as exc:
        logger.warning("LangGraph workflow failed: %s", exc)

    # ── Attempt 2: Direct Groq API with tool calling ──────────────────
    try:
        result = run_groq_chat_online(prompt, history, photo_ids, g.current_user.id)
        if result and result.get("response"):
            actions = result.get("actions", [])
            reply = result["response"]
            
            p_ids = []
            pe_ids = []
            a_id = None
            for action in actions:
                tool_name = action.get("tool")
                res_val = action.get("result", {})
                if tool_name == "search_photos" and "photos" in res_val:
                    p_ids.extend([p["id"] for p in res_val["photos"] if "id" in p])
                elif tool_name == "get_person":
                    if "id" in res_val:
                        pe_ids.append(res_val["id"])
                    if "photos" in res_val:
                        p_ids.extend(res_val["photos"])
                elif tool_name == "create_album" and "id" in res_val:
                    a_id = res_val["id"]
            
            resolved_photos, resolved_persons, resolved_album = _resolve_entities(p_ids, pe_ids, a_id, g.current_user.id)
            _log_interaction(prompt, "groq_direct", "chat", reply, g.current_user.id)
            final_res = _append_gallery_filter_if_needed(prompt, reply, g.current_user.id)
            return jsonify({
                "response": final_res,
                "actions": actions,
                "photos": resolved_photos,
                "persons": resolved_persons,
                "album": resolved_album
            }), 200
    except Exception as exc:
        logger.warning("Groq API call failed: %s", exc)

    # ── Attempt 3: Offline fallback ───────────────────────────────────
    reply, fallback_photo_ids, fallback_person_ids, fallback_album_id = _offline_fallback(prompt, g.current_user.id, photo_ids=photo_ids, history=history)
    resolved_photos, resolved_persons, resolved_album = _resolve_entities(
        fallback_photo_ids, fallback_person_ids, fallback_album_id, g.current_user.id
    )
    _log_interaction(prompt, "offline", "fallback", reply, g.current_user.id)
    final_res = _append_gallery_filter_if_needed(prompt, reply, g.current_user.id)
    return jsonify({
        "response": final_res,
        "actions": actions,
        "photos": resolved_photos,
        "persons": resolved_persons,
        "album": resolved_album
    }), 200


def _detect_language(text):
    """Heuristic language detection based on common word patterns.

    Returns one of: 'en', 'hi', 'es', 'te'.
    Defaults to 'en' when no match is found.
    """
    t = text.lower()
    hi_markers = ["kya", "mujhe", "dikhao", "mere", "photo", "bhejo", "aaj", "kal", "nahi", "kaun", "kaise"]
    te_markers = ["meeru", "naaku", "chupinchu", "pampu", "evaru", "foto", "anni", "ela", "chudandi"]
    es_markers = ["hola", "fotos", "mostrar", "enviar", "quiero", "buscar", "mis", "como", "donde", "cuando"]
    if any(m in t for m in hi_markers):
        return "hi"
    if any(m in t for m in te_markers):
        return "te"
    if any(m in t for m in es_markers):
        return "es"
    return "en"


_GENERIC_FALLBACK = {
    "en": ("I'm your Drishyamitra AI assistant! I can help you find photos by person, "
           "date, or event, share photos via email or WhatsApp, create albums, and show "
           "analytics. What would you like to do?"),
    "hi": ("मैं आपका Drishyamitra AI सहायक हूँ! मैं व्यक्ति, तारीख या इवेंट के आधार पर "
           "फ़ोटो खोजने में, ईमेल या WhatsApp से शेयर करने में और एल्बम बनाने में आपकी "
           "मदद कर सकता हूँ। आप क्या करना चाहते हैं?"),
    "te": ("నేను మీ Drishyamitra AI సహాయకుడు! నేను వ్యక్తి, తేదీ లేదా ఈవెంట్ ద్వారా "
           "ఫోటోలు వెతకడంలో, ఇమెయిల్ లేదా WhatsApp ద్వారా షేర్ చేయడంలో సహాయం చేయగలను. "
           "మీరు ఏమి చేయాలనుకుంటున్నారు?"),
    "es": ("¡Soy tu asistente AI Drishyamitra! Puedo ayudarte a buscar fotos por persona, "
           "fecha o evento, compartir fotos por correo o WhatsApp, y crear álbumes. "
           "¿Qué deseas hacer?"),
}


def _offline_fallback(prompt, user_id, photo_ids=None, history=None):
    """Generate a basic response and matched entities without any LLM by querying the DB."""
    import re
    lang = _detect_language(prompt)
    prompt_lower = prompt.lower()

    if history is None:
        history = []

    current_state = None
    if history:
        last_msg = history[-1]
        if last_msg.get("role") in ["bot", "assistant"]:
            last_text = last_msg.get("content", "").lower()
            if "1. whatsapp or 2. email" in last_text:
                current_state = "AWAITING_CHANNEL_SELECTION"
            elif "phone number" in last_text:
                current_state = "AWAITING_PHONE"
            elif "email address" in last_text:
                current_state = "AWAITING_EMAIL"

    # Simple offline sharing state simulation
    is_sharing = ("share" in prompt_lower or "whatsapp" in prompt_lower or "email" in prompt_lower or "send" in prompt_lower)
    if is_sharing or current_state:
        email_match = re.search(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", prompt)
        digits = [c for c in prompt if c.isdigit()]
        has_phone = len(digits) >= 10
        
        # 1. Immediate execution if contact info is already present
        if email_match or current_state == "AWAITING_EMAIL":
            email = email_match.group(0) if email_match else prompt.strip()
            if photo_ids:
                photos = Photo.query.filter(Photo.id.in_(photo_ids), Photo.user_id == user_id).all()
                image_paths = [p.file_path if (p.file_path and p.file_path.startswith(('http://', 'https://'))) else os.path.abspath(p.file_path) for p in photos]
                action_json = {
                    "action": "EXECUTE_EMAIL_SHARE",
                    "payload": {
                        "images": image_paths,
                        "recipient": email
                    }
                }
                return (
                    f"Got it! Processing your transfer now...\n```json\n{json.dumps(action_json)}\n```",
                    photo_ids, [], None
                )
            return "Please display some photos first so I know what to share!", [], [], None
            
        elif has_phone or current_state == "AWAITING_PHONE":
            phone = "".join(digits) if has_phone else prompt.strip()
            if not phone.startswith("+"):
                phone = "+" + phone
            if photo_ids:
                photos = Photo.query.filter(Photo.id.in_(photo_ids), Photo.user_id == user_id).all()
                image_paths = [p.file_path if (p.file_path and p.file_path.startswith(('http://', 'https://'))) else os.path.abspath(p.file_path) for p in photos]
                action_json = {
                    "action": "EXECUTE_WHATSAPP_SHARE",
                    "payload": {
                        "images": image_paths,
                        "default_contact": phone
                    }
                }
                return (
                    f"Got it! Processing your transfer now...\n```json\n{json.dumps(action_json)}\n```",
                    photo_ids, [], None
                )
            return "Please display some photos first so I know what to share!", [], [], None

        # 2. Otherwise follow the step-by-step menu
        if "whatsapp" in prompt_lower or prompt_lower.strip() == "1":
            return (
                "Perfect! Please provide the phone number (with country code) you want to send these images to via WhatsApp automation.",
                photo_ids or [], [], None
            )
        elif "email" in prompt_lower or prompt_lower.strip() == "2":
            return (
                "Understood! Please type the recipient's email address so I can package and send these files over.",
                photo_ids or [], [], None
            )
        else:
            return (
                "Would you like to send them via 1. WhatsApp or 2. Email?",
                photo_ids or [], [], None
            )

    if any(phrase in prompt_lower for phrase in ["all photos", "show photos", "all pictures", "show pictures"]):
        photos = Photo.query.filter_by(user_id=user_id).all()
        photo_ids = [p.id for p in photos]
        return (
            f"Here are all {len(photo_ids)} photos from your library.",
            photo_ids,
            [],
            None
        )

    if "upload" in prompt_lower:
        return (
            "To upload photos, click the upload button on your Dashboard or Gallery. "
            "We will look at them and find all the faces automatically!",
            [], [], None
        )
    if "cluster" in prompt_lower or "group" in prompt_lower:
        return (
            "We group similar faces together automatically. You can also press "
            "'Run Face Clustering' on the People page to group any unrecognized faces!",
            [], [], None
        )
    if "label" in prompt_lower or "name" in prompt_lower:
        return (
            "On the People page under 'Unrecognized Faces', you can type a name for a face. "
            "Once named, they move to 'Recognized People'!",
            [], [], None
        )
    if "group photo" in prompt_lower:
        return (
            "For group photos, only one copy of the photo is saved in the database. "
            "If a face belongs to someone you already named, we link it to their profile. "
            "If not, it stays unrecognized for you to label!",
            [], [], None
        )
    if "navigat" in prompt_lower or "arrow" in prompt_lower or "keyboard" in prompt_lower:
        return (
            "Click any photo to open it. Use the on-screen Left/Right arrows or the "
            "Keyboard Left/Right arrow keys to navigate through photos instantly!",
            [], [], None
        )

    photo_ids = []
    person_ids = []
    album_id = None

    # Person queries
    persons = Person.query.filter_by(user_id=user_id).all()
    for person in persons:
        if person.name.lower() in prompt_lower:
            person_ids.append(person.id)
            for face in person.faces:
                if face.photo_id not in photo_ids:
                    photo_ids.append(face.photo_id)
            return (
                f"I found {len(photo_ids)} photo(s) of {person.name} for you. "
                f"Let me know if you'd like to share them or look for someone else!",
                photo_ids,
                person_ids,
                album_id
            )

    # Photo count queries
    if any(w in prompt_lower for w in ["how many", "total", "count"]):
        total = Photo.query.filter_by(user_id=user_id).count()
        people = Person.query.filter_by(user_id=user_id).count()
        return (
            f"Your library has {total} photos with {people} recognised people. "
            f"You can ask me to search, share, or organise them!",
            [], [], None
        )

    # Album queries
    if "album" in prompt_lower:
        albums = Album.query.filter_by(user_id=user_id).all()
        for a in albums:
            if a.name.lower() in prompt_lower:
                album_id = a.id
                photo_ids = [p.id for p in a.photos]
                return f"Here is the album **{a.name}** containing {len(photo_ids)} photo(s).", photo_ids, [], album_id
                
        names = ", ".join(a.name for a in albums) if albums else "none yet"
        return f"Your albums: {names}. Want me to create a new one?", [], [], None

    return (
        _GENERIC_FALLBACK.get(lang, _GENERIC_FALLBACK["en"]),
        [], [], None
    )


def _log_interaction(prompt, agent_name, action, response_text, user_id=None):
    """Write an AgentLog record for auditing."""
    try:
        log = AgentLog(
            prompt=prompt,
            agent_name=agent_name,
            action=action,
            log_text=response_text[:500],
            user_id=user_id,
        )
        db.session.add(log)
        db.session.commit()
    except Exception:
        db.session.rollback()
