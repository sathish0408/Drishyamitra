"""
Person model – represents a named individual detected across photos.
"""

from database.db import db
from datetime import datetime, timezone


class Person(db.Model):
    """A recognised person whose face appears in one or more photos."""

    __tablename__ = 'persons'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    initials = db.Column(db.String(5), nullable=False)
    emoji = db.Column(db.String(10), default='👤')
    color = db.Column(db.String(20), default='#1a73e8')
    bg = db.Column(db.String(20), default='#e8f0fe')
    tags = db.Column(db.JSON, default=list)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    faces = db.relationship('Face', backref='person', lazy=True)

    @property
    def photo_count(self):
        """Return the number of *unique* photos this person appears in."""
        unique_photos = set(f.photo_id for f in self.faces)
        return len(unique_photos)

    def to_dict(self):
        """Return a JSON-serialisable dictionary for the frontend people panel."""
        import os
        photo_url = None
        if self.faces:
            first_face = self.faces[0]
            if first_face.photo:
                photo_url = f"http://localhost:5000/api/photos/file/{os.path.basename(first_face.photo.file_path)}"

        return {
            'id': self.id,
            'name': self.name,
            'initials': self.initials,
            'emoji': self.emoji,
            'color': self.color,
            'bg': self.bg,
            'tags': self.tags or [],
            'photoCount': self.photo_count,
            'photo_url': photo_url,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
