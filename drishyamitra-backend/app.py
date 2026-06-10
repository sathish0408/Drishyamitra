"""
Drishyamitra Backend — Flask Application Entrypoint
====================================================
Agentic AI-powered photo management system.

Starts the Flask server, registers all blueprints, initialises the database,
and seeds default albums so the frontend can display them immediately.
"""

import os
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Load .env BEFORE anything references os.environ
# ---------------------------------------------------------------------------
load_dotenv()


def create_app(test_config=None):
    """Application factory — builds and configures the Flask app."""

    app = Flask(__name__)

    # ── Configuration ──────────────────────────────────────────────────────
    from config import Config
    app.config.from_object(Config)
    if test_config is not None:
        app.config.from_mapping(test_config)

    # ── CORS — allow React dev server (port 3000) ─────────────────────────
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # ── Database ───────────────────────────────────────────────────────────
    from database.db import db
    db.init_app(app)

    # ── Ensure upload directory exists ─────────────────────────────────────
    upload_dir = app.config.get("UPLOAD_FOLDER", "uploads")
    os.makedirs(upload_dir, exist_ok=True)

    # ── Register Blueprints ────────────────────────────────────────────────
    from routes.auth import bp as auth_bp
    from routes.photos import bp as photos_bp
    from routes.faces import bp as faces_bp
    from routes.albums import bp as albums_bp
    from routes.chat import bp as chat_bp
    from routes.analytics import bp as analytics_bp
    from routes.share import bp as share_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(photos_bp)
    app.register_blueprint(faces_bp)
    app.register_blueprint(albums_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(share_bp)

    # ── Create tables & seed defaults ──────────────────────────────────────
    with app.app_context():
        # Import all models so SQLAlchemy knows about them
        import models  # noqa: F401
        _run_db_migrations(app)
        _run_universal_db_migrations(db)
        db.create_all()
        _seed_default_user(db)
        _backfill_legacy_user_ids(db)

    # ── Health-check route ─────────────────────────────────────────────────
    @app.route("/api/health")
    def health():
        return jsonify({"status": "ok", "service": "drishyamitra-backend"})

    # ── Error handlers ─────────────────────────────────────────────────────
    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Resource not found"}), 404

    @app.errorhandler(500)
    def internal_error(e):
        return jsonify({"error": "Internal server error"}), 500

    return app


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

# Default albums matching the frontend FOLDERS constant in App.js
DEFAULT_ALBUMS = [
    {"name": "Family Trips",  "icon": "✈️", "color": "#1a73e8", "bg": "#e8f0fe"},
    {"name": "Weddings",      "icon": "💍", "color": "#e8453c", "bg": "#fce8e6"},
    {"name": "Festivals",     "icon": "🎉", "color": "#f9ab00", "bg": "#fef7e0"},
    {"name": "Birthdays",     "icon": "🎂", "color": "#00897b", "bg": "#e0f2f1"},
    {"name": "Anniversaries", "icon": "❤️", "color": "#e91e63", "bg": "#fde8ef"},
    {"name": "Events",        "icon": "📸", "color": "#9334e6", "bg": "#f3e8fd"},
]


def _run_db_migrations(app):
    """Check if SQLite database exists and migrate schema if user_id columns are missing."""
    import sqlite3
    import logging
    logger = logging.getLogger(__name__)

    db_uri = app.config.get("SQLALCHEMY_DATABASE_URI", "")
    if not db_uri.startswith("sqlite:///"):
        return

    db_path = db_uri.replace("sqlite:///", "")
    if not os.path.isabs(db_path):
        db_path = os.path.join(app.instance_path, db_path)

    if not os.path.exists(db_path):
        return

    logger.info("Running database migrations check on %s", db_path)
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check 'persons' table columns
        cursor.execute("PRAGMA table_info(persons)")
        columns = [row[1] for row in cursor.fetchall()]

        if "user_id" not in columns:
            logger.info("Migrating 'persons' table: adding user_id column")
            cursor.execute("ALTER TABLE persons ADD COLUMN user_id INTEGER REFERENCES users(id)")
            conn.commit()

        # Check 'albums' table columns
        cursor.execute("PRAGMA table_info(albums)")
        columns_albums = [row[1] for row in cursor.fetchall()]

        if "user_id" not in columns_albums:
            logger.info("Migrating 'albums' table: adding user_id column and UniqueConstraint")
            cursor.execute("PRAGMA foreign_keys=OFF")
            cursor.execute("BEGIN TRANSACTION")

            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='albums'")
            if cursor.fetchone():
                cursor.execute("""
                    CREATE TABLE albums_new (
                        id INTEGER NOT NULL PRIMARY KEY,
                        name VARCHAR(100) NOT NULL,
                        description VARCHAR(255),
                        icon VARCHAR(10),
                        color VARCHAR(20),
                        bg VARCHAR(20),
                        created_at DATETIME,
                        user_id INTEGER REFERENCES users(id),
                        CONSTRAINT _user_album_uc UNIQUE (name, user_id)
                    )
                """)
                cursor.execute("""
                    INSERT INTO albums_new (id, name, description, icon, color, bg, created_at, user_id)
                    SELECT id, name, description, icon, color, bg, created_at, NULL FROM albums
                """)
                cursor.execute("DROP TABLE albums")
                cursor.execute("ALTER TABLE albums_new RENAME TO albums")

            cursor.execute("COMMIT")
            cursor.execute("PRAGMA foreign_keys=ON")
            conn.commit()

        # Check 'photos' table columns for background_features
        cursor.execute("PRAGMA table_info(photos)")
        columns_photos = [row[1] for row in cursor.fetchall()]
        if "background_features" not in columns_photos:
            logger.info("Migrating 'photos' table: adding background_features column")
            cursor.execute("ALTER TABLE photos ADD COLUMN background_features TEXT")
            conn.commit()

        # Check 'delivery_history' table columns for error_message
        cursor.execute("PRAGMA table_info(delivery_history)")
        columns_dh = [row[1] for row in cursor.fetchall()]
        if "error_message" not in columns_dh:
            logger.info("Migrating 'delivery_history' table: adding error_message column")
            cursor.execute("ALTER TABLE delivery_history ADD COLUMN error_message TEXT")
            conn.commit()

        conn.close()
        logger.info("Database migration check completed successfully.")
    except Exception as exc:
        logger.exception("Database migration failed: %s", exc)


def _seed_default_albums(db, user_id):
    """Insert default albums for a specific user if they don't have albums."""
    from models.album import Album

    if Album.query.filter_by(user_id=user_id).first() is None:
        for data in DEFAULT_ALBUMS:
            album = Album(
                name=data["name"],
                icon=data["icon"],
                color=data["color"],
                bg=data["bg"],
                user_id=user_id
            )
            db.session.add(album)
        db.session.commit()


def _seed_default_user(db):
    """Insert a default admin user if the users table is empty."""
    from models.user import User
    from flask_bcrypt import generate_password_hash

    admin = User.query.filter_by(username="admin").first()
    if admin is None:
        hashed = generate_password_hash("password123").decode('utf-8')
        admin = User(
            username="admin",
            email="admin@example.com",
            password_hash=hashed,
            role="admin"
        )
        db.session.add(admin)
        db.session.commit()

    _seed_default_albums(db, admin.id)


def _backfill_legacy_user_ids(db):
    """Backfill user_id for legacy Person and Album records that have None/NULL values.
    If a user-scoped record with the same name already exists, the legacy records are merged."""
    import logging
    from models.person import Person
    from models.album import Album
    from models.photo import Photo
    from models.face import Face
    from models.user import User

    logger = logging.getLogger(__name__)

    try:
        # 1. Backfill legacy Person records
        persons_without_user = Person.query.filter(Person.user_id.is_(None)).all()
        for person in persons_without_user:
            # Find the user_id from the photos this person appears in
            photo_user_ids = db.session.query(Photo.user_id)\
                .join(Face, Face.photo_id == Photo.id)\
                .filter(Face.person_id == person.id)\
                .filter(Photo.user_id.isnot(None))\
                .distinct().all()
            
            target_user_id = None
            if photo_user_ids:
                target_user_id = photo_user_ids[0][0]
            else:
                # Fallback to the first user or admin
                first_user = User.query.first()
                if first_user:
                    target_user_id = first_user.id
            
            if target_user_id:
                # Check if a person with the same name and user_id already exists
                existing = Person.query.filter_by(name=person.name, user_id=target_user_id).first()
                if existing:
                    # Re-link all faces to the existing person
                    for face in person.faces:
                        face.person_id = existing.id
                    # Delete the legacy person
                    db.session.delete(person)
                    logger.info("Merged legacy person '%s' (ID %d) into existing person (ID %d) for user %d", person.name, person.id, existing.id, target_user_id)
                else:
                    person.user_id = target_user_id
                    logger.info("Migrated person '%s' (ID %d) to user_id %s", person.name, person.id, person.user_id)

        # 2. Backfill legacy Album records
        albums_without_user = Album.query.filter(Album.user_id.is_(None)).all()
        for album in albums_without_user:
            # Find user_id from photos in this album
            photo_user_ids = db.session.query(Photo.user_id)\
                .join(Photo.albums)\
                .filter(Album.id == album.id)\
                .filter(Photo.user_id.isnot(None))\
                .distinct().all()
            
            target_user_id = None
            if photo_user_ids:
                target_user_id = photo_user_ids[0][0]
            else:
                # Fallback to the first user or admin
                first_user = User.query.first()
                if first_user:
                    target_user_id = first_user.id
            
            if target_user_id:
                # Check if an album with the same name and user_id already exists
                existing = Album.query.filter_by(name=album.name, user_id=target_user_id).first()
                if existing:
                    # Move any photos from the legacy album to the existing album
                    for p in album.photos:
                        if p not in existing.photos:
                            existing.photos.append(p)
                    album.photos = []
                    # Delete the legacy album
                    db.session.delete(album)
                    logger.info("Merged legacy album '%s' (ID %d) into existing album (ID %d) for user %d", album.name, album.id, existing.id, target_user_id)
                else:
                    album.user_id = target_user_id
                    logger.info("Migrated album '%s' (ID %d) to user_id %s", album.name, album.id, album.user_id)

        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        logger.exception("Failed to backfill legacy user_ids: %s", exc)

def _run_universal_db_migrations(db):
    """Run migrations agnostically using SQLAlchemy's inspector to add missing columns in production."""
    import logging
    from sqlalchemy import inspect
    logger = logging.getLogger(__name__)

    try:
        inspector = inspect(db.engine)
        tables = inspector.get_table_names()
        logger.info("Universal Migrations: Found tables: %s", tables)

        # 1. Migrate 'faces' table
        if 'faces' in tables:
            cols = [col['name'] for col in inspector.get_columns('faces')]
            if 'is_manually_labeled' not in cols:
                logger.info("Universal Migrating 'faces': adding is_manually_labeled column")
                db.session.execute(db.text("ALTER TABLE faces ADD COLUMN is_manually_labeled BOOLEAN DEFAULT FALSE"))
                db.session.commit()

        # 2. Migrate 'persons' table
        if 'persons' in tables:
            cols = [col['name'] for col in inspector.get_columns('persons')]
            if 'user_id' not in cols:
                logger.info("Universal Migrating 'persons': adding user_id column")
                db.session.execute(db.text("ALTER TABLE persons ADD COLUMN user_id INTEGER REFERENCES users(id)"))
                db.session.commit()

        # 3. Migrate 'albums' table
        if 'albums' in tables:
            cols = [col['name'] for col in inspector.get_columns('albums')]
            if 'user_id' not in cols:
                logger.info("Universal Migrating 'albums': adding user_id column")
                db.session.execute(db.text("ALTER TABLE albums ADD COLUMN user_id INTEGER REFERENCES users(id)"))
                db.session.commit()

        # 4. Migrate 'photos' table
        if 'photos' in tables:
            cols = [col['name'] for col in inspector.get_columns('photos')]
            if 'background_features' not in cols:
                logger.info("Universal Migrating 'photos': adding background_features column")
                db.session.execute(db.text("ALTER TABLE photos ADD COLUMN background_features TEXT"))
                db.session.commit()

        # 5. Migrate 'delivery_history' table
        if 'delivery_history' in tables:
            cols = [col['name'] for col in inspector.get_columns('delivery_history')]
            if 'error_message' not in cols:
                logger.info("Universal Migrating 'delivery_history': adding error_message column")
                db.session.execute(db.text("ALTER TABLE delivery_history ADD COLUMN error_message TEXT"))
                db.session.commit()

    except Exception as exc:
        db.session.rollback()
        logger.exception("Universal DB migration failed: %s", exc)



app = create_app()

if __name__ == "__main__":
    print("\n[INFO] Drishyamitra Backend running on http://localhost:5000")
    print("[INFO] Photo management API ready\n")
    app.run(debug=True, host="0.0.0.0", port=5000)
