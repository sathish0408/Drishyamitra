import React, { useState, useEffect } from "react";
import { api } from "../../api";
import { GP } from "../../styles/theme";
import Avatar from "../common/Avatar";
import PhotoDetailModal from "./PhotoDetailModal";

export default function PersonPhotosModal({ person, onClose }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  useEffect(() => {
    api.faces.personPhotos(person.id)
      .then(res => {
        setPhotos(res.photos || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [person.id]);

  return (
    <div onClick={onClose} style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.55)",
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      animation: "fadeIn 0.2s"
    }}>
      <div style={{
        background: GP.white,
        borderRadius: 20,
        width: "90%",
        maxWidth: 640,
        height: "80vh",
        display: "flex",
        flexDirection: "column",
        padding: 24,
        position: "relative",
        boxShadow: GP.shadow3,
        animation: "scaleIn 0.25s cubic-bezier(0.34,1.56,0.64,1)"
      }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{
          position: "absolute",
          right: 20,
          top: 20,
          border: "none",
          background: "none",
          fontSize: 20,
          cursor: "pointer",
          color: GP.textSecondary
        }}>✕</button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <Avatar person={person} size={48} />
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: GP.textPrimary, margin: 0 }}>{person.name}</h3>
            <div style={{ fontSize: 12, color: GP.textTertiary, marginTop: 4 }}>{photos.length} photos found</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40, color: GP.textSecondary, fontSize: 13 }}>Loading photos…</div>
          ) : photos.length === 0 ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40, color: GP.textSecondary, fontSize: 13 }}>No photos found for this person.</div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
              gap: 12
            }}>
              {photos.map(p => (
                <div 
                  key={p.id} 
                  onClick={() => setSelectedPhoto(p)}
                  style={{
                    position: "relative",
                    paddingBottom: "100%",
                    height: 0,
                    borderRadius: 12,
                    overflow: "hidden",
                    background: GP.surface,
                    border: `1px solid ${GP.borderLight}`,
                    cursor: "pointer",
                    boxShadow: GP.shadow1,
                    transition: "transform 0.2s"
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.03)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                >
                  <img
                    src={p.url || `http://localhost:5000/api/photos/file/${p.filename}`}
                    alt={p.filename}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover"
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedPhoto && (
        <PhotoDetailModal
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
        />
      )}
    </div>
  );
}
