import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  BarChart3,
  Compass,
  KanbanSquare,
  Radar,
  Search,
  CheckSquare,
  Settings,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { settingsApi } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";

const NAV = [
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/account-sourcing", label: "Account Sourcing", icon: Search },
  { to: "/prospecting", label: "Prospecting", icon: Radar },
  { to: "/pre-meeting-assistance", label: "Pre-Meeting Assistance", icon: Compass },
  { to: "/crm-insights-alerts", label: "CRM- Insights and Alerts", icon: BarChart3 },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
];

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { isAdmin, user } = useAuth();
  const [canManageTeam, setCanManageTeam] = useState(isAdmin);

  useEffect(() => {
    if (isAdmin) {
      setCanManageTeam(true);
      return;
    }
    if (!user) {
      setCanManageTeam(false);
      return;
    }
    let cancelled = false;
    settingsApi
      .getRolePermissions()
      .then((permissions) => {
        if (!cancelled) {
          const permissionRole = user.role === "admin" ? null : user.role;
          setCanManageTeam(permissionRole ? Boolean(permissions[permissionRole]?.manage_team) : true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCanManageTeam(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, user]);

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
        {canManageTeam && (
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
