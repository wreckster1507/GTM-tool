import { NavLink } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Compass,
  KanbanSquare,
  Radar,
  Search,
  Swords,
  CheckSquare,
  LayoutPanelTop,
  Settings,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAuth } from "../../lib/AuthContext";

const NAV = [
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/account-sourcing", label: "Account Sourcing", icon: Search },
  { to: "/prospecting", label: "Prospecting", icon: Radar },
  { to: "/pre-meeting-assistance", label: "Pre-Meeting Assistance", icon: Compass },
  { to: "/custom-demo-assistance", label: "Custom-Demo Assistance", icon: BriefcaseBusiness },
  { to: "/live-meeting-assistance", label: "Live-Meeting Assistance", icon: Swords },
  { to: "/crm-insights-alerts", label: "CRM- Insights and Alerts", icon: BarChart3 },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { to: "/sales-workspace", label: "Sales Workspace", icon: LayoutPanelTop },
];

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { isAdmin } = useAuth();
  return (
    <aside className={`crm-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="crm-brand">
        <div className="crm-brand-mark">
          <img
            src="/beacon-logo.jpg"
            alt="Beacon"
            style={{ width: "76%", height: "76%", objectFit: "contain", display: "block" }}
          />
        </div>
        <div className="crm-brand-copy">
          <p className="crm-brand-title">beacon.li</p>
          <p className="crm-brand-sub">Execution OS</p>
        </div>
        <button type="button" className="crm-sidebar-collapse-button" onClick={onToggle} aria-label={collapsed ? "Open sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="crm-nav">
        <p className="crm-nav-section-label">Workspace</p>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `crm-nav-link ${isActive ? "active" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="crm-nav-icon">
                <Icon size={16} />
              </span>
              <span className="crm-nav-link-label">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="crm-sidebar-footer">
        {isAdmin && (
          <NavLink
            to="/team"
            className={({ isActive }) => `crm-nav-link ${isActive ? "active" : ""}`}
            style={{ marginBottom: 4 }}
            title={collapsed ? "Team" : undefined}
          >
            <span className="crm-nav-icon"><Users size={16} /></span>
            <span className="crm-nav-link-label">Team</span>
          </NavLink>
        )}
        <NavLink
          to="/settings"
          className={({ isActive }) => `crm-sidebar-settings ${isActive ? "active" : ""}`}
          title={collapsed ? "Settings" : undefined}
        >
          <Settings size={16} />
          <span className="crm-nav-link-label">Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}
