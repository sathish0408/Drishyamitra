import React, { useState, useEffect } from "react";
import { api } from "../../api";
import { GP } from "../../styles/theme";
import ProgressBar from "../common/ProgressBar";
import Spinner from "../common/Spinner";

export default function DeliveryPage({ showNotif, shareParams, setShareParams }) {
  const [to, setTo] = useState("");
  const [platform, setPlatform] = useState("email");
  const [targetType, setTargetType] = useState("person");
  const [selectedPerson, setSelectedPerson] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState("");
  const [selectedPhotoIds, setSelectedPhotoIds] = useState([]);
  
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  
  const [persons, setPersons] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [photos, setPhotos] = useState([]);
  
  const [localHistory, setLocalHistory] = useState([
    { id: 1, recipient: "mom@gmail.com", person: "Grandma", count: 12, time: "2 hours ago", platform: "email", status: "delivered" },
    { id: 2, recipient: "+91 98765 43210", person: "Priya Sharma", count: 8, time: "Yesterday", platform: "whatsapp", status: "delivered" },
    { id: 3, recipient: "rahul@work.com", person: "Rahul Verma", count: 5, time: "2 days ago", platform: "email", status: "delivered" },
  ]);

  useEffect(() => {
    if (shareParams) {
      if (shareParams.targetType) setTargetType(shareParams.targetType);
      if (shareParams.selectedPerson) setSelectedPerson(shareParams.selectedPerson);
      if (shareParams.selectedAlbum) setSelectedAlbum(shareParams.selectedAlbum);
      if (shareParams.selectedPhotoIds) setSelectedPhotoIds(shareParams.selectedPhotoIds);
      setShareParams(null);
    }
  }, [shareParams, setShareParams]);

  useEffect(() => {
    api.faces.persons().then(list => setPersons(list)).catch(err => console.error(err));
    api.albums.list().then(list => setAlbums(list)).catch(err => console.error(err));
    api.photos.list().then(list => setPhotos(list)).catch(err => console.error(err));
  }, []);

  function togglePhotoSelection(id) {
    setSelectedPhotoIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  async function send() {
    if (!to) return;

    let prompt = "";
    let displayLabel = "";
    let count = 0;

    if (targetType === "person") {
      if (!selectedPerson) return;
      prompt = platform === "whatsapp"
        ? `whatsapp photos of ${selectedPerson} to ${to}`
        : `email photos of ${selectedPerson} to ${to}`;
      displayLabel = selectedPerson;
      count = persons.find(p => p.name === selectedPerson)?.photoCount || persons.find(p => p.name === selectedPerson)?.photo_count || 5;
    } else if (targetType === "album") {
      if (!selectedAlbum) return;
      prompt = platform === "whatsapp"
        ? `whatsapp photos in album ${selectedAlbum} to ${to}`
        : `email photos in album ${selectedAlbum} to ${to}`;
      displayLabel = `Album: ${selectedAlbum}`;
      count = albums.find(a => a.name === selectedAlbum)?.count || albums.find(a => a.name === selectedAlbum)?.photo_count || 5;
    } else if (targetType === "photos") {
      if (selectedPhotoIds.length === 0) return;
      prompt = platform === "whatsapp"
        ? `whatsapp the selected photos to ${to}`
        : `email the selected photos to ${to}`;
      displayLabel = `${selectedPhotoIds.length} selected photos`;
      count = selectedPhotoIds.length;
    }

    setSending(true);
    setProgress(15);
    try {
      setProgress(55);
      const res = await api.chat.send(prompt, [], targetType === "photos" ? selectedPhotoIds : []);
      setProgress(90);

      const responseText = res.response || "";
      const isSuccess = responseText.toLowerCase().includes("successfully shared");

      setLocalHistory(prev => [
        {
          id: Date.now(),
          recipient: to,
          person: displayLabel,
          count: count,
          time: "Just now",
          platform,
          status: isSuccess ? "delivered" : "failed"
        },
        ...prev
      ]);
      setProgress(100);
      await new Promise(r => setTimeout(r, 200));

      if (isSuccess) {
        showNotif(`Photos sent successfully via sharing agent!`, "success");
        setTo("");
        setSelectedPerson("");
        setSelectedAlbum("");
        setSelectedPhotoIds([]);
      } else {
        showNotif(responseText || "Failed to share photos via agent.", "error");
      }
    } catch (err) {
      const errMsg = err?.response?.data?.response || err?.message || "Failed to share photos via agent.";
      showNotif(errMsg, "error");
    } finally {
      setSending(false);
      setProgress(0);
    }
  }

  const canSend = to && (
    (targetType === "person" && selectedPerson) ||
    (targetType === "album" && selectedAlbum) ||
    (targetType === "photos" && selectedPhotoIds.length > 0)
  );

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, color: GP.textPrimary, marginBottom: 24 }}>Share & Deliver Photos</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Send form */}
        <div style={{ background: GP.white, borderRadius: 16, padding: "24px", boxShadow: GP.shadow1 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20, color: GP.textPrimary }}>New Delivery</h3>

          {/* Platform toggle */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: GP.textTertiary, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Platform</div>
            <div style={{ display: "flex", gap: 8, background: GP.surface, borderRadius: 12, padding: 4 }}>
              {[["email", "✉ Email"], ["whatsapp", "💬 WhatsApp"]].map(([p, label]) => (
                <button key={p} type="button" onClick={() => setPlatform(p)} style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: 8,
                  border: "none",
                  background: platform === p ? GP.white : "transparent",
                  color: platform === p ? GP.blue : GP.textSecondary,
                  fontWeight: platform === p ? 600 : 400,
                  cursor: "pointer",
                  boxShadow: platform === p ? GP.shadow1 : "none",
                  transition: "all 0.2s",
                  fontSize: 13,
                }}>{label}</button>
              ))}
            </div>
          </div>

          {/* Recipient */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: GP.textTertiary, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
              {platform === "email" ? "Recipient Email" : "WhatsApp Number"}
            </div>
            <input
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder={platform === "email" ? "recipient@email.com" : "+91 98765 43210"}
              style={{
                width: "100%",
                padding: "11px 16px",
                border: `1px solid ${GP.border}`,
                borderRadius: 12,
                fontSize: 13,
                color: GP.textPrimary,
                background: GP.surface,
                transition: "border-color 0.15s",
              }}
              onFocus={e => e.target.style.borderColor = GP.blue}
              onBlur={e => e.target.style.borderColor = GP.border}
            />
          </div>

          {/* Share By Type Selector */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: GP.textTertiary, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Share Option</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                ["person", "👤 Person"],
                ["album", "📁 Album"],
                ["photos", "📸 Photos"]
              ].map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTargetType(t); }}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: `1px solid ${targetType === t ? GP.blue : GP.border}`,
                    background: targetType === t ? GP.blueLight : GP.white,
                    color: targetType === t ? GP.blue : GP.textSecondary,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s"
                  }}
                >{label}</button>
              ))}
            </div>
          </div>

          {/* Conditional Input Fields */}
          {targetType === "person" && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: GP.textTertiary, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Select Person's Photos</div>
              <select
                value={selectedPerson}
                onChange={e => setSelectedPerson(e.target.value)}
                style={{
                  width: "100%",
                  padding: "11px 16px",
                  border: `1px solid ${GP.border}`,
                  borderRadius: 12,
                  fontSize: 13,
                  color: GP.textPrimary,
                  background: GP.surface,
                  cursor: "pointer",
                }}
              >
                <option value="">Choose a person…</option>
                {persons.map(p => (
                  <option key={p.name} value={p.name}>{p.emoji} {p.name} ({p.photoCount || p.photo_count || 0} photos)</option>
                ))}
              </select>
            </div>
          )}

          {targetType === "album" && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: GP.textTertiary, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Select Album</div>
              <select
                value={selectedAlbum}
                onChange={e => setSelectedAlbum(e.target.value)}
                style={{
                  width: "100%",
                  padding: "11px 16px",
                  border: `1px solid ${GP.border}`,
                  borderRadius: 12,
                  fontSize: 13,
                  color: GP.textPrimary,
                  background: GP.surface,
                  cursor: "pointer",
                }}
              >
                <option value="">Choose an album…</option>
                {albums.map(a => (
                  <option key={a.name} value={a.name}>{a.icon || "📁"} {a.name} ({a.count || a.photo_count || 0} photos)</option>
                ))}
              </select>
            </div>
          )}

          {targetType === "photos" && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: GP.textTertiary, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Select Photos ({selectedPhotoIds.length} chosen)</div>
              <div style={{
                maxHeight: 180,
                overflowY: "auto",
                border: `1px solid ${GP.border}`,
                borderRadius: 12,
                padding: 10,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
                gap: 8,
                background: GP.surface
              }}>
                {photos.map(p => {
                  const isChosen = selectedPhotoIds.includes(p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => togglePhotoSelection(p.id)}
                      style={{
                        height: 64,
                        borderRadius: 8,
                        cursor: "pointer",
                        position: "relative",
                        background: `linear-gradient(135deg, ${p.palette?.[0] || "#e8d5b7"}, ${p.palette?.[1] || "#d4a574"})`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 24,
                        border: isChosen ? `3px solid ${GP.blue}` : `1px solid ${GP.border}`,
                        boxShadow: isChosen ? GP.shadow2 : "none",
                        overflow: "hidden",
                      }}
                    >
                      {p.url ? (
                        <img src={p.url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        p.emoji
                      )}
                      {isChosen && (
                        <div style={{
                          position: "absolute",
                          inset: 0,
                          background: "rgba(26,115,232,0.2)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 16,
                          color: GP.white,
                          fontWeight: 700
                        }}>✓</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Progress */}
          {sending && (
            <div style={{ marginBottom: 16 }}>
              <ProgressBar value={progress} />
              <div style={{ fontSize: 12, color: GP.textSecondary, marginTop: 6 }}>Attaching and sending photos…</div>
            </div>
          )}

          <button
            onClick={send}
            disabled={sending || !canSend}
            className="send-btn"
            style={{
              width: "100%",
              padding: "13px",
              borderRadius: 12,
              background: (sending || !canSend) ? GP.surface : GP.blue,
              color: (sending || !canSend) ? GP.textTertiary : "#fff",
              border: "none",
              cursor: (sending || !canSend) ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 600,
              transition: "all 0.15s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {sending ? <><Spinner /> Sending via Agent…</> : `Send via ${platform === "email" ? "Gmail" : "WhatsApp"}`}
          </button>
        </div>

        {/* History */}
        <div style={{ background: GP.white, borderRadius: 16, padding: "24px", boxShadow: GP.shadow1 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20, color: GP.textPrimary }}>Delivery History</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {localHistory.map(h => (
              <div key={h.id} style={{
                padding: "14px 16px",
                background: GP.surface,
                borderRadius: 12,
                display: "flex",
                gap: 12,
                alignItems: "center",
                border: `1px solid ${GP.borderLight}`,
              }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: h.platform === "email" ? GP.blueLight : GP.greenLight,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  flexShrink: 0
                }}>
                  {h.platform === "email" ? "✉" : "💬"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: GP.textPrimary }}>{h.person} — {h.count} photos</div>
                  <div style={{ fontSize: 11, color: GP.textTertiary, marginTop: 2 }}>{h.recipient} · {h.time}</div>
                </div>
                <span style={{
                  padding: "4px 10px",
                  borderRadius: 20,
                  background: h.status === "delivered" ? GP.greenLight : GP.coralLight,
                  color: h.status === "delivered" ? GP.green : GP.coral,
                  fontSize: 11,
                  fontWeight: 600
                }}>
                  {h.status === "delivered" ? "✓ Delivered" : "✗ Failed"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
