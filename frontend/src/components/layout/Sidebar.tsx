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
          <Sparkles size={17} />
        </div>
        <div>
          <p className="crm-brand-title">Beacon CRM</p>
          <p className="crm-brand-sub">GTM command center</p>
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
              <Icon size={16} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-auto p-4 border-t border-[#25364e]">
        <div className="rounded-2xl bg-[#173149] px-4 py-4 border border-[#294764]">
          <p className="text-[13px] font-semibold text-[#f4f8ff]">Execution Workflow</p>
          <p className="text-[11px] text-[#9cb3ca] mt-1">9 GTM stages mapped in this workspace</p>
          <p className="text-[11px] text-[#9cb3ca]">Use Sales Workspace for full journey view</p>
        </div>
      </div>
    </aside>
  );
}
