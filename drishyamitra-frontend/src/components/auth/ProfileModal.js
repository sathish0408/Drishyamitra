import React, { useState, useEffect, useRef } from "react";
import { api, BACKEND_URL } from "../../api";
import { GP } from "../../styles/theme";
import IconBtn from "../common/IconBtn";
import Spinner from "../common/Spinner";

export default function ProfileModal({ onClose, currentUser, setCurrentUser, onLogout, showNotif }) {
  const [username, setUsername] = useState(currentUser?.username || "");
  const [email, setEmail] = useState(currentUser?.email || "");
  const [phone, setPhone] = useState(currentUser?.phone || "");
  const [address, setAddress] = useState(currentUser?.address || "");
  const [bio, setBio] = useState(currentUser?.bio || "");
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef();

  useEffect(() => {
    const handler = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("username", username);
      formData.append("email", email);
      formData.append("phone", phone);
      formData.append("address", address);
      formData.append("bio", bio);
      if (selectedFile) {
        formData.append("profile_pic", selectedFile);
      }

      const res = await api.auth.updateProfile(formData);
      setCurrentUser(res.user);
      showNotif("Profile updated successfully!", "success");
      onClose();
    } catch (err) {
      console.error(err);
      showNotif(err.response?.data?.error || "Failed to update profile.", "error");
    } finally {
      setLoading(false);
    }
  };

  const avatarUrl = previewUrl || (currentUser?.profile_pic 
    ? (currentUser.profile_pic.startsWith("http") ? currentUser.profile_pic : `${BACKEND_URL}${currentUser.profile_pic}`)
    : null);

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.55)",
      backdropFilter: "blur(6px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
      padding: 24,
      animation: "fadeIn 0.2s",
    }}>
      <div style={{
        background: GP.white,
        borderRadius: 20,
        width: "100%",
        maxWidth: 460,
        maxHeight: "90vh",
        overflowY: "auto",
        animation: "scaleIn 0.25s cubic-bezier(0.34,1.56,0.64,1)",
        boxShadow: GP.shadow3,
        display: "flex",
        flexDirection: "column",
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "18px 24px", borderBottom: `1px solid ${GP.border}` }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: GP.textPrimary, flex: 1 }}>Profile Settings</h3>
          <IconBtn onClick={onClose}>✕</IconBtn>
        </div>

        <form onSubmit={handleSave} style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Avatar Upload */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div 
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: 96,
                height: 96,
                borderRadius: "50%",
                background: `linear-gradient(135deg, ${GP.blue}, ${GP.purple})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 36,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: GP.shadow2,
                overflow: "hidden",
                position: "relative",
              }}
              onMouseEnter={e => {
                const overlay = e.currentTarget.querySelector('.avatar-overlay');
                if (overlay) overlay.style.opacity = '1';
              }}
              onMouseLeave={e => {
                const overlay = e.currentTarget.querySelector('.avatar-overlay');
                if (overlay) overlay.style.opacity = '0';
              }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                (username || "A").charAt(0).toUpperCase()
              )}
              <div 
                className="avatar-overlay"
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0,0,0,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: 20,
                  opacity: 0,
                  transition: "opacity 0.2s",
                }}
              >
                📷
              </div>
            </div>
            <input 
              ref={fileInputRef}
              type="file" 
              accept="image/*" 
              style={{ display: "none" }} 
              onChange={handleFileChange} 
            />
            <span style={{ fontSize: 12, color: GP.textSecondary }}>Click avatar to change picture</span>
          </div>

          {/* Form Fields */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: GP.textSecondary, textTransform: "uppercase" }}>Username</label>
              <input 
                type="text" 
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                style={{
                  padding: "11px 16px",
                  border: `1px solid ${GP.border}`,
                  borderRadius: 12,
                  fontSize: 13,
                  color: GP.textPrimary,
                  background: GP.surface,
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: GP.textSecondary, textTransform: "uppercase" }}>Email Address</label>
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                style={{
                  padding: "11px 16px",
                  border: `1px solid ${GP.border}`,
                  borderRadius: 12,
                  fontSize: 13,
                  color: GP.textPrimary,
                  background: GP.surface,
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: GP.textSecondary, textTransform: "uppercase" }}>Phone Number</label>
              <input 
                type="text" 
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="e.g. +91 98765 43210"
                style={{
                  padding: "11px 16px",
                  border: `1px solid ${GP.border}`,
                  borderRadius: 12,
                  fontSize: 13,
                  color: GP.textPrimary,
                  background: GP.surface,
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: GP.textSecondary, textTransform: "uppercase" }}>Address</label>
              <input 
                type="text" 
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="e.g. Mumbai, India"
                style={{
                  padding: "11px 16px",
                  border: `1px solid ${GP.border}`,
                  borderRadius: 12,
                  fontSize: 13,
                  color: GP.textPrimary,
                  background: GP.surface,
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: GP.textSecondary, textTransform: "uppercase" }}>Bio</label>
              <textarea 
                value={bio}
                onChange={e => setBio(e.target.value)}
                placeholder="Tell us about yourself…"
                rows={3}
                style={{
                  padding: "11px 16px",
                  border: `1px solid ${GP.border}`,
                  borderRadius: 12,
                  fontSize: 13,
                  color: GP.textPrimary,
                  background: GP.surface,
                  resize: "none",
                }}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <button 
                type="button" 
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 12,
                  background: GP.surface,
                  border: `1px solid ${GP.border}`,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  color: GP.textPrimary,
                  transition: "background 0.15s",
                }}
              >
                Cancel
              </button>
              <button 
                type="submit"
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 12,
                  background: GP.blue,
                  color: "#fff",
                  border: "none",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  transition: "background 0.15s",
                  boxShadow: GP.shadow2,
                }}
              >
                {loading ? <Spinner /> : "Save Changes"}
              </button>
            </div>
            
            <button 
              type="button" 
              onClick={onLogout}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: 12,
                background: GP.coralLight,
                border: `1px solid ${GP.coral}30`,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: GP.coral,
                transition: "all 0.15s",
                marginTop: 6,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = GP.coral; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = GP.coralLight; e.currentTarget.style.color = GP.coral; }}
            >
              Sign Out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
