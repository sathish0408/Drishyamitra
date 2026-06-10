import React, { useState, useEffect, useCallback } from "react";
import { api, BACKEND_URL } from "../../api";
import { GP } from "../../styles/theme";
import Avatar from "../common/Avatar";
import PhotoDetailModal from "./PhotoDetailModal";

export default function PersonPhotosModal({ person, onClose, showNotif }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState([]);
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "carousel"
  const [carouselIndex, setCarouselIndex] = useState(0);

  const handleBulkDelete = async () => {
    if (window.confirm(`Are you sure you want to remove ${selectedPhotoIds.length} photos from this person's gallery?`)) {
      setLoading(true);
      try {
        await api.photos.dissociateLabel(selectedPhotoIds, person.id);
        if (showNotif) showNotif(`Successfully removed ${selectedPhotoIds.length} photos from ${person.name}.`, "success");
        setSelectedPhotoIds([]);
        setSelectMode(false);
        const res = await api.faces.personPhotos(person.id);
        setPhotos(res.photos || []);
      } catch (err) {
        if (showNotif) showNotif("Failed to remove selected photos.", "error");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRemovePhoto = async (photoId) => {
    try {
      await api.photos.dissociateLabel([photoId], person.id);
      if (showNotif) showNotif("Photo removed from person successfully.", "success");
      
      const res = await api.faces.personPhotos(person.id);
      const newPhotos = res.photos || [];
      
      if (newPhotos.length === 0) {
        setSelectedPhotoIndex(null);
      } else {
        setSelectedPhotoIndex(prevIdx => Math.min(prevIdx, newPhotos.length - 1));
      }
      setPhotos(newPhotos);
    } catch (err) {
      if (showNotif) showNotif("Failed to remove photo.", "error");
    }
  };

  const handleReLabel = async (photoId, newLabelName) => {
    try {
      // Update local state behind the scenes to explicitly prevent parent component from unmounting
      setPhotos(prevPhotos => {
        const newPhotos = prevPhotos.filter(p => p.id !== photoId);
        
        // Clamp the active index to keep the gallery view open and stable
        if (newPhotos.length === 0) {
          setSelectedPhotoIndex(null);
        } else {
          setSelectedPhotoIndex(prevIdx => 
            prevIdx !== null ? Math.min(prevIdx, newPhotos.length - 1) : null
          );
        }
        
        return newPhotos;
      });

      if (showNotif) showNotif(`Successfully assigned photo to ${newLabelName}`, "success");
    } catch (err) {
      console.error("Failed to handle relabel state update:", err);
    }
  };

  const handleSelectPhoto = (id) => {
    setSelectedPhotoIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

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

  const handleCarouselPrev = useCallback(() => {
    if (photos.length > 0) {
      setCarouselIndex(prev => (prev - 1 + photos.length) % photos.length);
    }
  }, [photos]);

  const handleCarouselNext = useCallback(() => {
    if (photos.length > 0) {
      setCarouselIndex(prev => (prev + 1) % photos.length);
    }
  }, [photos]);

  useEffect(() => {
    if (viewMode !== "carousel" || selectedPhotoIndex !== null) return;
    const handler = e => {
      if (e.key === "ArrowLeft") {
        handleCarouselPrev();
      } else if (e.key === "ArrowRight") {
        handleCarouselNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode, selectedPhotoIndex, handleCarouselPrev, handleCarouselNext]);

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
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: GP.textPrimary, margin: 0 }}>{person.name}</h3>
            <div style={{ fontSize: 12, color: GP.textTertiary, marginTop: 4 }}>{photos.length} photos found</div>
          </div>
          {selectMode ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleBulkDelete}
                disabled={selectedPhotoIds.length === 0}
                style={{
                  background: GP.coral, color: "#fff", border: "none", borderRadius: 20,
                  padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: selectedPhotoIds.length === 0 ? "not-allowed" : "pointer",
                  boxShadow: GP.shadow1, opacity: selectedPhotoIds.length === 0 ? 0.6 : 1
                }}
              >
                Delete Selected
              </button>
              <button
                onClick={() => { setSelectMode(false); setSelectedPhotoIds([]); }}
                style={{ background: "#dadce0", color: GP.textPrimary, border: "none", borderRadius: 20, padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center" }}>
              {!selectMode && photos.length > 1 && (
                <div style={{ display: "flex", background: GP.borderLight, borderRadius: 20, padding: 2, marginRight: 8 }}>
                  <button
                    onClick={() => setViewMode("grid")}
                    style={{
                      background: viewMode === "grid" ? GP.white : "transparent",
                      color: viewMode === "grid" ? GP.blue : GP.textSecondary,
                      border: "none", borderRadius: 18, padding: "6px 14px",
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                      boxShadow: viewMode === "grid" ? GP.shadow1 : "none",
                      transition: "all 0.15s"
                    }}
                  >
                    Grid
                  </button>
                  <button
                    onClick={() => setViewMode("carousel")}
                    style={{
                      background: viewMode === "carousel" ? GP.white : "transparent",
                      color: viewMode === "carousel" ? GP.blue : GP.textSecondary,
                      border: "none", borderRadius: 18, padding: "6px 14px",
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                      boxShadow: viewMode === "carousel" ? GP.shadow1 : "none",
                      transition: "all 0.15s"
                    }}
                  >
                    Carousel
                  </button>
                </div>
              )}
              <button
                onClick={() => setSelectMode(true)}
                style={{ background: "#f1f3f4", color: GP.textPrimary, border: "none", borderRadius: 20, padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Select
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40, color: GP.textSecondary, fontSize: 13 }}>Loading photos…</div>
          ) : photos.length === 0 ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40, color: GP.textSecondary, fontSize: 13 }}>No photos found for this person.</div>
          ) : viewMode === "carousel" ? (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
              <style>{`
                @keyframes fadePhotoCarousel {
                  from { opacity: 0; transform: scale(0.98); }
                  to { opacity: 1; transform: scale(1); }
                }
                .photo-fade-carousel {
                  animation: fadePhotoCarousel 0.2s ease-out forwards;
                }
              `}</style>
              <div style={{
                flex: 1,
                minHeight: "35vh",
                maxHeight: "45vh",
                background: "#1a1a1a",
                borderRadius: 16,
                overflow: "hidden",
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: GP.shadow2,
              }}>
                {photos.length > 1 && (
                  <button
                    onClick={handleCarouselPrev}
                    style={{
                      position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                      background: "rgba(255,255,255,0.15)", color: "#fff",
                      borderRadius: "50%", width: 40, height: 40, fontSize: 18, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10,
                      backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.2)",
                      transition: "all 0.2s"
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.3)";
                      e.currentTarget.style.transform = "translateY(-50%) scale(1.1)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.15)";
                      e.currentTarget.style.transform = "translateY(-50%) scale(1)";
                    }}
                  >
                    ◀
                  </button>
                )}

                <img
                  key={photos[carouselIndex]?.id}
                  className="photo-fade-carousel"
                  src={photos[carouselIndex]?.url || `${BACKEND_URL}/api/photos/file/${photos[carouselIndex]?.filename}`}
                  alt={photos[carouselIndex]?.filename}
                  style={{ width: "100%", height: "100%", objectFit: "contain", cursor: "pointer" }}
                  onClick={() => setSelectedPhotoIndex(carouselIndex)}
                />

                {photos.length > 1 && (
                  <button
                    onClick={handleCarouselNext}
                    style={{
                      position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                      background: "rgba(255,255,255,0.15)", color: "#fff",
                      borderRadius: "50%", width: 40, height: 40, fontSize: 18, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10,
                      backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.2)",
                      transition: "all 0.2s"
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.3)";
                      e.currentTarget.style.transform = "translateY(-50%) scale(1.1)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.15)";
                      e.currentTarget.style.transform = "translateY(-50%) scale(1)";
                    }}
                  >
                    ▶
                  </button>
                )}
              </div>

              <div style={{
                display: "flex",
                gap: 8,
                overflowX: "auto",
                padding: "4px 0 8px 0",
                scrollbarWidth: "thin"
              }}>
                {photos.map((p, idx) => {
                  const isActive = idx === carouselIndex;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setCarouselIndex(idx)}
                      style={{
                        width: 60,
                        height: 60,
                        flexShrink: 0,
                        borderRadius: 8,
                        overflow: "hidden",
                        border: `2px solid ${isActive ? GP.blue : "transparent"}`,
                        cursor: "pointer",
                        opacity: isActive ? 1 : 0.6,
                        transition: "all 0.2s",
                        boxShadow: isActive ? GP.shadow2 : GP.shadow1,
                      }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.opacity = 0.9; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.opacity = 0.6; }}
                    >
                      <img
                        src={p.url || `${BACKEND_URL}/api/photos/file/${p.filename}`}
                        alt="Thumbnail"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
              gap: 12
            }}>
              {photos.map(p => {
                const isSelected = selectedPhotoIds.includes(p.id);
                return (
                <div 
                  key={p.id} 
                  onClick={() => selectMode ? handleSelectPhoto(p.id) : setSelectedPhotoIndex(photos.indexOf(p))}
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
                    src={p.url || `${BACKEND_URL}/api/photos/file/${p.filename}`}
                    alt={p.filename}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      transform: isSelected ? "scale(0.85)" : "scale(1)",
                      borderRadius: isSelected ? 8 : 0,
                      transition: "all 0.2s ease"
                    }}
                  />
                  {selectMode && (
                    <div style={{
                      position: "absolute", top: 8, left: 8, width: 22, height: 22,
                      borderRadius: "50%", border: `2px solid ${isSelected ? GP.blue : "#fff"}`,
                      background: isSelected ? GP.blue : "rgba(0,0,0,0.3)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", fontSize: 14, fontWeight: "bold", zIndex: 10
                    }}>
                      {isSelected && "✓"}
                    </div>
                  )}
                </div>
              );})}
            </div>
          )}
        </div>
      </div>

      {selectedPhotoIndex !== null && (
        <PhotoDetailModal
          photos={photos}
          currentIndex={selectedPhotoIndex}
          onIndexChange={setSelectedPhotoIndex}
          onClose={() => setSelectedPhotoIndex(null)}
          onDelete={handleRemovePhoto}
          onReLabel={handleReLabel}
        />
      )}
    </div>
  );
}
