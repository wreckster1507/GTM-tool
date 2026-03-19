import { Outlet, useLocation } from "react-router-dom";
import { Search, Bell, Plus } from "lucide-react";
import Sidebar from "./Sidebar";

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  "/pipeline": { title: "Sales Pipeline", subtitle: "Track movement across every stage" },
  "/import": { title: "Data Import", subtitle: "Upload target account CSVs and run bulk prospecting" },
  "/companies": { title: "Companies", subtitle: "Target accounts and ICP fit" },
  "/contacts": { title: "Contacts", subtitle: "Stakeholders, personas, and outreach" },
  "/meetings": { title: "Meetings", subtitle: "Pre-brief, debrief, and meeting quality scoring" },
  "/battlecards": { title: "Battlecards", subtitle: "Live objection handling and competitive responses" },
  "/dashboard": { title: "Revenue Insights", subtitle: "Pipeline and win trends" },
};

export default function Layout() {
  const { pathname } = useLocation();
  const matchedMeta = Object.entries(PAGE_META).find(([route]) => pathname === route || pathname.startsWith(`${route}/`));
  const meta = matchedMeta?.[1] ?? {
    title: "Beacon CRM",
    subtitle: "Enterprise GTM execution workspace",
  };

  return (
    <div className="crm-shell">
      <Sidebar />
      <main className="crm-main">
        <header className="crm-topbar">
          <div className="min-w-0">
            <h1 className="crm-title">{meta.title}</h1>
            <p className="crm-subtitle">{meta.subtitle}</p>
          </div>
          <div className="crm-top-actions">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8ba0b7]" />
              <input className="crm-search" placeholder="Search companies, contacts, deals" />
            </div>
            <button className="crm-button soft" aria-label="Notifications">
              <Bell size={16} />
            </button>
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
