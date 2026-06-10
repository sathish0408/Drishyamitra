"""
Tests for the faces API routes.
Covers face clustering, single/bulk labeling, and face cropping.
"""

import unittest
import json
import os
import sys
from PIL import Image

# Ensure backend root is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app
from database.db import db
from models.photo import Photo
from models.face import Face
from models.person import Person


class FacesRouteTestCase(unittest.TestCase):
    """Test suite for /api/faces/* endpoints."""

    def setUp(self):
        """Create a fresh test app and database, and register a test user for auth."""
        self.app = create_app({
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "TESTING": True,
            "SECRET_KEY": "test-secret"
        })
        self.client = self.app.test_client()

        with self.app.app_context():
            db.create_all()

        # Register a test user for scoping and token headers
        res = self.client.post(
            "/api/auth/register",
            data=json.dumps({
                "username": "testuser",
                "email": "test@example.com",
                "password": "StrongP@ss1"
            }),
            content_type="application/json",
        )
        data = json.loads(res.data)
        self.token = data["token"]
        self.user_id = data["user"]["id"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def tearDown(self):
        """Drop all tables after each test."""
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_list_unrecognized_clustering(self):
        """Test clustering of unrecognized faces in GET /api/faces/"""
        with self.app.app_context():
            # Create a mock photo
            photo = Photo(
                filename="test.jpg",
                file_path="/uploads/test.jpg",
                size="100 KB",
                height=100,
                emoji="📸",
                user_id=self.user_id
            )
            db.session.add(photo)
            db.session.commit()

            # Create 3 unrecognized faces: face1 and face2 are similar, face3 is dissimilar.
            # Cosine similarity threshold is 0.60.
            vec1 = [1.0] + [0.0] * 511
            vec2 = [0.95] + [0.0] * 511  # very similar to vec1
            vec3 = [0.0, 1.0] + [0.0] * 510  # orthogonal/dissimilar

            face1 = Face(photo_id=photo.id, bounding_box={"x": 0, "y": 0, "w": 10, "h": 10}, embedding=vec1, confidence=0.99)
            face2 = Face(photo_id=photo.id, bounding_box={"x": 10, "y": 10, "w": 10, "h": 10}, embedding=vec2, confidence=0.95)
            face3 = Face(photo_id=photo.id, bounding_box={"x": 20, "y": 20, "w": 10, "h": 10}, embedding=vec3, confidence=0.9)

            db.session.add_all([face1, face2, face3])
            db.session.commit()

            f1_id = face1.id
            f2_id = face2.id
            f3_id = face3.id

        # Call the API to list unrecognized faces
        res = self.client.get("/api/faces/", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data)

        # We expect 2 clusters:
        # Cluster 1: [face1, face2]
        # Cluster 2: [face3]
        self.assertEqual(len(data), 2)
        
        # Verify cluster content
        cluster_map = {c["id"]: c for c in data}
        
        # The IDs are representative IDs (first face in each cluster)
        self.assertIn(f2_id, cluster_map)
        self.assertIn(f3_id, cluster_map)
        
        cluster1 = cluster_map[f2_id]
        cluster2 = cluster_map[f3_id]
        
        # Face 1 and Face 2 should be in cluster1
        self.assertEqual(len(cluster1["face_ids"]), 2)
        self.assertIn(f1_id, cluster1["face_ids"])
        
        # Verify photo_url is populated correctly
        self.assertIsNotNone(cluster1["faces"][0].get("photo_url"))
        self.assertTrue("api/photos/file/" in cluster1["faces"][0]["photo_url"])
        
        # Face 3 should be in cluster2
        self.assertEqual(len(cluster2["face_ids"]), 1)
        self.assertIn(f3_id, cluster2["face_ids"])

    def test_bulk_label_faces(self):
        """Test bulk labeling of faces using POST /api/faces/label"""
        with self.app.app_context():
            photo = Photo(
                filename="test.jpg",
                file_path="/uploads/test.jpg",
                size="100 KB",
                height=100,
                emoji="📸",
                user_id=self.user_id
            )
            db.session.add(photo)
            db.session.commit()

            # Create unrecognized faces
            face1 = Face(photo_id=photo.id, bounding_box={"x": 0, "y": 0, "w": 10, "h": 10}, embedding=[1.0] + [0.0]*511)
            face2 = Face(photo_id=photo.id, bounding_box={"x": 10, "y": 10, "w": 10, "h": 10}, embedding=[1.0] + [0.0]*511)
            face3 = Face(photo_id=photo.id, bounding_box={"x": 20, "y": 20, "w": 10, "h": 10}, embedding=[0.0, 1.0] + [0.0]*510)
            db.session.add_all([face1, face2, face3])
            db.session.commit()
            
            f1_id = face1.id
            f2_id = face2.id
            f3_id = face3.id

        # Bulk label face1 and face2 as "Alice"
        res = self.client.post(
            "/api/faces/label",
            data=json.dumps({
                "face_ids": [f1_id, f2_id],
                "name": "Alice"
            }),
            content_type="application/json",
            headers=self.headers
        )
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data)
        self.assertEqual(data["person"]["name"], "Alice")

        # Verify that both faces are now linked to Alice
        with self.app.app_context():
            person = Person.query.filter_by(name="Alice", user_id=self.user_id).first()
            self.assertIsNotNone(person)
            
            updated_face1 = Face.query.get(f1_id)
            updated_face2 = Face.query.get(f2_id)
            self.assertEqual(updated_face1.person_id, person.id)
            self.assertEqual(updated_face2.person_id, person.id)

    def test_single_label_face_backwards_compatibility(self):
        """Test that single face_id parameter works for POST /api/faces/label"""
        with self.app.app_context():
            photo = Photo(
                filename="test.jpg",
                file_path="/uploads/test.jpg",
                size="100 KB",
                height=100,
                emoji="📸",
                user_id=self.user_id
            )
            db.session.add(photo)
            db.session.commit()

            face = Face(photo_id=photo.id, bounding_box={"x": 0, "y": 0, "w": 10, "h": 10}, embedding=[1.0] + [0.0]*511)
            db.session.add(face)
            db.session.commit()
            f_id = face.id

        # Label face using single face_id param
        res = self.client.post(
            "/api/faces/label",
            data=json.dumps({
                "face_id": f_id,
                "name": "Bob"
            }),
            content_type="application/json",
            headers=self.headers
        )
        self.assertEqual(res.status_code, 200)
        
        with self.app.app_context():
            person = Person.query.filter_by(name="Bob", user_id=self.user_id).first()
            self.assertIsNotNone(person)
            updated_face = Face.query.get(f_id)
            self.assertEqual(updated_face.person_id, person.id)

    def test_crop_face_success(self):
        """Test GET /api/faces/crop/<face_id> returns cropped image"""
        test_dir = os.path.join(os.path.dirname(__file__), "test_assets")
        os.makedirs(test_dir, exist_ok=True)
        img_path = os.path.join(test_dir, "test_crop.jpg")
        
        # Create a simple red 100x100 image
        Image.new("RGB", (100, 100), color="red").save(img_path)

        try:
            with self.app.app_context():
                photo = Photo(
                    filename="test_crop.jpg",
                    file_path=img_path,
                    size="100 KB",
                    height=100,
                    emoji="📸",
                    user_id=self.user_id
                )
                db.session.add(photo)
                db.session.commit()

                face = Face(
                    photo_id=photo.id,
                    bounding_box={"x": 10, "y": 10, "w": 40, "h": 40},
                    embedding=[1.0] + [0.0]*511
                )
                db.session.add(face)
                db.session.commit()
                f_id = face.id

            res = self.client.get(f"/api/faces/crop/{f_id}", headers=self.headers)
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.mimetype, "image/png")
            # The body should be some non-empty PNG data
            self.assertGreater(len(res.data), 0)
        finally:
            if os.path.exists(img_path):
                os.remove(img_path)

    def test_delete_person_success(self):
        """Test DELETE /api/faces/person/<id> unlinks faces and deletes person"""
        with self.app.app_context():
            # Seed person, photo, and linked face
            person = Person(name="David", initials="D", color="#ffffff", bg="#000000", user_id=self.user_id)
            db.session.add(person)
            db.session.flush()
            
            photo = Photo(
                filename="test.jpg",
                file_path="/uploads/test.jpg",
                size="100 KB",
                height=100,
                emoji="📸",
                user_id=self.user_id
            )
            db.session.add(photo)
            db.session.flush()

            face = Face(photo_id=photo.id, person_id=person.id, bounding_box={"x": 0, "y": 0, "w": 10, "h": 10}, embedding=[1.0] + [0.0]*511)
            db.session.add(face)
            db.session.commit()
            
            p_id = person.id
            f_id = face.id

        # Delete the person
        res = self.client.delete(f"/api/faces/person/{p_id}", headers=self.headers)
        self.assertEqual(res.status_code, 200)

        # Verify person is deleted and face is unlinked (person_id is None)
        with self.app.app_context():
            deleted_person = Person.query.get(p_id)
            self.assertIsNone(deleted_person)
            
            unlinked_face = Face.query.get(f_id)
            self.assertIsNotNone(unlinked_face)
            self.assertIsNone(unlinked_face.person_id)

    def test_delete_person_not_found(self):
        """Test DELETE /api/faces/person/<id> with non-existent ID returns 404"""
        res = self.client.delete("/api/faces/person/9999", headers=self.headers)
        self.assertEqual(res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
