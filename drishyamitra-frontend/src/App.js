import React, { useState, useEffect, useCallback } from "react";
import { api } from "./api";

// Themes and styles
import { GP, GLOBAL_CSS } from "./styles/theme";

// Common UI components
import Notification from "./components/common/Notification";
import ProgressBar from "./components/common/ProgressBar";

// Authentication components
import LoginScreen from "./components/auth/LoginScreen";
import ProfileModal from "./components/auth/ProfileModal";

// Top-level Pages
import DashboardPage from "./components/pages/DashboardPage";
import GalleryPage from "./components/pages/GalleryPage";
import PeoplePage from "./components/pages/PeoplePage";
import ChatPage from "./components/pages/ChatPage";
import DeliveryPage from "./components/pages/DeliveryPage";
import AnalyticsModal from "./components/pages/AnalyticsModal";

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [notification, setNotification] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(api.auth.isAuthenticated());
  const [unrecognizedCount, setUnrecognizedCount] = useState(0);
  
  const [globalSearch, setGlobalSearch] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [shareParams, setShareParams] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      api.auth.profile()
        .then(data => setCurrentUser(data))
        .catch(err => console.error(err));
    } else {
      setCurrentUser(null);
    }
  }, [isAuthenticated]);

  const handleBackup = async () => {
    try {
      showNotif("Preparing library backup ZIP...", "info");
      const blob = await api.auth.backup();
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `drishyamitra_backup_${new Date().toISOString().slice(0, 10)}.zip`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      showNotif("Backup ZIP downloaded successfully!", "success");
    } catch (err) {
      console.error(err);
      showNotif("Failed to download backup.", "error");
    }
  };

  const showNotif = useCallback((message, type = "info") => {
    setNotification({ message, type });
  }, []);

  const startVoiceSearch = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || window.mozSpeechRecognition || window.msSpeechRecognition;
    if (!SpeechRecognition) {
      showNotif("Voice search is not supported in this browser.", "error");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setVoiceListening(true);
    showNotif("Listening… speak now", "info");

    recognition.onresult = (event) => {
      const speechToText = event.results[0][0].transcript;
      setGlobalSearch(speechToText);
      setPage("gallery");
      showNotif(`Searching for: "${speechToText}"`, "success");
    };

    recognition.onerror = (event) => {
      console.error("Speech Recognition Error:", event);
      if (event.error === 'not-allowed') {
        showNotif("Microphone access blocked. Please enable microphone permissions in your browser address bar and verify your connection is secure.", "error");
      } else if (event.error === 'no-speech') {
        showNotif("No speech detected. Please try again and speak closer to the microphone.", "warning");
      } else {
        showNotif(`Voice search failed: ${event.error}`, "error");
      }
      setVoiceListening(false);
    };

    recognition.onend = () => {
      setVoiceListening(false);
    };

    recognition.start();
  };

  useEffect(() => {
    if (isAuthenticated) {
      api.faces.unrecognized().then(clusters => {
        const totalCount = clusters.reduce((sum, c) => sum + (c.face_ids ? c.face_ids.length : 1), 0);
        setUnrecognizedCount(totalCount);
      }).catch(err => console.error(err));
    }
  }, [isAuthenticated, page]);

  const navItems = [
    { id: "dashboard", icon: "🏠", label: "Home" },
    { id: "gallery", icon: "📸", label: "Photos" },
    { id: "people", icon: "👥", label: "People" },
    { id: "chat", icon: "💬", label: "AI Chat" },
    { id: "delivery", icon: "↗", label: "Share" },
  ];

  const pages = { dashboard: DashboardPage, gallery: GalleryPage, people: PeoplePage, chat: ChatPage, delivery: DeliveryPage };
  const PageComponent = pages[page];

  if (!isAuthenticated) {
    return (
      <>
        <style>{GLOBAL_CSS}</style>
        <LoginScreen onLoginSuccess={() => setIsAuthenticated(true)} />
        {notification && (
          <Notification message={notification.message} type={notification.type} onClose={() => setNotification(null)} />
        )}
      </>
    );
  }

  return (
    <div style={{ fontFamily: "'Google Sans Text', 'Google Sans', 'Roboto', sans-serif", background: GP.surface, minHeight: "100vh", color: GP.textPrimary, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{GLOBAL_CSS}</style>

      {/* Top Nav */}
      <header style={{
        height: 64,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        background: GP.white,
        borderBottom: `1px solid ${GP.border}`,
        position: "sticky",
        top: 0,
        zIndex: 100,
        gap: 12,
        boxShadow: "0 1px 3px rgba(60,64,67,0.08)",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 200 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: `linear-gradient(135deg, ${GP.blue}, #4285f4)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            boxShadow: GP.shadow1,
          }}>📸</div>
          <span style={{ fontSize: 18, fontWeight: 700, color: GP.textPrimary, letterSpacing: "-0.3px" }}>Drishyamitra</span>
        </div>

        {/* Search bar */}
        <div style={{ flex: 1, maxWidth: 600, position: "relative" }}>
          <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: GP.textTertiary, fontSize: 18 }}>🔍</span>
          <input
            placeholder='Search your photos with AI… "Priya at wedding 2024"'
            value={globalSearch}
            onChange={e => {
              setGlobalSearch(e.target.value);
              if (page !== "gallery") setPage("gallery");
            }}
            style={{
              width: "100%",
              padding: "10px 50px 10px 46px",
              border: `1px solid ${GP.border}`,
              borderRadius: 24,
              fontSize: 14,
              background: GP.surface,
              color: GP.textPrimary,
              transition: "all 0.2s",
              boxShadow: GP.shadow1,
            }}
            onFocus={e => { e.target.style.background = GP.white; e.target.style.borderColor = GP.blue; e.target.style.boxShadow = GP.shadow2; }}
            onBlur={e => { e.target.style.background = GP.surface; e.target.style.borderColor = GP.border; e.target.style.boxShadow = GP.shadow1; }}
          />
          <button
            onClick={startVoiceSearch}
            title="Search with voice"
            type="button"
            style={{
              position: "absolute",
              right: 16,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              color: voiceListening ? GP.coral : GP.textSecondary,
              animation: voiceListening ? "pulse 1.2s infinite" : "none"
            }}
          >
            🎙️
          </button>
        </div>

        {/* Account avatar */}
        <div 
          onClick={() => setShowProfile(true)}
          title="Profile Settings"
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${GP.blue}, ${GP.purple})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: GP.shadow1,
            marginLeft: "auto",
            overflow: "hidden"
          }}
        >
          {currentUser?.profile_pic ? (
            <img src={currentUser.profile_pic.startsWith("http") ? currentUser.profile_pic : "http://localhost:5000" + currentUser.profile_pic} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            (currentUser?.username || "A").charAt(0).toUpperCase()
          )}
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "calc(100vh - 64px)" }}>
        {/* Sidebar */}
        <aside style={{
          width: sidebarCollapsed ? 64 : 220,
          flexShrink: 0,
          background: GP.white,
          borderRight: `1px solid ${GP.border}`,
          padding: "16px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflowY: "auto",
          overflowX: "hidden",
          transition: "width 0.25s ease",
        }}>
          {navItems.map(n => (
            <button
              key={n.id}
              className="sidebar-item"
              onClick={() => setPage(n.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 24,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: page === n.id ? 600 : 500,
                color: page === n.id ? GP.blue : GP.textSecondary,
                background: page === n.id ? GP.blueLight : "transparent",
                border: "none",
                transition: "all 0.15s",
                width: "100%",
                textAlign: "left",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              <span className="sidebar-icon" style={{ fontSize: 18, flexShrink: 0, color: page === n.id ? GP.blue : GP.textSecondary, width: 24, textAlign: "center" }}>{n.icon}</span>
              {!sidebarCollapsed && <span>{n.label}</span>}
              {!sidebarCollapsed && n.id === "people" && unrecognizedCount > 0 && (
                <span style={{ marginLeft: "auto", fontSize: 11, background: GP.coralLight, color: GP.coral, padding: "2px 7px", borderRadius: 10, fontWeight: 600 }}>{unrecognizedCount}</span>
              )}
            </button>
          ))}

          {/* Storage — click to open Analytics */}
          {!sidebarCollapsed && (
            <div style={{ marginTop: "auto", padding: "16px 12px 8px" }}>
              <button
                onClick={() => setShowAnalytics(true)}
                style={{
                  width: "100%",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{
                  background: GP.blueLight,
                  borderRadius: 12,
                  padding: "12px 14px",
                  border: `1px solid ${GP.border}`,
                  transition: "all 0.15s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = GP.shadow2; e.currentTarget.style.borderColor = GP.blue; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = GP.border; }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyvalue: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: GP.blue, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Storage & Analytics</span>
                    <span style={{ fontSize: 13, color: GP.blue }}>↗</span>
                  </div>
                  <div style={{ display: "flex", justifyvalue: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: GP.textSecondary }}>4.2 GB used</span>
                    <span style={{ fontSize: 12, color: GP.textTertiary }}>10 GB</span>
                  </div>
                  <ProgressBar value={42} />
                  <div style={{ fontSize: 11, color: GP.textTertiary, marginTop: 6 }}>6 GB free · Click for insights</div>
                </div>
              </button>

              <button
                onClick={handleBackup}
                style={{
                  width: "100%",
                  marginTop: 14,
                  background: GP.white,
                  border: `1px solid ${GP.border}`,
                  borderRadius: 12,
                  padding: "10px",
                  color: GP.textPrimary,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6
                }}
                onMouseEnter={e => { e.currentTarget.style.background = GP.surface; e.currentTarget.style.borderColor = GP.blue; }}
                onMouseLeave={e => { e.currentTarget.style.background = GP.white; e.currentTarget.style.borderColor = GP.border; }}
              >
                💾 Backup Library
              </button>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main style={{ flex: 1, overflowY: "auto", padding: "28px 32px", background: GP.surface }}>
          {page === "gallery" ? (
            <GalleryPage
              setPage={setPage}
              showNotif={showNotif}
              search={globalSearch}
              setSearch={setGlobalSearch}
              setShareParams={setShareParams}
            />
          ) : page === "people" ? (
            <PeoplePage
              setPage={setPage}
              showNotif={showNotif}
              setShareParams={setShareParams}
            />
          ) : page === "delivery" ? (
            <DeliveryPage
              showNotif={showNotif}
              shareParams={shareParams}
              setShareParams={setShareParams}
            />
          ) : (
            <PageComponent 
              setPage={setPage} 
              showNotif={showNotif} 
              onOpenAnalytics={() => setShowAnalytics(true)} 
              setSearch={setGlobalSearch}
              setShareParams={setShareParams}
            />
          )}
        </main>
      </div>

      {showAnalytics && <AnalyticsModal onClose={() => setShowAnalytics(false)} />}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} currentUser={currentUser} setCurrentUser={setCurrentUser} onLogout={() => { setIsAuthenticated(false); api.auth.logout(); setShowProfile(false); }} showNotif={showNotif} />}

      {notification && (
        <Notification message={notification.message} type={notification.type} onClose={() => setNotification(null)} />
      )}
    </div>
  );
}
