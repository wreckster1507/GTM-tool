import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Search, Bell, Plus, ChevronDown, Zap, LogOut, Shield, User, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Sidebar from "./Sidebar";
import { useAuth } from "../../lib/AuthContext";

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  "/sales-workspace": { title: "Sales Workspace", subtitle: "Unified GTM execution journey across all stages" },
  "/pipeline": { title: "Pipeline", subtitle: "Track movement across every revenue stage" },
  "/account-sourcing": { title: "Account Sourcing", subtitle: "Source, import, and prioritize target accounts" },
  "/import": { title: "Account Sourcing", subtitle: "Upload target account CSVs and run bulk prospecting" },
  "/companies": { title: "Account Sourcing", subtitle: "Target accounts and ICP fit" },
  "/prospecting": { title: "Prospecting", subtitle: "Activate contacts, personas, and outreach readiness" },
  "/contacts": { title: "Prospecting", subtitle: "Stakeholders, personas, and outreach" },
  "/pre-meeting-assistance": { title: "Pre-Meeting Assistance", subtitle: "Pre-brief and account context before every call" },
  "/custom-demo-assistance": { title: "Custom-Demo Assistance", subtitle: "Generate account-specific demo strategy" },
  "/meetings": { title: "Pre-Meeting Assistance", subtitle: "Pre-brief, debrief, and meeting quality scoring" },
  "/live-meeting-assistance": { title: "Live-Meeting Assistance", subtitle: "Live objection handling and competitive responses" },
  "/battlecards": { title: "Live-Meeting Assistance", subtitle: "Battlecards and talk-track support during calls" },
  "/crm-insights-alerts": { title: "CRM- Insights and Alerts", subtitle: "Pipeline trends, risks, and momentum signals" },
  "/dashboard": { title: "CRM- Insights and Alerts", subtitle: "Pipeline and win trends" },
  "/execution-tracker": { title: "Execution Tracker", subtitle: "Assigned work, rep updates, blockers, and next-step accountability" },
  "/angel-mapping": { title: "Prospecting", subtitle: "Activate contacts, personas, and outreach readiness" },
  "/team": { title: "Team Management", subtitle: "Manage team members, roles, and permissions" },
};

export default function Layout() {
  const { pathname } = useLocation();
  const { user, logout, isAdmin } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const matchedMeta = Object.entries(PAGE_META).find(([route]) => pathname === route || pathname.startsWith(`${route}/`));
  const meta = matchedMeta?.[1] ?? {
    title: "Beacon CRM",
    subtitle: "Enterprise GTM execution workspace",
  };

  useEffect(() => {
    const saved = window.localStorage.getItem("crm.sidebar.collapsed");
    if (saved === "1") setSidebarCollapsed(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("crm.sidebar.collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  return (
    <div className={`crm-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
      <main className="crm-main">
        <header className="crm-topbar">
          <div className="crm-topbar-left">
            <button
              type="button"
              className="crm-button soft crm-sidebar-toggle"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <button className="crm-workspace-select" type="button">
              <span className="crm-workspace-select-label">Beacon Workspace</span>
              <ChevronDown size={15} />
            </button>
            <div className="crm-live-pill">
              <span className="crm-live-pill-mark">
                <Zap size={11} />
              </span>
              Live
            </div>
            <div className="min-w-0">
              <h1 className="crm-title">{meta.title}</h1>
              <p className="crm-subtitle">{meta.subtitle}</p>
            </div>
          </div>
          <div className="crm-top-actions">
            <div className="crm-search-shell">
              <div className="relative">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8f98bd]" />
                <input className="crm-search" placeholder="Quick Search" />
              </div>
              <span className="crm-search-kbd">Ctrl + K</span>
            </div>
            <button className="crm-button soft" aria-label="Notifications">
              <Bell size={16} />
            </button>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setShowUserMenu((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: "8px",
                }}
                className="crm-button soft"
              >
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.name}
                    style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="crm-user-badge">{user?.name?.charAt(0) ?? "?"}</div>
                )}
                <span style={{ color: "#e2e8f0", fontSize: "13px", fontWeight: 500 }}>
                  {user?.name?.split(" ")[0]}
                </span>
                {isAdmin && (
                  <span
                    style={{
                      fontSize: "10px",
                      padding: "1px 6px",
                      borderRadius: "4px",
                      background: "rgba(99, 132, 255, 0.15)",
                      color: "#6384ff",
                      fontWeight: 600,
                      textTransform: "uppercase",
                    }}
                  >
                    Admin
                  </span>
                )}
                <ChevronDown size={14} style={{ color: "#8f98bd" }} />
              </button>
              {showUserMenu && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 4px)",
                    background: "#1a2236",
                    border: "1px solid rgba(99, 132, 255, 0.15)",
                    borderRadius: "10px",
                    padding: "6px",
                    minWidth: "200px",
                    zIndex: 100,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                  }}
                >
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: "4px" }}>
                    <div style={{ color: "#e2e8f0", fontSize: "13px", fontWeight: 600 }}>{user?.name}</div>
                    <div style={{ color: "#64748b", fontSize: "11px" }}>{user?.email}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "4px" }}>
                      {isAdmin ? <Shield size={11} color="#6384ff" /> : <User size={11} color="#8f98bd" />}
                      <span style={{ color: isAdmin ? "#6384ff" : "#8f98bd", fontSize: "11px", textTransform: "capitalize" }}>
                        {user?.role?.replace("_", " ")}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowUserMenu(false); logout(); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      width: "100%",
                      padding: "8px 12px",
                      background: "none",
                      border: "none",
                      borderRadius: "6px",
                      color: "#ef4444",
                      fontSize: "13px",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239,68,68,0.1)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
            <button className="crm-button primary">
              <Plus size={16} />
              Create
            </button>
          </div>
        </header>
        <section className="crm-content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
