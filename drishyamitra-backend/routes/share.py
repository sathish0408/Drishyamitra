import os
import logging
import threading
import socket
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, current_app, g
from database.db import db
from models.sharing import DeliveryHistory
from utils.auth_helpers import token_required
from models.photo import Photo
from models.person import Person
from models.album import Album

logger = logging.getLogger(__name__)
bp = Blueprint("share", __name__, url_prefix="/api/share")


def get_safe_path_or_url(path):
    """Return the path as-is if it's an HTTP/HTTPS URL, else return absolute path."""
    if not path:
        return ""
    if path.startswith(('http://', 'https://')):
        return path
    return os.path.abspath(path)


def resolve_sharing_assets(raw_paths, user_id):
    """Resolve a list of image paths that may contain person/album label names.

    When the chatbot LLM returns a label description (e.g. ``"Avinash's photos"``
    or ``"Family Trips"``) instead of physical file paths, this helper intercepts
    those strings, queries the ``Person`` and ``Album`` tables, and returns actual
    absolute file paths that can be attached to emails or uploaded for WhatsApp.

    Items that already point to existing files on disk are kept as-is.
    """
    import re

    resolved = []
    for entry in raw_paths:
        entry = entry.strip()
        # 0. If it's a remote URL, keep it as-is
        if entry.startswith(('http://', 'https://')):
            resolved.append(entry)
            continue

        # 1. If the path exists on disk, keep it
        if os.path.isfile(entry):
            resolved.append(os.path.abspath(entry))
            continue

        # 2. Attempt to parse a person name out of the label string
        #    Common LLM patterns: "Avinash's photos", "photos of Avinash"
        name_candidate = entry
        # Strip common suffixes / prefixes
        for pattern in [r"'s\s+photos?$", r"photos?\s+of\s+", r"'s\s+images?$",
                        r"images?\s+of\s+", r"^photos?\s+", r"^images?\s+"]:
            name_candidate = re.sub(pattern, "", name_candidate, flags=re.IGNORECASE).strip()

        if not name_candidate:
            continue

        # 2a. Try matching a Person
        person = Person.query.filter(
            Person.user_id == user_id,
            Person.name.ilike(f"%{name_candidate}%")
        ).first()
        if person:
            photo_ids = list({f.photo_id for f in person.faces if f.photo_id})
            if photo_ids:
                photos = Photo.query.filter(Photo.id.in_(photo_ids), Photo.user_id == user_id).all()
                for p in photos:
                    abs_path = get_safe_path_or_url(p.file_path)
                    if abs_path not in resolved:
                        resolved.append(abs_path)
            continue

        # 2b. Try matching an Album
        album = Album.query.filter(
            Album.user_id == user_id,
            Album.name.ilike(f"%{name_candidate}%")
        ).first()
        if album:
            for p in album.photos:
                abs_path = get_safe_path_or_url(p.file_path)
                if abs_path not in resolved:
                    resolved.append(abs_path)
            continue

        # 2c. Last resort — try the raw entry as a filename search
        photo = Photo.query.filter(
            Photo.user_id == user_id,
            Photo.filename.ilike(f"%{name_candidate}%")
        ).first()
        if photo:
            resolved.append(get_safe_path_or_url(photo.file_path))

    return resolved

# Import the temporary cloud hosting uploader
from services.sharing_service import _upload_for_public_url

def send_whatsapp_async_worker(phone, image_paths, delivery_id, app):
    """Background worker for sending WhatsApp messages via Twilio Client."""
    with app.app_context():
        try:
            # Import Twilio Client early so exceptions can use it
            try:
                from twilio.rest import Client
                from twilio.base.exceptions import TwilioRestException
            except ImportError:
                Client = None
                TwilioRestException = Exception

            th_delivery = DeliveryHistory.query.get(delivery_id)
            if not th_delivery:
                return

            account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
            auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
            from_whatsapp = os.environ.get("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")

            if not account_sid or not auth_token:
                th_delivery.status = 'failed'
                th_delivery.error_message = "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN environment variables not configured."
                db.session.commit()
                return

            # Standardize phone number format
            to_number = phone
            if not to_number.startswith("whatsapp:"):
                clean_num = "".join(c for c in to_number if c.isdigit() or c == '+')
                if not clean_num.startswith("+"):
                    if len(clean_num) == 10:
                        clean_num = "+91" + clean_num
                    else:
                        clean_num = "+" + clean_num
                to_number = f"whatsapp:{clean_num}"

            # Upload photos to public cloud hosting
            media_urls = []
            for path in image_paths:
                if path.startswith(('http://', 'https://')):
                    public_url = path
                else:
                    public_url = _upload_for_public_url(path)
                if not public_url:
                    filename = os.path.basename(path)
                    public_url = f"https://drishyamitra-public-assets.mock/media/{filename}"
                media_urls.append(public_url)

            if not Client:
                raise Exception("twilio python package is not installed.")

            client = Client(account_sid, auth_token)

            sent_messages = []
            if media_urls:
                for idx, m_url in enumerate(media_urls):
                    body = f"Photo {idx + 1} of {len(media_urls)}"
                    msg = client.messages.create(
                        from_=from_whatsapp,
                        to=to_number,
                        body=body,
                        media_url=[m_url]
                    )
                    sent_messages.append(msg)
            else:
                # Text-only fallback if upload failed
                msg = client.messages.create(
                    from_=from_whatsapp,
                    to=to_number,
                    body=f"Shared {len(image_paths)} photo(s) via Drishyamitra."
                )
                sent_messages.append(msg)

            # Poll statuses for sent messages to capture actual async delivery failures
            import time
            final_status = 'delivered'
            error_message = None

            for msg in sent_messages:
                for _ in range(8):
                    try:
                        fetched = client.messages(msg.sid).fetch()
                        status = fetched.status
                        if status in ['delivered', 'sent']:
                            break
                        elif status in ['failed', 'undelivered']:
                            final_status = 'failed'
                            code = fetched.error_code
                            msg_str = fetched.error_message
                            error_message = f"Twilio delivery failed (Status: {status})"
                            if code:
                                error_message += f" [Error {code}]"
                                if code == 63016:
                                    error_message += ": WhatsApp sandbox session expired. Please send 'join <sandbox-keyword>' to the Twilio sandbox number (+1 415 523 8886) to reopen the 24-hour window."
                                elif code == 63019:
                                    error_message += ": Twilio was unable to download the media. Please check if the hosted image is valid."
                                elif msg_str:
                                    error_message += f": {msg_str}"
                            elif msg_str:
                                error_message += f": {msg_str}"
                            break
                    except Exception:
                        break
                    time.sleep(1.0)
                if final_status == 'failed':
                    break

            th_delivery.status = final_status
            th_delivery.error_message = error_message
            db.session.commit()
            logger.info(f"[Twilio] WhatsApp background send finished. Status: {final_status}, Error: {error_message}")


        except TwilioRestException as tw_err:
            logger.exception("Twilio REST error during background share")
            try:
                th_delivery = DeliveryHistory.query.get(delivery_id)
                if th_delivery:
                    th_delivery.status = 'failed'
                    th_delivery.error_message = f"Twilio error: {tw_err.msg or tw_err}"
                    db.session.commit()
            except Exception:
                pass
        except Exception as exc:
            logger.exception("Unexpected error during background WhatsApp share")
            try:
                th_delivery = DeliveryHistory.query.get(delivery_id)
                if th_delivery:
                    th_delivery.status = 'failed'
                    th_delivery.error_message = f"System error: {str(exc)}"
                    db.session.commit()
            except Exception:
                pass


def send_email_async_worker(email_recipient, image_paths, delivery_id, app):
    """Background worker for sending emails via standard SMTP/smtplib."""
    with app.app_context():
        try:
            th_delivery = DeliveryHistory.query.get(delivery_id)
            if not th_delivery:
                return

            smtp_user = os.environ.get("SMTP_USER")
            smtp_password = os.environ.get("SMTP_PASSWORD")
            smtp_server = os.environ.get("SMTP_SERVER", "smtp.gmail.com")
            smtp_port_str = os.environ.get("SMTP_PORT", "465")

            if not smtp_user or not smtp_password:
                th_delivery.status = 'failed'
                th_delivery.error_message = "SMTP_USER or SMTP_PASSWORD not configured in .env file"
                db.session.commit()
                return

            try:
                port = int(smtp_port_str)
            except ValueError:
                port = 465

            msg = MIMEMultipart()
            msg['From'] = smtp_user
            msg['To'] = email_recipient
            msg['Subject'] = "Drishyamitra — Photos shared with you"

            body_text = f"Hi,\n\nHere are the photos shared with you via Drishyamitra AI Assistant.\n\nEnjoy!"
            msg.attach(MIMEText(body_text, 'plain'))

            # Attach images securely as MIMEImage (compressing large files dynamically to prevent SMTP disconnects)
            from PIL import Image
            import io
            from utils.storage_helpers import get_local_image_path

            temp_files = []
            try:
                for path in image_paths:
                    local_path, is_temp = get_local_image_path(path)
                    if not local_path or not os.path.exists(local_path):
                        logger.warning("[SMTP] File not found: %s", path)
                        continue
                    if is_temp:
                        temp_files.append(local_path)
                    
                    try:
                        filename = os.path.basename(path)
                        file_size = os.path.getsize(local_path)
                        
                        # Compress if file size exceeds 500 KB to keep total email payload light
                        if file_size > 500 * 1024:
                            try:
                                with Image.open(local_path) as img:
                                    if img.mode in ('RGBA', 'P', 'LA'):
                                        img = img.convert('RGB')
                                    # Limit dimensions to standard HD width/height
                                    max_dim = 1920
                                    if img.width > max_dim or img.height > max_dim:
                                        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
                                    
                                    out_buf = io.BytesIO()
                                    img.save(out_buf, format='JPEG', quality=85, optimize=True)
                                    img_data = out_buf.getvalue()
                                    # Standardize extension to .jpg for compressed version
                                    base_name = os.path.splitext(filename)[0]
                                    filename = f"{base_name}_compressed.jpg"
                            except Exception as compress_err:
                                logger.warning("[SMTP] Failed to compress image %s: %s. Sending original.", local_path, compress_err)
                                with open(local_path, 'rb') as f:
                                    img_data = f.read()
                        else:
                            with open(local_path, 'rb') as f:
                                img_data = f.read()

                        image = MIMEImage(img_data, name=filename)
                        image.add_header('Content-Disposition', 'attachment', filename=filename)
                        msg.attach(image)
                    except Exception as e:
                        logger.error("[SMTP] Failed to attach file %s (local: %s): %s", path, local_path, e)
            finally:
                # Cleanup temp downloaded files
                for tmp in temp_files:
                    try:
                        if os.path.exists(tmp):
                            os.remove(tmp)
                            logger.info("[SMTP] Cleaned up temporary email attachment file %s", tmp)
                    except Exception as err:
                        logger.warning("[SMTP] Failed to delete temp attachment %s: %s", tmp, err)


            # SSL / TLS execution
            if port == 465:
                with smtplib.SMTP_SSL(smtp_server, port, timeout=30) as server:
                    server.login(smtp_user, smtp_password)
                    server.sendmail(smtp_user, email_recipient, msg.as_string())
            else:
                with smtplib.SMTP(smtp_server, port, timeout=30) as server:
                    server.starttls()
                    server.login(smtp_user, smtp_password)
                    server.sendmail(smtp_user, email_recipient, msg.as_string())

            th_delivery.status = 'delivered'
            th_delivery.error_message = None
            db.session.commit()
            logger.info("[SMTP] Email background send finished. Status: delivered")

        except (smtplib.SMTPException, socket.timeout, socket.error) as net_err:
            logger.exception("SMTP/Socket error during email dispatch")
            try:
                th_delivery = DeliveryHistory.query.get(delivery_id)
                if th_delivery:
                    th_delivery.status = 'failed'
                    th_delivery.error_message = f"Network failure: {str(net_err)}"
                    db.session.commit()
            except Exception:
                pass
        except Exception as exc:
            logger.exception("Unexpected error during email dispatch")
            try:
                th_delivery = DeliveryHistory.query.get(delivery_id)
                if th_delivery:
                    th_delivery.status = 'failed'
                    th_delivery.error_message = f"System error: {str(exc)}"
                    db.session.commit()
            except Exception:
                pass


@bp.route("/whatsapp", methods=["POST"])
@token_required
def share_whatsapp():
    """Trigger background sharing via Twilio WhatsApp API."""
    data = request.get_json(silent=True) or {}
    phone = data.get("phone", "").strip()
    raw_image_paths = data.get("image_paths", [])

    # Handle explicit entity IDs
    person_id = data.get("person_id")
    album_id = data.get("album_id")
    label_name = data.get("label_name")

    if person_id:
        person = Person.query.filter_by(id=person_id, user_id=g.current_user.id).first()
        if person:
            p_ids = list({f.photo_id for f in person.faces if f.photo_id})
            photos = Photo.query.filter(Photo.id.in_(p_ids), Photo.user_id == g.current_user.id).all() if p_ids else []
            raw_image_paths.extend([get_safe_path_or_url(p.file_path) for p in photos])

    if album_id:
        album = Album.query.filter_by(id=album_id, user_id=g.current_user.id).first()
        if album:
            raw_image_paths.extend([get_safe_path_or_url(p.file_path) for p in album.photos])

    if label_name:
        person = Person.query.filter(Person.user_id == g.current_user.id, Person.name.ilike(f"%{label_name}%")).first()
        if person:
            p_ids = list({f.photo_id for f in person.faces if f.photo_id})
            photos = Photo.query.filter(Photo.id.in_(p_ids), Photo.user_id == g.current_user.id).all() if p_ids else []
            raw_image_paths.extend([get_safe_path_or_url(p.file_path) for p in photos])
        else:
            album = Album.query.filter(Album.user_id == g.current_user.id, Album.name.ilike(f"%{label_name}%")).first()
            if album:
                raw_image_paths.extend([get_safe_path_or_url(p.file_path) for p in album.photos])

    # Remove duplicate paths
    raw_image_paths = list(set(raw_image_paths))

    if not phone:
        return jsonify({"error": "phone number is required"}), 400
    if not raw_image_paths and not (person_id or album_id or label_name):
        return jsonify({"error": "image_paths list is required"}), 400

    # Resolve any label names (e.g. "Avinash's photos") into real file paths
    image_paths = resolve_sharing_assets(raw_image_paths, g.current_user.id)
    if not image_paths:
        logger.warning("[WhatsApp] resolve_sharing_assets returned empty list for: %s", raw_image_paths)
        return jsonify({
            "error": "Could not resolve any photos for the given identifiers. "
                     "Please display or select the photos first before sharing."
        }), 400

    try:
        delivery = DeliveryHistory(
            recipient=phone,
            platform='whatsapp',
            person_name='Shared Photos',
            photo_count=len(image_paths),
            status='pending',
            user_id=g.current_user.id
        )
        db.session.add(delivery)
        db.session.commit()

        delivery_id = delivery.id
        app = current_app._get_current_object()

        threading.Thread(
            target=send_whatsapp_async_worker,
            args=(phone, image_paths, delivery_id, app),
            daemon=True
        ).start()

        return jsonify({
            "status": "success",
            "message": "WhatsApp sharing process triggered asynchronously.",
            "delivery_id": delivery_id
        }), 200
    except Exception as exc:
        logger.exception("Failed to initialize WhatsApp sharing")
        return jsonify({"error": str(exc)}), 500


@bp.route("/email", methods=["POST"])
@token_required
def share_email():
    """Trigger background sharing via SMTP email."""
    data = request.get_json(silent=True) or {}
    email = data.get("email", "").strip()
    raw_image_paths = data.get("image_paths", [])

    # Handle explicit entity IDs
    person_id = data.get("person_id")
    album_id = data.get("album_id")
    label_name = data.get("label_name")

    if person_id:
        person = Person.query.filter_by(id=person_id, user_id=g.current_user.id).first()
        if person:
            p_ids = list({f.photo_id for f in person.faces if f.photo_id})
            photos = Photo.query.filter(Photo.id.in_(p_ids), Photo.user_id == g.current_user.id).all() if p_ids else []
            raw_image_paths.extend([get_safe_path_or_url(p.file_path) for p in photos])

    if album_id:
        album = Album.query.filter_by(id=album_id, user_id=g.current_user.id).first()
        if album:
            raw_image_paths.extend([get_safe_path_or_url(p.file_path) for p in album.photos])

    if label_name:
        person = Person.query.filter(Person.user_id == g.current_user.id, Person.name.ilike(f"%{label_name}%")).first()
        if person:
            p_ids = list({f.photo_id for f in person.faces if f.photo_id})
            photos = Photo.query.filter(Photo.id.in_(p_ids), Photo.user_id == g.current_user.id).all() if p_ids else []
            raw_image_paths.extend([get_safe_path_or_url(p.file_path) for p in photos])
        else:
            album = Album.query.filter(Album.user_id == g.current_user.id, Album.name.ilike(f"%{label_name}%")).first()
            if album:
                raw_image_paths.extend([get_safe_path_or_url(p.file_path) for p in album.photos])

    # Remove duplicate paths
    raw_image_paths = list(set(raw_image_paths))

    if not email:
        return jsonify({"error": "email recipient is required"}), 400
    if not raw_image_paths and not (person_id or album_id or label_name):
        return jsonify({"error": "image_paths list is required"}), 400

    # Resolve any label names (e.g. "Avinash's photos") into real file paths
    image_paths = resolve_sharing_assets(raw_image_paths, g.current_user.id)
    if not image_paths:
        logger.warning("[Email] resolve_sharing_assets returned empty list for: %s", raw_image_paths)
        return jsonify({
            "error": "Could not resolve any photos for the given identifiers. "
                     "Please display or select the photos first before sharing."
        }), 400

    try:
        delivery = DeliveryHistory(
            recipient=email,
            platform='email',
            person_name='Shared Photos',
            photo_count=len(image_paths),
            status='pending',
            user_id=g.current_user.id
        )
        db.session.add(delivery)
        db.session.commit()

        delivery_id = delivery.id
        app = current_app._get_current_object()

        threading.Thread(
            target=send_email_async_worker,
            args=(email, image_paths, delivery_id, app),
            daemon=True
        ).start()

        return jsonify({
            "status": "success",
            "message": "Email sharing process triggered asynchronously.",
            "delivery_id": delivery_id
        }), 200
    except Exception as exc:
        logger.exception("Failed to initialize email sharing")
        return jsonify({"error": str(exc)}), 500


@bp.route("/history", methods=["GET"])
@token_required
def get_share_history():
    """Fetch the logged-in user's sharing history (newest first)."""
    try:
        history = DeliveryHistory.query.filter_by(user_id=g.current_user.id).order_by(DeliveryHistory.id.desc()).all()
        # Return serialized database rows without any mock fallbacks
        return jsonify([h.to_dict() for h in history]), 200
    except Exception as exc:
        logger.exception("Failed to fetch sharing history")
        return jsonify({"error": str(exc)}), 500
