import React, { useState, useEffect, useRef } from "react";
import { api } from "../../api";
import { GP } from "../../styles/theme";
import Avatar from "../common/Avatar";
import PhotoDetailModal from "../gallery/PhotoDetailModal";
import PersonPhotosModal from "../gallery/PersonPhotosModal";

export default function ChatPage({ showNotif, setPage, setSearch, setShareParams }) {
  const [conversations, setConversations] = useState(() => {
    const saved = localStorage.getItem("drishyamitra_conversations");
    return saved ? JSON.parse(saved) : [
      {
        id: "default",
        title: "Welcome Chat",
        messages: [
          { role: "bot", text: `Hi! I'm your Drishyamitra AI assistant 👋\n\nI can help you find photos, organize your collection, and share memories. Try asking:\n• "Show me photos of Priya from last month"\n• "Send Grandma's photos to email"\n• "How many wedding photos do I have?"` }
        ]
      }
    ];
  });
  const [activeId, setActiveId] = useState(() => conversations[0]?.id || "default");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [viewingPerson, setViewingPerson] = useState(null);
  const bottomRef = useRef();

  const activeChat = conversations.find(c => c.id === activeId) || conversations[0];
  const messages = activeChat ? activeChat.messages : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const saveConversations = (updated) => {
    setConversations(updated);
    localStorage.setItem("drishyamitra_conversations", JSON.stringify(updated));
  };

  const startNewChat = () => {
    const newId = Date.now().toString();
    const newChat = {
      id: newId,
      title: `Chat ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      messages: [
        { role: "bot", text: "Hi! I'm your Drishyamitra AI assistant. How can I help you today?" }
      ]
    };
    const next = [newChat, ...conversations];
    saveConversations(next);
    setActiveId(newId);
  };

  const deleteChat = (e, id) => {
    e.stopPropagation();
    if (conversations.length <= 1) {
      showNotif("Cannot delete the only active conversation.", "warning");
      return;
    }
    const next = conversations.filter(c => c.id !== id);
    saveConversations(next);
    if (activeId === id) {
      setActiveId(next[0].id);
    }
  };

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");

    // Append user message
    const updatedMessages = [...messages, { role: "user", text: userMsg }];
    const nextConversations = conversations.map(c => {
      if (c.id === activeId) {
        // Auto rename title if it's default title and this is first user message
        let newTitle = c.title;
        if (c.messages.length === 1 && c.title.startsWith("Chat ")) {
          newTitle = userMsg.length > 18 ? userMsg.slice(0, 15) + "..." : userMsg;
        }
        return { ...c, title: newTitle, messages: updatedMessages };
      }
      return c;
    });
    saveConversations(nextConversations);
    setLoading(true);

    try {
      const history = updatedMessages.slice(-8).map(m => ({ role: m.role === "user" ? "user" : "bot", content: m.text }));
      const res = await api.chat.send(userMsg, history);
      
      const finalMessages = [...updatedMessages, { 
        role: "bot", 
        text: res.response,
        photos: res.photos || [],
        persons: res.persons || [],
        album: res.album || null
      }];
      const finalConversations = nextConversations.map(c => {
        if (c.id === activeId) {
          return { ...c, messages: finalMessages };
        }
        return c;
      });
      saveConversations(finalConversations);
    } catch {
      const finalMessages = [...updatedMessages, { role: "bot", text: "Sorry, I couldn't process that. Please check backend connection." }];
      const finalConversations = nextConversations.map(c => {
        if (c.id === activeId) {
          return { ...c, messages: finalMessages };
        }
        return c;
      });
      saveConversations(finalConversations);
    } finally {
      setLoading(false);
    }
  }

  const suggestions = ["Show photos of Priya", "Send Grandma's photos", "How many wedding photos?", "Find Festival 2024 photos"];

  return (
    <div style={{ display: "flex", gap: 24, height: "calc(100vh - 140px)" }}>
      {/* History Sidebar */}
      <div style={{
        width: 200,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: GP.white,
        borderRadius: 16,
        padding: "16px 12px",
        boxShadow: GP.shadow1,
        border: `1px solid ${GP.borderLight}`
      }}>
        <button onClick={startNewChat} style={{
          width: "100%",
          padding: "10px",
          background: GP.blueLight,
          color: GP.blue,
          border: "none",
          borderRadius: 10,
          fontWeight: 600,
          fontSize: 12,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          marginBottom: 16,
          transition: "background 0.2s"
        }}>
          <span>+</span> New Chat
        </button>
        <div style={{ fontSize: 11, color: GP.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8, paddingLeft: 4 }}>History</div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {conversations.map(c => (
            <div
              key={c.id}
              onClick={() => setActiveId(c.id)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                background: activeId === c.id ? GP.surface : "transparent",
                color: activeId === c.id ? GP.blue : GP.textSecondary,
                fontSize: 12,
                fontWeight: activeId === c.id ? 600 : 400,
                transition: "all 0.15s"
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>💬 {c.title}</span>
              {conversations.length > 1 && (
                <button
                  onClick={(e) => deleteChat(e, c.id)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: GP.textTertiary,
                    fontSize: 12,
                    padding: "0 4px"
                  }}
                  title="Delete conversation"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: GP.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🤖</div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: GP.textPrimary, margin: 0 }}>AI Assistant</h2>
            <div style={{ fontSize: 11, color: GP.green, fontWeight: 500, marginTop: 2 }}>● Online · Powered by Groq Llama 3.3</div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, paddingBottom: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", animation: "fadeUp 0.3s ease" }}>
              <div style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", gap: 8, alignItems: "flex-end", width: "100%" }}>
                {m.role === "bot" && (
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: GP.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🤖</div>
                )}
                <div style={{
                  maxWidth: "72%",
                  padding: "12px 16px",
                  borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                  background: m.role === "user" ? GP.blue : GP.white,
                  color: m.role === "user" ? "#fff" : GP.textPrimary,
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  boxShadow: GP.shadow1,
                }}>{m.text}</div>
              </div>

              {m.role === "bot" && (m.photos || m.persons || m.album) && (
                <div style={{ marginLeft: 40, marginTop: 8, width: "calc(100% - 40px)", maxWidth: "80%" }}>
                  {/* Photos Grid */}
                  {m.photos && m.photos.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, width: "100%", marginTop: 4 }}>
                      {m.photos.map(p => (
                        <div 
                          key={p.id} 
                          onClick={() => setSelectedPhoto(p)}
                          style={{
                            borderRadius: 12,
                            overflow: "hidden",
                            cursor: "pointer",
                            border: `1px solid ${GP.borderLight}`,
                            boxShadow: GP.shadow1,
                            background: GP.white,
                            transition: "transform 0.2s, box-shadow 0.2s",
                            position: "relative"
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.transform = "translateY(-2px)";
                            e.currentTarget.style.boxShadow = GP.shadow2;
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.boxShadow = GP.shadow1;
                          }}
                        >
                          <div style={{ width: "100%", height: 100, background: p.url ? "none" : `linear-gradient(135deg, ${p.palette?.[0] || "#e8d5b7"}, ${p.palette?.[1] || "#d4a574"})`, position: "relative" }}>
                            {p.url ? (
                              <img src={p.url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              <span style={{ fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>{p.emoji || "📸"}</span>
                            )}
                          </div>
                          <div style={{ padding: "6px 8px" }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: GP.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {p.name}
                            </div>
                            {p.persons && p.persons.length > 0 && (
                              <div style={{ fontSize: 9, color: GP.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                                👤 {p.persons.join(", ")}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Persons Grid */}
                  {m.persons && m.persons.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, width: "100%", marginTop: 4 }}>
                      {m.persons.map(p => (
                        <div 
                          key={p.id}
                          style={{
                            background: GP.white,
                            borderRadius: 16,
                            padding: "16px 12px",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 10,
                            boxShadow: GP.shadow1,
                            border: `1px solid ${GP.borderLight}`,
                            transition: "all 0.2s"
                          }}
                        >
                          <Avatar person={p} size={48} />
                          <div style={{ textAlign: "center", minWidth: 0, width: "100%" }}>
                            <div style={{ fontWeight: 700, fontSize: 12, color: GP.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                            <div style={{ color: GP.textTertiary, fontSize: 11, marginTop: 2 }}>{p.photoCount || p.photo_count || 0} photos</div>
                          </div>
                          {p.tags && p.tags.length > 0 && (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
                              {p.tags.slice(0, 2).map(t => (
                                <span key={t} style={{ padding: "2px 8px", background: p.bg || GP.blueLight, color: p.color || GP.blue, borderRadius: 20, fontSize: 9, fontWeight: 500 }}>{t}</span>
                              ))}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8, width: "100%" }}>
                            <button
                              onClick={() => setViewingPerson(p)}
                              style={{ flex: 1, padding: "5px 0", background: GP.surface, border: `1px solid ${GP.border}`, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", color: GP.textPrimary }}
                            >View</button>
                            <button
                              onClick={() => {
                                if (setShareParams) setShareParams({ targetType: "person", selectedPerson: p.name });
                                if (setPage) setPage("delivery");
                              }}
                              style={{ flex: 1, padding: "5px 0", background: GP.blueLight, border: "none", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", color: GP.blue }}
                            >Share</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Album Card */}
                  {m.album && (
                    <div style={{
                      background: GP.white,
                      borderRadius: 16,
                      padding: "16px 20px",
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      boxShadow: GP.shadow1,
                      border: `1px solid ${GP.borderLight}`,
                      marginTop: 4,
                      maxWidth: 380
                    }}>
                      <div style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: m.album.bg || GP.blueLight,
                        color: m.album.color || GP.blue,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 22,
                        flexShrink: 0
                      }}>
                        {m.album.icon || "📁"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: GP.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.album.name}
                        </div>
                        <div style={{ fontSize: 11, color: GP.textSecondary, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.album.description || "Photo Album"}
                        </div>
                        <div style={{ fontSize: 10, color: GP.textTertiary, marginTop: 4 }}>
                          {m.album.count || 0} photo{m.album.count !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={() => {
                            if (setSearch) setSearch(m.album.name);
                            if (setPage) setPage("gallery");
                          }}
                          style={{
                            padding: "6px 12px",
                            background: GP.surface,
                            border: `1px solid ${GP.border}`,
                            borderRadius: 8,
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: "pointer",
                            color: GP.textPrimary,
                            whiteSpace: "nowrap"
                          }}
                        >
                          View Album
                        </button>
                        <button
                          onClick={() => {
                            if (setShareParams) setShareParams({ targetType: "album", selectedAlbum: m.album.name });
                            if (setPage) setPage("delivery");
                          }}
                          style={{
                            padding: "6px 12px",
                            background: GP.blueLight,
                            border: "none",
                            borderRadius: 8,
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: "pointer",
                            color: GP.blue,
                            whiteSpace: "nowrap"
                          }}
                        >
                          Share
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: GP.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🤖</div>
              <div style={{ padding: "12px 16px", background: GP.white, borderRadius: "18px 18px 18px 4px", boxShadow: GP.shadow1, display: "flex", gap: 4, alignItems: "center" }}>
                {[0, 1, 2].map(j => (
                  <div key={j} style={{ width: 7, height: 7, borderRadius: "50%", background: GP.textTertiary, animation: `pulse 1.2s ${j * 0.2}s ease infinite` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggestions */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {suggestions.map(s => (
            <button key={s} onClick={() => setInput(s)} style={{
              padding: "6px 14px",
              borderRadius: 20,
              border: `1px solid ${GP.border}`,
              background: GP.white,
              color: GP.blue,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              boxShadow: GP.shadow1,
              transition: "all 0.15s",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = GP.blueLight; e.currentTarget.style.borderColor = GP.blue; }}
              onMouseLeave={e => { e.currentTarget.style.background = GP.white; e.currentTarget.style.borderColor = GP.border; }}
            >{s}</button>
          ))}
        </div>

        {/* Input */}
        <div style={{ display: "flex", gap: 8, background: GP.white, borderRadius: 28, padding: "6px 6px 6px 16px", boxShadow: GP.shadow2, border: `1px solid ${GP.border}` }}>
          <input
            style={{ flex: 1, border: "none", background: "none", fontSize: 14, color: GP.textPrimary, outline: "none", minWidth: 0 }}
            placeholder="Ask about your photos…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: (loading || !input.trim()) ? GP.surface : GP.blue,
              color: (loading || !input.trim()) ? GP.textTertiary : "#fff",
              border: "none",
              cursor: (loading || !input.trim()) ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              transition: "all 0.15s",
            }}
          >
            ➔
          </button>
        </div>
      </div>

      {selectedPhoto && (
        <PhotoDetailModal
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
          onDelete={async (id) => {
            try {
              await api.photos.delete(id);
              showNotif("Photo deleted successfully.", "success");
              setSelectedPhoto(null);
            } catch (err) {
              showNotif("Failed to delete photo.", "error");
            }
          }}
          onShare={() => {
            if (setShareParams) setShareParams({ targetType: "photos", selectedPhotoIds: [selectedPhoto.id] });
            if (setPage) setPage("delivery");
            setSelectedPhoto(null);
          }}
        />
      )}
      {viewingPerson && (
        <PersonPhotosModal person={viewingPerson} onClose={() => setViewingPerson(null)} />
      )}
    </div>
  );
}
