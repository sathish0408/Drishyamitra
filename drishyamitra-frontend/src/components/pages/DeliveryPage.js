import React, { useState, useEffect, useCallback } from "react";
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
  const [resolvedPaths, setResolvedPaths] = useState([]);
  
  const [localHistory, setLocalHistory] = useState([]);
  const [, setLoadingHistory] = useState(false);
  const [selectedFailedDelivery, setSelectedFailedDelivery] = useState(null);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await api.photos.getSharingHistory();
      setLocalHistory(data || []);
    } catch (err) {
      console.error("Failed to fetch sharing history:", err);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    const hasPending = localHistory.some(h => h.status === "pending");
    if (hasPending) {
      const interval = setInterval(async () => {
        try {
          const data = await api.photos.getSharingHistory();
          setLocalHistory(data || []);
        } catch (err) {
          console.error(err);
        }
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [localHistory]);

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

  useEffect(() => {
    async function resolvePaths() {
      let label = "";
      if (targetType === "person" && selectedPerson) {
        label = selectedPerson;
      } else if (targetType === "album" && selectedAlbum) {
        label = selectedAlbum;
      }

      if (label) {
        try {
          const paths = await api.photos.getPathsByLabel(label);
          setResolvedPaths(paths);
        } catch (e) {
          console.error("Failed to resolve paths:", e);
          setResolvedPaths([]);
        }
      } else {
        setResolvedPaths([]);
      }
    }
    resolvePaths();
  }, [targetType, selectedPerson, selectedAlbum]);

  function togglePhotoSelection(id) {
    setSelectedPhotoIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  async function send() {
    if (!to) return;

    setSending(true);
    setProgress(15);
    try {
      let imagePaths = [];

      if (targetType === "person") {
        if (!selectedPerson) return;
        imagePaths = resolvedPaths;
      } else if (targetType === "album") {
        if (!selectedAlbum) return;
        imagePaths = resolvedPaths;
      } else if (targetType === "photos") {
        if (selectedPhotoIds.length === 0) return;
        // Map selected photo IDs to file paths from the loaded photos array
        imagePaths = selectedPhotoIds.map(id => {
          const photo = photos.find(p => p.id === id);
          return photo ? (photo.file_path || photo.filename || "") : "";
        }).filter(Boolean);
      }

      if (imagePaths.length === 0) {
        showNotif("Could not resolve any photos for the selected target. Please try again.", "error");
        setSending(false);
        setProgress(0);
        return;
      }

      setProgress(55);

      // Call the share API directly — no chatbot middleman
      if (platform === "whatsapp") {
        await api.photos.shareWhatsAppPywhatkit(to, imagePaths);
      } else {
        await api.photos.shareEmail(to, imagePaths);
      }

      setProgress(100);
      await new Promise(r => setTimeout(r, 200));

      const targetLabel = targetType === "person" ? selectedPerson : targetType === "album" ? selectedAlbum : `${selectedPhotoIds.length} photos`;
      showNotif(`Sharing ${targetLabel} via ${platform === "email" ? "Email" : "WhatsApp"} initiated!`, "success");
      setTo("");
      setSelectedPerson("");
      setSelectedAlbum("");
      setSelectedPhotoIds([]);
      fetchHistory();
    } catch (err) {
      const errMsg = err?.response?.data?.error || err?.response?.data?.message || err?.message || "Failed to share photos.";
      showNotif(errMsg, "error");
      fetchHistory();
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
            {localHistory.length === 0 ? (
              <div style={{ color: GP.textTertiary, fontSize: 13, padding: "20px 0", fontStyle: "italic", textAlign: "center" }}>
                No recent activity
              </div>
            ) : (
              localHistory.map(h => (
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
                  {h.status === "failed" ? (
                    <button 
                      type="button"
                      onClick={() => setSelectedFailedDelivery(h)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 20,
                        background: GP.coralLight,
                        color: GP.coral,
                        border: "none",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = GP.coral;
                        e.currentTarget.style.color = "#fff";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = GP.coralLight;
                        e.currentTarget.style.color = GP.coral;
                      }}
                      title="Click to view failure details"
                    >
                      ✗ Failed
                    </button>
                  ) : (
                    <span 
                      style={{
                        padding: "4px 10px",
                        borderRadius: 20,
                        background: h.status === "delivered" ? GP.greenLight : GP.blueLight,
                        color: h.status === "delivered" ? GP.green : GP.blue,
                        fontSize: 11,
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center"
                      }}
                    >
                      {h.status === "delivered" ? "✓ Delivered" : "● Pending..."}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Failure details modal */}
      {selectedFailedDelivery && (
        <div onClick={() => setSelectedFailedDelivery(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.2s"
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: GP.white, borderRadius: 20, width: "90%", maxWidth: 480,
            padding: 24, boxShadow: GP.shadow3, animation: "scaleIn 0.2s"
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: GP.textPrimary, marginBottom: 12 }}>Delivery Failure Details</h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              <div style={{ fontSize: 13 }}><strong style={{ color: GP.textSecondary }}>Platform:</strong> {selectedFailedDelivery.platform === "email" ? "✉ Email" : "💬 WhatsApp"}</div>
              <div style={{ fontSize: 13 }}><strong style={{ color: GP.textSecondary }}>Recipient:</strong> {selectedFailedDelivery.recipient}</div>
              <div style={{ fontSize: 13 }}><strong style={{ color: GP.textSecondary }}>Target:</strong> {selectedFailedDelivery.person} ({selectedFailedDelivery.count} photos)</div>
              <div style={{ fontSize: 13 }}><strong style={{ color: GP.textSecondary }}>Time:</strong> {selectedFailedDelivery.time}</div>
            </div>

            <div style={{
              background: "#fdf3f2", borderLeft: `4px solid ${GP.coral}`,
              borderRadius: 8, padding: 14, marginBottom: 20, fontSize: 13,
              color: "#c5221f", fontFamily: "monospace", overflowX: "auto"
            }}>
              <strong>Error Reason:</strong>
              <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                {selectedFailedDelivery.error_message || "Unknown communication channel error or network timeout."}
              </div>
            </div>

            <button onClick={() => setSelectedFailedDelivery(null)} style={{
              width: "100%", padding: "10px", background: GP.blue, color: "#fff",
              border: "none", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer"
            }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
