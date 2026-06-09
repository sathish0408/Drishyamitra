import React, { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import { GP } from "../../styles/theme";
import Avatar from "../common/Avatar";
import PersonPhotosModal from "../gallery/PersonPhotosModal";
import PhotoDetailModal from "../gallery/PhotoDetailModal";

function ClusterAlbumModal({ cluster, onClose, onSaveLabel, saving }) {
  const [name, setName] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  
  useEffect(() => {
    const handler = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex",
      alignItems: "center", justifyContent: "center", animation: "fadeIn 0.2s"
    }}>
      <div style={{
        background: GP.white, borderRadius: 20, width: "90%", maxWidth: 640,
        height: "80vh", display: "flex", flexDirection: "column", padding: 24,
        position: "relative", boxShadow: GP.shadow3, animation: "scaleIn 0.25s cubic-bezier(0.34,1.56,0.64,1)"
      }} onClick={e => e.stopPropagation()}>
        
        <button onClick={onClose} style={{
          position: "absolute", right: 20, top: 20, border: "none",
          background: "none", fontSize: 20, cursor: "pointer", color: GP.textSecondary
        }}>✕</button>

        <h3 style={{ fontSize: 18, fontWeight: 700, color: GP.textPrimary, marginBottom: 6 }}>
          Group of Similar Faces
        </h3>
        <p style={{ fontSize: 13, color: GP.textSecondary, marginBottom: 20 }}>
          We found {cluster.faces?.length || 1} similar face(s). Name them to add to your people collection.
        </p>

        {/* Label input form */}
        <form onSubmit={(e) => { e.preventDefault(); onSaveLabel(cluster.face_ids, name); }} style={{
          display: "flex", gap: 10, marginBottom: 20, background: GP.surface, padding: 16, borderRadius: 16
        }}>
          <input
            style={{
              flex: 1, padding: "11px 16px", border: `1px solid ${GP.border}`,
              borderRadius: 24, fontSize: 13, background: GP.white, color: GP.textPrimary
            }}
            placeholder="Name this person (e.g. Priya, Sathish)…"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={saving}
            autoFocus
          />
          <button
            type="submit"
            disabled={saving || !name.trim()}
            style={{
              padding: "11px 24px", background: (saving || !name.trim()) ? GP.surface : GP.blue,
              color: (saving || !name.trim()) ? GP.textTertiary : "#fff", border: "none",
              borderRadius: 24, fontSize: 13, fontWeight: 600, cursor: (saving || !name.trim()) ? "not-allowed" : "pointer"
            }}
          >
            {saving ? "Saving…" : "Save Label"}
          </button>
        </form>

        {/* Face Crop Grid */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div style={{ fontSize: 12, color: GP.textTertiary, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>Photos in this Group</div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
            gap: 12
          }}>
            {cluster.faces?.map(f => (
              <div 
                key={f.id} 
                onClick={() => setSelectedPhoto({
                  id: f.photo_id,
                  name: f.filename || `Face crop ${f.id}`,
                  url: f.photo_url || `http://localhost:5000/api/photos/file/${f.filename}`
                })}
                title="Click to view full image"
                style={{
                  position: "relative", paddingBottom: "100%", height: 0,
                  borderRadius: 12, overflow: "hidden", background: GP.surface,
                  border: `1px solid ${GP.borderLight}`, boxShadow: GP.shadow1,
                  cursor: "pointer"
                }}
              >
                <img
                  src={f.photo_url || `http://localhost:5000/api/faces/crop/${f.id}`}
                  alt="Match preview"
                  style={{
                    position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
                    objectFit: "contain", transition: "transform 0.3s"
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.08)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                />
              </div>
            ))}
          </div>
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

export default function PeoplePage({ showNotif, setPage, setShareParams }) {
  const [persons, setPersons] = useState([]);
  const [unrecognized, setUnrecognized] = useState([]);
  const [viewingCluster, setViewingCluster] = useState(null);
  const [viewingPerson, setViewingPerson] = useState(null);
  const [savingLabel, setSavingLabel] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const pList = await api.faces.persons();
      setPersons(pList);
      
      const unrecognisedList = await api.faces.unrecognized();
      setUnrecognized(unrecognisedList);
    } catch (err) {
      showNotif("Failed to load people and face data.", "error");
    }
  }, [showNotif]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function saveLabel(faceIds, name) {
    if (!name.trim()) return;
    setSavingLabel(true);
    try {
      const res = await api.faces.label(faceIds, name);
      showNotif(`Group successfully labeled as "${name}"! Auto-linked ${res.auto_linked} other faces.`, "success");
      setViewingCluster(null);
      loadData();
    } catch (err) {
      showNotif("Failed to save face label.", "error");
    } finally {
      setSavingLabel(false);
    }
  }

  async function handleDeletePerson(personId, personName) {
    try {
      await api.faces.deletePerson(personId);
      showNotif(`Person "${personName}" deleted successfully. Associated faces are now unrecognized.`, "success");
      loadData();
    } catch (err) {
      showNotif(`Failed to delete person "${personName}".`, "error");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, flex: 1, color: GP.textPrimary }}>People & Faces</h2>
      </div>

      {/* Unrecognized Face Clusters */}
      <div style={{ background: GP.white, borderRadius: 16, padding: "20px 24px", boxShadow: GP.shadow1, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: GP.textPrimary, marginBottom: 4 }}>Unrecognized Faces</div>
        <div style={{ fontSize: 12, color: GP.textSecondary, marginBottom: 16 }}>Label groups of similar faces to build your recognized library</div>
        
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {unrecognized.map((cluster) => (
            <div key={cluster.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div 
                onClick={() => setViewingCluster(cluster)}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: "50%",
                  background: GP.surface,
                  border: `2px solid ${GP.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  overflow: "hidden",
                  position: "relative",
                  boxShadow: GP.shadow1,
                  transition: "transform 0.15s"
                }}
                onMouseEnter={e => e.currentTarget.style.transform = "scale(1.06)"}
                onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
              >
                <img 
                  src={`http://localhost:5000/api/faces/crop/${cluster.id}`} 
                  alt="Representative face" 
                  style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                  onError={(e) => { e.currentTarget.style.opacity = 0.4; }}
                />
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  background: "rgba(0,0,0,0.65)", color: "#fff",
                  fontSize: 9, fontWeight: 700, padding: "2px 0", textAlign: "center"
                }}>
                  {cluster.face_ids?.length || 1} photo{cluster.face_ids?.length !== 1 ? "s" : ""}
                </div>
              </div>
              
              <button
                onClick={() => setViewingCluster(cluster)}
                style={{
                  padding: "4px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: GP.blueLight,
                  color: GP.blue,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >Label</button>
            </div>
          ))}
          
          {unrecognized.length === 0 && (
            <div style={{ fontSize: 13, color: GP.textSecondary, padding: "10px 0" }}>
              🎉 All detected faces have been successfully recognized!
            </div>
          )}
        </div>
      </div>

      {/* Person grid */}
      <h3 style={{ fontSize: 15, fontWeight: 600, color: GP.textPrimary, marginBottom: 16 }}>Recognized People</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
        {persons.map((p, i) => (
          <div key={p.id} className="person-card" onClick={() => setViewingPerson(p)} style={{
            background: GP.white,
            borderRadius: 16,
            padding: "20px 16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            cursor: "pointer",
            boxShadow: GP.shadow1,
            transition: "all 0.25s",
            opacity: p.name === "Unknown" ? 0.6 : 1,
            animation: `fadeUp ${0.3 + i * 0.06}s ease both`,
            position: "relative",
          }}>
            {p.name !== "Unknown" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Are you sure you want to delete "${p.name}"? This will make their faces unrecognized again.`)) {
                    handleDeletePerson(p.id, p.name);
                  }
                }}
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  border: "none",
                  background: "none",
                  fontSize: 14,
                  cursor: "pointer",
                  color: GP.textTertiary,
                  transition: "color 0.2s, transform 0.2s",
                  padding: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = GP.coral;
                  e.currentTarget.style.transform = "scale(1.15)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = GP.textTertiary;
                  e.currentTarget.style.transform = "scale(1)";
                }}
                title={`Delete ${p.name}`}
              >
                🗑️
              </button>
            )}
            <Avatar person={p} size={64} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: GP.textPrimary }}>{p.name}</div>
              <div style={{ color: GP.textTertiary, fontSize: 12, marginTop: 3 }}>{p.photoCount || p.photo_count || 0} photos</div>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
              {(p.tags || []).map(t => (
                <span key={t} style={{ padding: "3px 10px", background: p.bg, color: p.color, borderRadius: 20, fontSize: 11, fontWeight: 500 }}>{t}</span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <button
                onClick={(e) => { e.stopPropagation(); setViewingPerson(p); }}
                style={{ flex: 1, padding: "7px", background: GP.surface, border: `1px solid ${GP.border}`, borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", color: GP.textPrimary }}
              >View</button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShareParams({ targetType: "person", selectedPerson: p.name });
                  setPage("delivery");
                }}
                style={{ flex: 1, padding: "7px", background: GP.blueLight, border: "none", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", color: GP.blue }}
              >Share</button>
            </div>
          </div>
        ))}
      </div>

      {viewingCluster && (
        <ClusterAlbumModal
          cluster={viewingCluster}
          onClose={() => setViewingCluster(null)}
          onSaveLabel={saveLabel}
          saving={savingLabel}
        />
      )}

      {viewingPerson && (
        <PersonPhotosModal person={viewingPerson} onClose={() => setViewingPerson(null)} />
      )}
    </div>
  );
}
