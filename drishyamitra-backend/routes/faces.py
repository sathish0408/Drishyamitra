"""
Faces Blueprint
================
Handles face detection, labelling, and person-photo lookups.

Endpoints:
    POST /api/faces/detect
    POST /api/faces/label
    GET  /api/faces/
    GET  /api/faces/person/<id>
"""

import logging
from flask import Blueprint, request, jsonify

from database.db import db
from models.photo import Photo
from models.person import Person
from models.face import Face

logger = logging.getLogger(__name__)
bp = Blueprint("faces", __name__, url_prefix="/api/faces")

# Colour palette that matches the frontend GP palette
PERSON_PALETTES = [
    {"color": "#9334e6", "bg": "#f3e8fd", "emoji": "👩"},
    {"color": "#1a73e8", "bg": "#e8f0fe", "emoji": "👨"},
    {"color": "#f9ab00", "bg": "#fef7e0", "emoji": "👵"},
    {"color": "#e8453c", "bg": "#fce8e6", "emoji": "👧"},
    {"color": "#00897b", "bg": "#e0f2f1", "emoji": "👨‍🦳"},
    {"color": "#34a853", "bg": "#e6f4ea", "emoji": "🧑"},
]


def _make_initials(name):
    """Generate initials from a full name (e.g. 'Priya Sharma' → 'PS')."""
    parts = name.strip().split()
    if len(parts) >= 2:
        return (parts[0][0] + parts[-1][0]).upper()
    return name[:2].upper()


def _pick_palette(person_id):
    """Pick a colour palette for a new person, cycling through the list."""
    return PERSON_PALETTES[person_id % len(PERSON_PALETTES)]


# ── POST /api/faces/detect ────────────────────────────────────────────────

@bp.route("/detect", methods=["POST"])
def detect_faces():
    """Run face detection on a photo.

    Expects JSON: ``{"photo_id": 123}``

    Detects faces, generates embeddings, matches against known people,
    and creates Face records.
    """
    data = request.get_json(silent=True) or {}
    photo_id = data.get("photo_id")

    if not photo_id:
        return jsonify({"error": "photo_id is required"}), 400

    photo = Photo.query.get(photo_id)
    if not photo:
        return jsonify({"error": "Photo not found"}), 404

    try:
        from services.vision_service import VisionService
        from services.embedding_service import EmbeddingService

        detections = VisionService.detect_faces(photo.file_path)

        # Get all known faces (those already linked to a person)
        known_faces = Face.query.filter(Face.person_id.isnot(None)).all()

        created_faces = []
        for det in detections:
            # Try to match against existing people
            matched_person = EmbeddingService.find_matching_person(
                det["embedding"], known_faces
            )

            face = Face(
                photo_id=photo.id,
                person_id=matched_person.id if matched_person else None,
                bounding_box=det["bounding_box"],
                embedding=det["embedding"],
                confidence=det.get("confidence", 1.0),
            )
            db.session.add(face)
            created_faces.append(face)

        db.session.commit()

        return jsonify({
            "faces_detected": len(created_faces),
            "faces": [f.to_dict() for f in created_faces],
        }), 200

    except Exception as exc:
        db.session.rollback()
        logger.exception("Face detection failed for photo %s", photo_id)
        return jsonify({"error": str(exc)}), 500


# ── POST /api/faces/label ─────────────────────────────────────────────────

@bp.route("/label", methods=["POST"])
def label_face():
    """Label unrecognized face(s) with a person name.

    Expects JSON: ``{"face_ids": [42, 43], "name": "Priya Sharma"}`` or ``{"face_id": 42, "name": "..."}``
    """
    data = request.get_json(silent=True) or {}
    face_ids = data.get("face_ids")
    face_id = data.get("face_id")
    name = data.get("name", "").strip()

    if not name or (not face_ids and not face_id):
        return jsonify({"error": "face_id/face_ids and name are required"}), 400

    # Normalise input to a list of face IDs
    if not face_ids:
        if isinstance(face_id, list):
            face_ids = face_id
        else:
            face_ids = [face_id]

    try:
        # Find or create person
        person = Person.query.filter(
            db.func.lower(Person.name) == name.lower()
        ).first()

        if not person:
            palette = _pick_palette(Person.query.count())
            person = Person(
                name=name,
                initials=_make_initials(name),
                emoji=palette["emoji"],
                color=palette["color"],
                bg=palette["bg"],
                tags=[],
            )
            db.session.add(person)
            db.session.flush()  # Get person.id

        # Link all requested faces
        linked_faces = []
        for fid in face_ids:
            f = Face.query.get(fid)
            if f and f.person_id is None:
                f.person_id = person.id
                linked_faces.append(f)

        # Auto-link similar unidentified faces from the remaining database
        auto_linked = 0
        try:
            from services.embedding_service import EmbeddingService

            unlinked = Face.query.filter(
                Face.person_id.is_(None)
            ).all()

            for uf in unlinked:
                # Compare against the representative embeddings we just labeled
                for lf in linked_faces:
                    sim = EmbeddingService.calculate_similarity(
                        lf.embedding, uf.embedding
                    )
                    if sim >= EmbeddingService.SIMILARITY_THRESHOLD:
                        uf.person_id = person.id
                        auto_linked += 1
                        break
        except Exception as exc:
            logger.warning("Auto-linking failed: %s", exc)

        db.session.commit()

        return jsonify({
            "message": f'Faces successfully labelled as "{name}"',
            "auto_linked": auto_linked,
            "person": person.to_dict(),
        }), 200

    except Exception as exc:
        db.session.rollback()
        logger.exception("Face labelling failed")
        return jsonify({"error": str(exc)}), 500


# ── GET /api/faces/ ───────────────────────────────────────────────────────

@bp.route("/", methods=["GET"])
def list_unrecognised():
    """Return all unrecognised faces, grouped/clustered by similarity."""
    try:
        faces = Face.query.filter(Face.person_id.is_(None)).order_by(
            Face.created_at.desc()
        ).all()

        from services.embedding_service import EmbeddingService

        # Cluster unrecognized faces
        clusters = [] # list of lists of Face objects
        for face in faces:
            if not face.embedding:
                continue
            matched = False
            for cluster in clusters:
                rep_face = cluster[0]
                sim = EmbeddingService.calculate_similarity(face.embedding, rep_face.embedding)
                if sim >= EmbeddingService.SIMILARITY_THRESHOLD:
                    cluster.append(face)
                    matched = True
                    break
            if not matched:
                clusters.append([face])

        # Formulate JSON payload
        output = []
        for cluster in clusters:
            faces_in_cluster = []
            for face in cluster:
                photo = Photo.query.get(face.photo_id)
                filename = photo.filename if photo else "unknown"
                import os
                photo_url = f"http://localhost:5000/api/photos/file/{os.path.basename(photo.file_path)}" if (photo and photo.file_path) else None
                faces_in_cluster.append({
                    "id": face.id,
                    "photo_id": face.photo_id,
                    "filename": filename,
                    "photo_url": photo_url,
                    "bounding_box": face.bounding_box,
                    "confidence": face.confidence
                })
            output.append({
                "id": cluster[0].id, # Use representative face ID as cluster ID
                "face_ids": [f.id for f in cluster],
                "faces": faces_in_cluster
            })

        return jsonify(output), 200
    except Exception as exc:
        logger.exception("Failed to list unrecognised faces")
        return jsonify({"error": str(exc)}), 500


# ── GET /api/faces/crop/<face_id> ─────────────────────────────────────────

@bp.route("/crop/<int:face_id>", methods=["GET"])
def crop_face(face_id):
    """Crop and return the face image using OpenCV."""
    face = Face.query.get(face_id)
    if not face:
        return jsonify({"error": "Face not found"}), 404

    photo = Photo.query.get(face.photo_id)
    if not photo:
        return jsonify({"error": "Photo not found"}), 404

    try:
        import cv2
        import io
        from flask import send_file
        from services.vision_service import VisionService

        face_region = VisionService.extract_face_region(photo.file_path, face.bounding_box)
        if face_region is None or face_region.size == 0:
            return jsonify({"error": "Failed to extract face region"}), 500

        success, encoded_img = cv2.imencode('.png', face_region)
        if not success:
            return jsonify({"error": "Failed to encode image"}), 500

        return send_file(
            io.BytesIO(encoded_img.tobytes()),
            mimetype='image/png'
        )
    except Exception as exc:
        logger.exception("Failed to crop face")
        return jsonify({"error": str(exc)}), 500


# ── GET /api/faces/person/<id> ────────────────────────────────────────────

@bp.route("/person/<int:person_id>", methods=["GET"])
def get_person_photos(person_id):
    """Return a person's profile and all photos containing them."""
    person = Person.query.get(person_id)
    if not person:
        return jsonify({"error": "Person not found"}), 404

    try:
        photo_ids = list({f.photo_id for f in person.faces})
        photos = Photo.query.filter(Photo.id.in_(photo_ids)).order_by(
            Photo.upload_date.desc()
        ).all() if photo_ids else []

        return jsonify({
            "person": person.to_dict(),
            "photos": [p.to_dict() for p in photos],
        }), 200

    except Exception as exc:
        logger.exception("Failed to get person photos")
        return jsonify({"error": str(exc)}), 500


# ── DELETE /api/faces/person/<id> ──────────────────────────────────────────

@bp.route("/person/<int:person_id>", methods=["DELETE"])
def delete_person(person_id):
    """Delete a person record and unlink their associated faces."""
    person = Person.query.get(person_id)
    if not person:
        return jsonify({"error": "Person not found"}), 404

    try:
        # Unlink all faces associated with this person
        for face in person.faces:
            face.person_id = None

        db.session.delete(person)
        db.session.commit()
        return jsonify({"message": f'Person "{person.name}" deleted successfully'}), 200
    except Exception as exc:
        db.session.rollback()
        logger.exception("Failed to delete person")
        return jsonify({"error": str(exc)}), 500


# ── GET /api/faces/persons (convenience — list all people) ────────────────

@bp.route("/persons", methods=["GET"])
def list_persons():
    """Return all known persons with their photo counts."""
    try:
        persons = Person.query.order_by(Person.name).all()
        return jsonify([p.to_dict() for p in persons]), 200
    except Exception as exc:
        logger.exception("Failed to list persons")
        return jsonify({"error": str(exc)}), 500
