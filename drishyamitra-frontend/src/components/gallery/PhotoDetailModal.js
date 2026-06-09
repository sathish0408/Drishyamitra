import React, { useEffect } from "react";
import { GP } from "../../styles/theme";
import IconBtn from "../common/IconBtn";
import { MOCK_PERSONS } from "../../constants/mockData";

export default function PhotoDetailModal({ photo, onClose, onDelete, onShare }) {
  useEffect(() => {
    const handler = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.85)",
      backdropFilter: "blur(10px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 200,
      padding: 20,
      animation: "fadeIn 0.2s",
    }}>
      <div style={{
        background: GP.white,
        borderRadius: 20,
        width: "90%",
        maxWidth: 850,
        maxHeight: "90vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        animation: "scaleIn 0.25s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${GP.border}` }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: GP.textPrimary }}>{photo.name}</span>
          <IconBtn onClick={onClose}>✕</IconBtn>
        </div>
        {/* Photo */}
        <div style={{
          height: "72vh",
          background: photo.url ? "#1a1a1a" : `linear-gradient(135deg, ${photo.palette?.[0] || "#e8d5b7"}, ${photo.palette?.[1] || "#d4a574"})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 80,
          overflow: "hidden",
        }}>
          {photo.url ? (
            <img src={photo.url} alt={photo.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          ) : (
            photo.emoji
          )}
        </div>
      </div>
    </div>
  );
}
