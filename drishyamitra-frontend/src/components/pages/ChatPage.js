import React, { useState, useEffect, useRef } from "react";
import { api } from "../../api";
import { GP } from "../../styles/theme";
import PhotoDetailModal from "../gallery/PhotoDetailModal";
import PersonPhotosModal from "../gallery/PersonPhotosModal";

const extractChatAction = (text) => {
  if (!text) return null;
  
  // 1. Try markdown json block first
  const mdMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (mdMatch) {
    try {
      const parsed = JSON.parse(mdMatch[1]);
      if (parsed && (parsed.action === "EXECUTE_WHATSAPP_SHARE" || parsed.action === "EXECUTE_EMAIL_SHARE" || parsed.action === "FILTER_GALLERY_BY_LABEL")) {
        return parsed;
      }
    } catch (e) {}
  }
  
  // 2. Try raw JSON by finding '{' containing '"action"' and matching brackets
  const startIndex = text.search(/\{\s*("action"|'action')/);
  if (startIndex !== -1) {
    let braceCount = 0;
    let endIndex = -1;
    for (let i = startIndex; i < text.length; i++) {
      if (text[i] === "{") braceCount++;
      else if (text[i] === "}") {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }
    }
    if (endIndex !== -1) {
      const rawJson = text.substring(startIndex, endIndex + 1);
      try {
        const parsed = JSON.parse(rawJson);
        if (parsed && (parsed.action === "EXECUTE_WHATSAPP_SHARE" || parsed.action === "EXECUTE_EMAIL_SHARE" || parsed.action === "FILTER_GALLERY_BY_LABEL")) {
          return parsed;
        }
      } catch (e) {}
    }
  }
  return null;
};

const generateThreeWordTitle = (messages) => {
  if (!messages || messages.length === 0) return "General AI Search";
  
  const allText = messages.map(m => m.text).join(" ").toLowerCase();
  
  // Check common keywords
  const isWhatsApp = allText.includes("whatsapp") || allText.includes("share");
  const isEmail = allText.includes("email") || allText.includes("send");
  
  const names = ["avinash", "sathish", "satish", "priya", "grandma", "family"];
  let foundName = null;
  for (const n of names) {
    if (allText.includes(n)) {
      foundName = n.charAt(0).toUpperCase() + n.slice(1);
      break;
    }
  }
  
  const isBeach = allText.includes("beach") || allText.includes("coast");
  const isWedding = allText.includes("wedding");
  const isGreenery = allText.includes("greenery") || allText.includes("nature") || allText.includes("outdoor");

  if (isWhatsApp) {
    return `Shared ${foundName || "Recent"} Photos`;
  }
  if (isEmail) {
    return `Emailed ${foundName || "Selected"} Photos`;
  }
  if (isBeach) return "Beach & Coast Search";
  if (isWedding) return "Wedding Photos Search";
  if (isGreenery) return "Nature Scenes Search";
  if (foundName) return `Found ${foundName} Photos`;
  
  return "General AI Search";
};

const EMPTY_MESSAGES = [];

export default function ChatPage({ showNotif, setPage, setSearch, setShareParams, chatPreFill, setChatPreFill, setGalleryFilter, setAddingToAlbum, globalActivePhotoIds }) {
  const [conversations, setConversations] = useState(() => {
    const saved = localStorage.getItem("drishyamitra_conversations");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return [
      {
        id: "temp",
        title: "New Chat",
        messages: [
          { role: "bot", text: `Hi! I'm your Drishyamitra AI assistant 👋\n\nI can help you find photos, organize your collection, and share memories. Try asking:\n• "Show me photos of Priya from last month"\n• "Send Grandma's photos to email"\n• "How many wedding photos do I have?"` }
        ]
      }
    ];
  });
  const [activeId, setActiveId] = useState(() => conversations[0]?.id || "temp");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [viewingPerson, setViewingPerson] = useState(null);
  const [activeSharePhotoIds, setActiveSharePhotoIds] = useState([]);
  const bottomRef = useRef();

  const activeChat = conversations.find(c => c.id === activeId) || conversations[0];
  const messages = activeChat ? activeChat.messages : EMPTY_MESSAGES;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (chatPreFill) {
      setInput(chatPreFill.message);
      if (chatPreFill.photoIds) {
        setActiveSharePhotoIds(chatPreFill.photoIds);
      }
      if (setChatPreFill) setChatPreFill(null);
    }
  }, [chatPreFill, setChatPreFill]);

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

  const handleManualDelete = async () => {
    if (messages.length > 1) {
      const title = generateThreeWordTitle(messages);
      const updatedConversations = conversations.map(c => {
        if (c.id === activeId) {
          return { ...c, title: title };
        }
        return c;
      });
      
      const newId = Date.now().toString();
      const newChat = {
        id: newId,
        title: `Chat ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        messages: [
          { role: "bot", text: "Hi! I'm your Drishyamitra AI assistant. How can I help you today?" }
        ]
      };
      
      saveConversations([newChat, ...updatedConversations]);
      setActiveId(newId);
      showNotif("Chat session archived. Fresh context loaded.", "success");
    } else {
      showNotif("Nothing to archive.", "info");
    }
    
    try {
      await api.chat.clear();
    } catch (err) {
      console.error("Failed to clear backend chat history:", err);
    }
  };

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");

    const userMsgLower = userMsg.toLowerCase().trim();
    const isCompletion = 
      userMsgLower === "thank you" || 
      userMsgLower === "done" || 
      userMsgLower === "exit" || 
      userMsgLower === "thanks" ||
      userMsgLower.includes("thank you") ||
      userMsgLower.includes("thanks");

    if (isCompletion) {
      if (messages.length > 1) {
        const title = generateThreeWordTitle(messages);
        const updatedConversations = conversations.map(c => {
          if (c.id === activeId) {
            return { ...c, title: title };
          }
          return c;
        });
        
        const newId = Date.now().toString();
        const newChat = {
          id: newId,
          title: `Chat ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          messages: [
            { role: "bot", text: "Hi! I'm your Drishyamitra AI assistant. How can I help you today?" }
          ]
        };
        
        saveConversations([newChat, ...updatedConversations]);
        setActiveId(newId);
        showNotif("Conversation completed and archived.", "success");
      } else {
        showNotif("Conversation completed.", "success");
      }
      setInput("");
      try {
        await api.chat.clear();
      } catch (err) {
        console.error("Failed to clear backend chat history:", err);
      }
      return;
    }

    // Append user message
    const updatedMessages = [...messages, { role: "user", text: userMsg }];
    let realActiveId = activeId;
    let nextConversations = conversations;
    
    if (activeId === "temp") {
      realActiveId = Date.now().toString();
      const newTitle = userMsg.length > 18 ? userMsg.slice(0, 15) + "..." : userMsg;
      nextConversations = conversations.map(c => {
        if (c.id === "temp") {
          return { ...c, id: realActiveId, title: newTitle, messages: updatedMessages };
        }
        return c;
      });
      setActiveId(realActiveId);
    } else {
      nextConversations = conversations.map(c => {
        if (c.id === activeId) {
          let newTitle = c.title;
          if (c.messages.length === 1 && (c.title.startsWith("Chat ") || c.title === "New Chat")) {
            newTitle = userMsg.length > 18 ? userMsg.slice(0, 15) + "..." : userMsg;
          }
          return { ...c, title: newTitle, messages: updatedMessages };
        }
        return c;
      });
    }
    
    saveConversations(nextConversations);
    setLoading(true);

    try {
      // Find active photo IDs from the last bot message displaying photos or the pre-filled share selection
      let activePhotoIds = [...activeSharePhotoIds];
      if (activePhotoIds.length === 0) {
        for (let i = updatedMessages.length - 1; i >= 0; i--) {
          if (updatedMessages[i].role === "bot" && updatedMessages[i].photos && updatedMessages[i].photos.length > 0) {
            for (const p of updatedMessages[i].photos) {
              activePhotoIds.push(p.id);
            }
            break;
          }
        }
      }
      // Fallback to global active photo context if chat history/selection is empty
      if (activePhotoIds.length === 0 && globalActivePhotoIds && globalActivePhotoIds.length > 0) {
        activePhotoIds = [...globalActivePhotoIds];
      }
      setActiveSharePhotoIds([]);

      const history = updatedMessages.slice(-8).map(m => ({ role: m.role === "user" ? "user" : "bot", content: m.text }));
      const res = await api.chat.send(userMsg, history, activePhotoIds);
      
      // Check for EXECUTE_WHATSAPP_SHARE or EXECUTE_EMAIL_SHARE action
      const action = extractChatAction(res.response);
      
      // Clean bot response text to hide raw JSON and code blocks from the chat bubble
      let cleanText = res.response;
      const codeBlockIndex = cleanText.indexOf("```json");
      if (codeBlockIndex !== -1) {
        cleanText = cleanText.substring(0, codeBlockIndex).trim();
      } else {
        const rawJsonIndex = cleanText.search(/\{\s*("action"|'action')/);
        if (rawJsonIndex !== -1) {
          cleanText = cleanText.substring(0, rawJsonIndex).trim();
        }
      }
      // Strip any XML-style function/tool tags the LLM might emit
      cleanText = cleanText
        .replace(/<function=[^>]*>[\s\S]*?<\/function>/gi, "")
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
        .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, "")
        .replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, "")
        .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
        .replace(/<[^>]*tool[^>]*>[\s\S]*?<\/[^>]*tool[^>]*>/gi, "")
        .replace(/```(json|xml|tool_call)[^`]*```/gi, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      
      const finalMessages = [...updatedMessages, { 
        role: "bot", 
        text: cleanText,
        photos: res.photos || [],
        persons: res.persons || [],
        album: res.album || null
      }];
      const finalConversations = nextConversations.map(c => {
        if (c.id === realActiveId) {
          return { ...c, messages: finalMessages };
        }
        return c;
      });
      saveConversations(finalConversations);

      // Perform redirection to main viewport workspace for search/retrieval actions
      if (res.photos && res.photos.length > 0) {
        setSearch(userMsg);
        if (setAddingToAlbum) setAddingToAlbum(null);
        setPage("gallery");
        showNotif(`Found ${res.photos.length} photo(s).`, "success");
      } else if (res.album) {
        if (setGalleryFilter) setGalleryFilter(res.album.name);
        if (setAddingToAlbum) setAddingToAlbum(null);
        setPage("gallery");
        showNotif(`Opened album "${res.album.name}".`, "success");
      } else if (res.persons && res.persons.length > 0) {
        setSearch(res.persons[0].name);
        if (setAddingToAlbum) setAddingToAlbum(null);
        setPage("gallery");
        showNotif(`Showing photos of ${res.persons[0].name}.`, "success");
      }

      if (action) {
        if (action.action === "FILTER_GALLERY_BY_LABEL" && action.target_label) {
          setSearch(action.target_label);
          if (setGalleryFilter) setGalleryFilter("All Photos");
          if (setAddingToAlbum) setAddingToAlbum(null);
          setPage("gallery");
          showNotif(action.message || `Showing photos of ${action.target_label}.`, "success");
        } else if (action.payload && action.payload.images && action.payload.images.length > 0) {
          if (action.action === "EXECUTE_WHATSAPP_SHARE") {
            const contact = action.payload.default_contact || "+919876543210";
            showNotif(`Initializing WhatsApp sharing for ${action.payload.images.length} photo(s) to ${contact}...`, "info");
            api.photos.shareWhatsAppPywhatkit(contact, action.payload.images).then(() => {
              showNotif("WhatsApp sharing process launched on desktop successfully.", "success");
            }).catch(err => {
              console.error("WhatsApp share API error:", err);
              showNotif("Failed to launch WhatsApp sharing process.", "error");
            });
          } else if (action.action === "EXECUTE_EMAIL_SHARE") {
            const email = action.payload.recipient;
            showNotif(`Sending ${action.payload.images.length} photo(s) to ${email} via Email...`, "info");
            api.photos.shareEmail(email, action.payload.images).then(() => {
              showNotif("Photos sent successfully via SMTP Email.", "success");
            }).catch(err => {
              console.error("Email share API error:", err);
              showNotif("Failed to send photos via Email.", "error");
            });
          }
        }
      }
    } catch (err) {
      console.error("Chat page send error:", err);
      const finalMessages = [...updatedMessages, { role: "bot", text: "Sorry, I couldn't process that. Please check backend connection." }];
      const finalConversations = nextConversations.map(c => {
        if (c.id === realActiveId) {
          return { ...c, messages: finalMessages };
        }
        return c;
      });
      saveConversations(finalConversations);
    } finally {
      setLoading(false);
    }
  }

  const suggestions = [
    "How does automatic clustering work?",
    "What happens when I upload a group photo?",
    "How do I use gallery navigation?",
    "How do I label unrecognized faces?"
  ];

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
          {conversations.filter(c => c.id !== "temp").length === 0 ? (
            <div style={{ color: GP.textTertiary, fontSize: 12, padding: "16px 10px", fontStyle: "italic", textAlign: "center" }}>
              No recent activity
            </div>
          ) : (
            conversations.filter(c => c.id !== "temp").map(c => (
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
                {conversations.filter(c => c.id !== "temp").length > 1 && (
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
            ))
          )}
        </div>
      </div>

      {/* Main Chat Panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: GP.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🤖</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: GP.textPrimary, margin: 0 }}>AI Assistant</h2>
            <div style={{ fontSize: 11, color: GP.green, fontWeight: 500, marginTop: 2 }}>● Online · Powered by Groq Llama 3.3</div>
          </div>
          <button
            onClick={handleManualDelete}
            style={{
              background: GP.coralLight,
              color: GP.coral,
              border: "none",
              borderRadius: 20,
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
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
            title="Delete current conversation logs and reset context"
          >
            🗑️ Delete History
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, paddingBottom: 12 }}>
          {messages.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", opacity: 0.5, color: GP.textSecondary, padding: 40, textAlign: "center" }}>
              <span style={{ fontSize: 48, marginBottom: 12 }}>💬</span>
              <p style={{ fontSize: 14, fontWeight: 500 }}>No messages yet. Ask a question to start the conversation!</p>
            </div>
          )}
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
