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
from flask import Blueprint, request, jsonify, g

from database.db import db
from models.photo import Photo
from models.person import Person
from models.face import Face
from utils.auth_helpers import token_required

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

import threading
clustering_status_lock = threading.Lock()
# Map user_id -> number of active background tasks (analysis + clustering)
active_background_tasks = {}



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
@token_required
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

    photo = Photo.query.filter_by(id=photo_id, user_id=g.current_user.id).first()
    if not photo:
        return jsonify({"error": "Photo not found"}), 404

    try:
        from services.vision_service import VisionService
        from services.embedding_service import EmbeddingService
        from utils.storage_helpers import get_local_image_path
        
        image_path, is_temp = get_local_image_path(photo.file_path)
        if not image_path:
            return jsonify({"error": "Failed to access image file"}), 500

        try:
            detections = VisionService.detect_faces(image_path)
        finally:
            if is_temp and os.path.exists(image_path):
                try:
                    os.remove(image_path)
                except Exception:
                    pass

        # Get all known faces (those already linked to a person) belonging to the user
        known_faces = Face.query.join(Face.photo).filter(Photo.user_id == g.current_user.id, Face.person_id.isnot(None)).all()

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
@token_required
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
            Person.user_id == g.current_user.id,
            db.func.lower(Person.name) == name.lower()
        ).first()

        if not person:
            palette = _pick_palette(Person.query.filter_by(user_id=g.current_user.id).count())
            person = Person(
                name=name,
                user_id=g.current_user.id,
                initials=_make_initials(name),
                emoji=palette["emoji"],
                color=palette["color"],
                bg=palette["bg"],
                tags=[],
            )
            db.session.add(person)
            db.session.flush()  # Get person.id

        # Link all requested faces (verifying ownership)
        linked_faces = []
        for fid in face_ids:
            f = Face.query.join(Face.photo).filter(Face.id == fid, Photo.user_id == g.current_user.id).first()
            if f:
                # Allow labeling any face (even if already labeled, for manual correction/relabeling)
                f.person_id = person.id
                f.is_manually_labeled = True
                linked_faces.append(f)

        # Auto-link similar unidentified faces from the remaining database (verifying ownership)
        auto_linked = 0
        try:
            from services.embedding_service import EmbeddingService

            unlinked = Face.query.join(Face.photo).outerjoin(Person, Face.person_id == Person.id).filter(
                Photo.user_id == g.current_user.id,
                db.or_(
                    Face.person_id.is_(None),
                    Person.name == "Unnamed Person",
                    Person.name.like("Cluster_%"),
                    Person.name.like("Unknown%")
                )
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
@token_required
def list_unrecognised():
    """Return all unrecognised faces, grouped/clustered by similarity."""
    try:
        from models.person import Person
        from services.embedding_service import EmbeddingService

        # Fetch faces that are unrecognized (no person or placeholder person)
        faces = Face.query.join(Face.photo).outerjoin(Person, Face.person_id == Person.id).filter(
            Photo.user_id == g.current_user.id,
            db.or_(
                Face.person_id.is_(None),
                Person.name == "Unnamed Person",
                Person.name.like("Cluster_%"),
                Person.name.like("Unknown%")
            )
        ).order_by(Face.created_at.desc()).all()

        # Group by person_id (if not None) or dynamically cluster by similarity (if person_id is None)
        placeholder_groups = {} # person_id -> list of Face
        unassigned_faces = []   # list of Face
        
        for face in faces:
            if face.person_id is not None:
                if face.person_id not in placeholder_groups:
                    placeholder_groups[face.person_id] = []
                placeholder_groups[face.person_id].append(face)
            else:
                unassigned_faces.append(face)

        # For unassigned faces, cluster them by similarity dynamically
        dynamic_clusters = [] # list of lists of Face
        for face in unassigned_faces:
            if not face.embedding:
                continue
            matched = False
            for cluster in dynamic_clusters:
                rep_face = cluster[0]
                sim = EmbeddingService.calculate_similarity(face.embedding, rep_face.embedding)
                if sim >= EmbeddingService.SIMILARITY_THRESHOLD:
                    cluster.append(face)
                    matched = True
                    break
            if not matched:
                dynamic_clusters.append([face])

        # Formulate output clusters
        output = []
        from utils.storage_helpers import get_backend_url
        base_url = get_backend_url()

        # 1. Add the database-clustered placeholder groups
        for pid, group_faces in placeholder_groups.items():
            faces_in_cluster = []
            for face in group_faces:
                photo = face.photo
                filename = photo.filename if photo else "unknown"
                import os
                if photo and photo.file_path:
                    if photo.file_path.startswith(('http://', 'https://')):
                        photo_url = photo.file_path
                    else:
                        photo_url = f"{base_url}/api/photos/file/{os.path.basename(photo.file_path)}"
                else:
                    photo_url = None
                faces_in_cluster.append({
                    "id": face.id,
                    "photo_id": face.photo_id,
                    "filename": filename,
                    "photo_url": photo_url,
                    "bounding_box": face.bounding_box,
                    "confidence": face.confidence
                })
            output.append({
                "id": group_faces[0].id,
                "person_id": pid,
                "face_ids": [f.id for f in group_faces],
                "faces": faces_in_cluster
            })

        # 2. Add the dynamically clustered unassigned faces
        for cluster in dynamic_clusters:
            faces_in_cluster = []
            for face in cluster:
                photo = face.photo
                filename = photo.filename if photo else "unknown"
                import os
                if photo and photo.file_path:
                    if photo.file_path.startswith(('http://', 'https://')):
                        photo_url = photo.file_path
                    else:
                        photo_url = f"{base_url}/api/photos/file/{os.path.basename(photo.file_path)}"
                else:
                    photo_url = None
                faces_in_cluster.append({
                    "id": face.id,
                    "photo_id": face.photo_id,
                    "filename": filename,
                    "photo_url": photo_url,
                    "bounding_box": face.bounding_box,
                    "confidence": face.confidence
                })
            output.append({
                "id": cluster[0].id,
                "person_id": None,
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
    """Crop and return the face image using OpenCV (public endpoint for <img> tags)."""
    face = Face.query.get(face_id)
    if not face:
        return jsonify({"error": "Face not found"}), 404

    photo = face.photo
    if not photo:
        return jsonify({"error": "Photo not found"}), 404

    try:
        import cv2
        import io
        import os
        from flask import send_file
        from services.vision_service import VisionService
        from utils.storage_helpers import get_local_image_path

        image_path, is_temp = get_local_image_path(photo.file_path)
        if not image_path:
            return jsonify({"error": "Failed to access image file"}), 500

        try:
            face_region = VisionService.extract_face_region(image_path, face.bounding_box)
            if face_region is None or face_region.size == 0:
                return jsonify({"error": "Failed to extract face region"}), 500

            success, encoded_img = cv2.imencode('.png', face_region)
        finally:
            if is_temp and os.path.exists(image_path):
                try:
                    os.remove(image_path)
                except Exception:
                    pass

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
@token_required
def get_person_photos(person_id):
    """Return a person's profile and all photos containing them."""
    person = Person.query.filter_by(id=person_id, user_id=g.current_user.id).first()
    if not person:
        return jsonify({"error": "Person not found"}), 404

    try:
        photo_ids = list({f.photo_id for f in person.faces})
        photos = Photo.query.filter(Photo.id.in_(photo_ids), Photo.user_id == g.current_user.id).order_by(
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
@token_required
def delete_person(person_id):
    """Delete a person record and unlink their associated faces."""
    person = Person.query.filter_by(id=person_id, user_id=g.current_user.id).first()
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
@token_required
def list_persons():
    """Return all known persons with their photo counts."""
    try:
        persons = Person.query.filter(
            Person.user_id == g.current_user.id,
            Person.name != "Unnamed Person",
            ~Person.name.like("Cluster_%"),
            ~Person.name.like("Unknown%")
        ).order_by(Person.name).all()
        return jsonify([p.to_dict() for p in persons]), 200
    except Exception as exc:
        logger.exception("Failed to list persons")
        return jsonify({"error": str(exc)}), 500


# ── POST /api/faces/cluster ───────────────────────────────────────────────

def run_face_clustering(app, user_id):
    """Background task to run DBSCAN face clustering."""
    with app.app_context():
        try:
            import numpy as np
            from sklearn.cluster import DBSCAN
            from services.embedding_service import EmbeddingService

            logger.info("Starting background DBSCAN face clustering for user %s", user_id)
            
            # Fetch all faces belonging to the user
            all_faces = Face.query.join(Face.photo).filter(Photo.user_id == user_id).all()
            
            # Separate manual faces (to use as cluster classification anchors) and unlabeled faces
            manual_faces = [f for f in all_faces if f.is_manually_labeled and f.person_id is not None]
            unlabeled_faces = [f for f in all_faces if not f.is_manually_labeled]
            
            if not unlabeled_faces:
                logger.info("No unlabeled faces to cluster for user %s.", user_id)
                return

            # Filter valid embeddings
            embeddings = []
            valid_unlabeled = []
            for f in unlabeled_faces:
                if f.embedding and (len(f.embedding) == 512 or len(f.embedding) == 128):
                    embeddings.append(f.embedding)
                    valid_unlabeled.append(f)

            if not embeddings:
                logger.info("No valid face embeddings found for user %s.", user_id)
                return

            X = np.array(embeddings, dtype=np.float64)
            
            # Run DBSCAN (cosine distance metric: eps=0.35 equals similarity >= 0.65)
            dbscan = DBSCAN(eps=0.35, min_samples=1, metric="cosine")
            labels = dbscan.fit_predict(X)

            # Group faces by cluster ID
            clusters = {}
            for idx, label in enumerate(labels):
                lbl_key = int(label)
                if lbl_key not in clusters:
                    clusters[lbl_key] = []
                clusters[lbl_key].append(valid_unlabeled[idx])

            # Calculate centroids for manual people as alignment targets
            manual_centroids = {}
            for mf in manual_faces:
                if mf.person_id not in manual_centroids:
                    manual_centroids[mf.person_id] = []
                manual_centroids[mf.person_id].append(mf.embedding)

            for pid in list(manual_centroids.keys()):
                manual_centroids[pid] = np.mean(manual_centroids[pid], axis=0)

            # Fetch current cluster count to name new ones sequentially
            cluster_count = Person.query.filter(
                Person.user_id == user_id, 
                Person.name.like("Cluster_%")
            ).count()

            # Map to store face -> person_id assignments
            face_assignments = {}

            # First pass: Match clusters against manually labeled centroids
            unmatched_cluster_faces = []

            for label, cluster_faces in clusters.items():
                if label == -1:
                    # DBSCAN Noise
                    for f in cluster_faces:
                        face_assignments[f.id] = None
                    continue

                # Calculate current cluster centroid
                cluster_embs = [f.embedding for f in cluster_faces]
                cluster_centroid = np.mean(cluster_embs, axis=0)

                # Check if this cluster matches any manually labeled person
                best_pid = None
                best_sim = 0.0
                for pid, centroid in manual_centroids.items():
                    sim = EmbeddingService.calculate_similarity(cluster_centroid.tolist(), centroid.tolist())
                    if sim > best_sim:
                        best_sim = sim
                        best_pid = pid

                if best_sim >= 0.60 and best_pid is not None:
                    # Match found! Assign all faces in this cluster to the manual person
                    for f in cluster_faces:
                        face_assignments[f.id] = best_pid
                    logger.info("DBSCAN Cluster %d matched manually labeled Person %d (similarity: %.4f)", label, best_pid, best_sim)
                else:
                    # No manual match. Retain faces for second pass (group photo bundling or solo cluster)
                    unmatched_cluster_faces.extend(cluster_faces)

            # Second pass: Process unmatched faces, ensuring group photos are not shattered
            # Group unmatched faces by photo_id
            photo_unmatched_faces = {}
            for f in unmatched_cluster_faces:
                if f.photo_id not in photo_unmatched_faces:
                    photo_unmatched_faces[f.photo_id] = []
                photo_unmatched_faces[f.photo_id].append(f)

            cluster_person_cache = {}

            for photo_id, group_faces in photo_unmatched_faces.items():
                # Count total faces in this photo
                total_faces_in_photo = Face.query.filter_by(photo_id=photo_id).count()

                if total_faces_in_photo > 1:
                    # Group photo! Do not create new individual/collective placeholder labels for unmatched faces.
                    # The photo simply stays as a single independent photo entity (person_id = None).
                    for f in group_faces:
                        face_assignments[f.id] = None
                    logger.info("Group photo %d: unmatched faces left unassigned", photo_id)
                else:
                    # Solo photo. Map to its DBSCAN cluster's shared "Unnamed Person" profile
                    f_obj = group_faces[0]
                    lbl = None
                    for c_lbl, c_faces in clusters.items():
                        if any(cf.id == f_obj.id for cf in c_faces):
                            lbl = c_lbl
                            break

                    if lbl is not None and lbl != -1:
                        if lbl not in cluster_person_cache:
                            palette = _pick_palette(Person.query.filter_by(user_id=user_id).count())
                            new_person = Person(
                                name="Unnamed Person",
                                user_id=user_id,
                                initials="UP",
                                emoji=palette["emoji"],
                                color=palette["color"],
                                bg=palette["bg"],
                                tags=[]
                            )
                            db.session.add(new_person)
                            db.session.flush()
                            cluster_person_cache[lbl] = new_person.id
                            logger.info("Created cluster person Unnamed Person %d for cluster %d", new_person.id, lbl)

                        face_assignments[f_obj.id] = cluster_person_cache[lbl]
                    else:
                        face_assignments[f_obj.id] = None

            # Apply all face assignments
            for f in all_faces:
                if f.id in face_assignments:
                    f.person_id = face_assignments[f.id]

            # Purge any old auto-generated people (Cluster_X, Unknown Person X, or Unnamed Person) that are now orphaned
            all_persons = Person.query.filter_by(user_id=user_id).all()
            for p in all_persons:
                if (p.name.startswith("Cluster_") or p.name.startswith("Unknown Person") or p.name == "Unnamed Person") and len(p.faces) == 0:
                    db.session.delete(p)
                    logger.info("Purged orphaned person '%s' (id: %d)", p.name, p.id)

            db.session.commit()
            logger.info("Background DBSCAN clustering completed successfully for user %s", user_id)

        except Exception as exc:
            db.session.rollback()
            logger.exception("Background face clustering task failed")


@bp.route("/clustering-status", methods=["GET"])
@token_required
def get_clustering_status():
    """Check if background face analysis/clustering is active for the current user."""
    user_id = g.current_user.id
    with clustering_status_lock:
        active = active_background_tasks.get(user_id, 0) > 0
    return jsonify({"active": active}), 200


# ── POST /api/faces/suggest-names ─────────────────────────────────────────

@bp.route("/suggest-names", methods=["POST"])
@token_required
def suggest_cluster_names():
    """Analyze co-occurrence of people/clusters and suggest relationship labels or names."""
    try:
        user_id = g.current_user.id
        persons = Person.query.filter_by(user_id=user_id).all()
        if not persons:
            return jsonify([]), 200

        # Map photo_id -> list of person_ids in it
        photo_people = {}
        for p in persons:
            for f in p.faces:
                if f.photo_id not in photo_people:
                    photo_people[f.photo_id] = []
                photo_people[f.photo_id].append(p.id)

        # Calculate co-occurrence matrix
        from collections import defaultdict
        co_occur = defaultdict(lambda: defaultdict(int))
        photo_counts = defaultdict(int)

        for photo_id, pids in photo_people.items():
            unique_pids = list(set(pids))
            for pid in unique_pids:
                photo_counts[pid] += 1
            for i in range(len(unique_pids)):
                for j in range(i + 1, len(unique_pids)):
                    p1, p2 = unique_pids[i], unique_pids[j]
                    co_occur[p1][p2] += 1
                    co_occur[p2][p1] += 1

        suggestions = []
        for p in persons:
            # Only suggest names/relationships for unnamed clusters
            if not p.name.startswith("Cluster_") and not p.name.startswith("Unknown"):
                continue

            p_photos = photo_counts[p.id]
            if p_photos == 0:
                continue

            # Find the person/cluster that co-occurs most frequently with this one
            best_co_pid = None
            best_co_count = 0
            for co_pid, count in co_occur[p.id].items():
                if count > best_co_count:
                    best_co_count = count
                    best_co_pid = co_pid

            if best_co_pid is not None:
                co_person = Person.query.get(best_co_pid)
                co_name = co_person.name if co_person else "Another Person"
                ratio = best_co_count / p_photos

                if ratio >= 0.70:
                    suggested_name = "Family"
                    reason = f"Appears in {int(ratio * 100)}% of photos alongside '{co_name}'."
                    confidence = float(round(ratio, 2))
                    suggestions.append({
                        "person_id": p.id,
                        "current_name": p.name,
                        "suggested_name": suggested_name,
                        "confidence": confidence,
                        "reason": reason
                    })
                elif ratio >= 0.40:
                    suggested_name = "Close Friend"
                    reason = f"Appears in {int(ratio * 100)}% of photos alongside '{co_name}'."
                    confidence = float(round(ratio, 2))
                    suggestions.append({
                        "person_id": p.id,
                        "current_name": p.name,
                        "suggested_name": suggested_name,
                        "confidence": confidence,
                        "reason": reason
                    })

            # Placeholder fallback if no co-occurrence but has photos
            if p.id not in [s["person_id"] for s in suggestions] and p_photos > 1:
                suggestions.append({
                    "person_id": p.id,
                    "current_name": p.name,
                    "suggested_name": "Frequent Guest",
                    "confidence": 0.50,
                    "reason": f"Appears independently in {p_photos} photos."
                })

        return jsonify(suggestions), 200
    except Exception as exc:
        logger.exception("Failed to generate cluster suggestions")
        return jsonify({"error": str(exc)}), 500


# ── PUT /api/faces/person/<id> ──────────────────────────────────────────

@bp.route("/person/<int:person_id>", methods=["PUT"])
@token_required
def rename_person(person_id):
    """Rename a person profile (e.g., when renaming an auto-generated cluster)."""
    data = request.get_json(silent=True) or {}
    new_name = data.get("name", "").strip()

    if not new_name:
        return jsonify({"error": "name is required"}), 400

    person = Person.query.filter_by(id=person_id, user_id=g.current_user.id).first()
    if not person:
        return jsonify({"error": "Person not found"}), 404

    try:
        person.name = new_name
        person.initials = _make_initials(new_name)
        db.session.commit()
        return jsonify(person.to_dict()), 200
    except Exception as exc:
        db.session.rollback()
        logger.exception("Failed to rename person %d", person_id)
        return jsonify({"error": str(exc)}), 500


