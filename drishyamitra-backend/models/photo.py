"""
Photo model – core entity representing an uploaded image.
"""

from database.db import db
from datetime import datetime, timezone
import json


class Photo(db.Model):
    """Represents a single uploaded photo with metadata, tags, and face links."""

    __tablename__ = 'photos'

    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(512), nullable=False)
    size = db.Column(db.String(50), nullable=False)
    upload_date = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    date = db.Column(db.String(10), nullable=True)
    location = db.Column(db.String(255), nullable=True)
    description = db.Column(db.Text, nullable=True)
    tags = db.Column(db.JSON, default=list)
    favorite = db.Column(db.Boolean, default=False)
    height = db.Column(db.Integer, default=180)
    emoji = db.Column(db.String(10), default='📸')
    palette = db.Column(db.JSON, default=list)
    background_features = db.Column(db.JSON, default=list)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    faces = db.relationship('Face', backref='photo', lazy=True, cascade='all, delete-orphan')
    albums = db.relationship('Album', secondary='photo_album', back_populates='photos')

    def to_dict(self):
        """Return a JSON-serialisable dictionary suitable for the frontend gallery."""
        import os
        from utils.storage_helpers import get_backend_url
        base_url = get_backend_url()
        return {
            'id': self.id,
            'name': self.filename,
            'filename': self.filename,
            'file_path': self.file_path,
            'url': self.file_path if (self.file_path and self.file_path.startswith(('http://', 'https://'))) else (f"{base_url}/api/photos/file/{os.path.basename(self.file_path)}" if self.file_path else None),
            'size': self.size,
            'date': self.date,
            'upload_date': self.upload_date.isoformat() if self.upload_date else None,
            'location': self.location,
            'description': self.description,
            'tags': self.tags or [],
            'favorite': self.favorite,
            'height': self.height,
            'emoji': self.emoji,
            'palette': self.palette or ['#e8d5b7', '#d4a574'],
            'persons': [f.person.name for f in self.faces if f.person] if self.faces else [],
            'folder': (self.albums[0].name if self.albums else 'Uncategorized'),
            'album_names': [a.name for a in self.albums],
            'recognized': any(f.person_id is not None for f in self.faces) if self.faces else False,
        }
