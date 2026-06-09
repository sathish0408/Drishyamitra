import React from "react";
import { GP } from "../../styles/theme";

export default function Avatar({ person, size = 48 }) {
  if (person.photo_url) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        border: `2px solid ${GP.white}`,
        boxShadow: GP.shadow1,
        flexShrink: 0,
      }}>
        <img 
          src={person.photo_url} 
          alt={person.name} 
          style={{ width: "100%", height: "100%", objectFit: "cover" }} 
        />
      </div>
    );
  }

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: person.bg,
      color: person.color,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: size * 0.38,
      fontWeight: 700,
      flexShrink: 0,
      border: `2px solid ${GP.white}`,
      boxShadow: GP.shadow1,
    }}>
      {person.initials}
    </div>
  );
}
