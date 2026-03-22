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
  Sparkles,
  Swords,
  LayoutPanelTop,
  Settings,
} from "lucide-react";

const NAV = [
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/account-sourcing", label: "Account Sourcing", icon: Search },
  { to: "/prospecting", label: "Prospecting", icon: Radar },
  { to: "/pre-meeting-assistance", label: "Pre-Meeting Assistance", icon: Compass },
  { to: "/custom-demo-assistance", label: "Custom-Demo Assistance", icon: BriefcaseBusiness },
  { to: "/live-meeting-assistance", label: "Live-Meeting Assistance", icon: Swords },
  { to: "/crm-insights-alerts", label: "CRM- Insights and Alerts", icon: BarChart3 },
  { to: "/knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { to: "/sales-workspace", label: "Sales Workspace", icon: LayoutPanelTop },
];

export default function Sidebar() {
  return (
    <aside className="crm-sidebar">
      <div className="crm-brand">
        <div className="crm-brand-mark">
          <Sparkles size={16} />
        </div>
        <div>
          <p className="crm-brand-title">beacon.li</p>
          <p className="crm-brand-sub">Execution workspace</p>
        </div>
      </div>

      <nav className="crm-nav">
        <p className="text-[11px] uppercase tracking-[0.12em] text-[#87a3c0] px-2 pb-1">Workspace</p>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `crm-nav-link ${isActive ? "active" : ""}`}
            >
              <span className="crm-nav-icon">
                <Icon size={16} />
              </span>
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="crm-sidebar-footer">
        <button type="button" className="crm-sidebar-settings">
          <Settings size={16} />
          Settings
        </button>
      </div>
    </aside>
  );
}
