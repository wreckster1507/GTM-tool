import { NavLink } from "react-router-dom";
import {
  BarChart3,
  Building2,
  CalendarDays,
  KanbanSquare,
  Sparkles,
  Swords,
  Upload,
  UsersRound,
} from "lucide-react";

const NAV = [
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/import", label: "Import", icon: Upload },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/contacts", label: "Contacts", icon: UsersRound },
  { to: "/meetings", label: "Meetings", icon: CalendarDays },
  { to: "/battlecards", label: "Battlecards", icon: Swords },
  { to: "/dashboard", label: "Analytics", icon: BarChart3 },
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
          <p className="text-[13px] font-semibold text-[#f4f8ff]">Beacon Sales Team</p>
          <p className="text-[11px] text-[#9cb3ca] mt-1">12 active reps</p>
          <p className="text-[11px] text-[#9cb3ca]">4 opportunities closing this week</p>
        </div>
      </div>
    </aside>
  );
}
