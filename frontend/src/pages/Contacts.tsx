import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { accountSourcingApi, angelMappingApi, companiesApi, contactsApi } from "../lib/api";
import type { Company, Contact, AngelInvestor, AngelMapping } from "../types";
import {
  Search, Users, CheckCircle2, XCircle, Sparkles, Trash2, AlertCircle, Loader2,
  Network, ChevronDown, ChevronRight, ExternalLink, Star, Plus, Link2,
  Building2, Target,
} from "lucide-react";
import { avatarColor, getInitials } from "../lib/utils";
import OutreachDrawer from "../components/outreach/OutreachDrawer";
import AssignDropdown from "../components/AssignDropdown";

type ProspectingTab = "contacts" | "angel-mapping";

const PERSONA_STYLE: Record<string, CSSProperties> = {
  economic_buyer: { color: "#7b3a1d", background: "#ffe8de", border: "1px solid #ffc8b4" },
  champion: { color: "#1b6f53", background: "#e4fbf3", border: "1px solid #b8efd8" },
  technical_evaluator: { color: "#24567e", background: "#eaf4ff", border: "1px solid #c9e0f8" },
  unknown: { color: "#546679", background: "#edf3f9", border: "1px solid #d7e1eb" },
};
const PERSONA_LABEL: Record<string, string> = {
  economic_buyer: "Economic Buyer", champion: "Champion", technical_evaluator: "Tech Eval", unknown: "Unknown",
};

const STRENGTH_STYLE: Record<number, CSSProperties> = {
  5: { color: "#166534", background: "#dcfce7", border: "1px solid #bbf7d0" },
  4: { color: "#1e40af", background: "#dbeafe", border: "1px solid #bfdbfe" },
  3: { color: "#854d0e", background: "#fef9c3", border: "1px solid #fde68a" },
  2: { color: "#9a3412", background: "#ffedd5", border: "1px solid #fed7aa" },
  1: { color: "#991b1b", background: "#fee2e2", border: "1px solid #fecaca" },
};
const STRENGTH_LABEL: Record<number, string> = {
  5: "Direct fund overlap",
  4: "Same fund, both sides",
  3: "PE/VC peer community",
  2: "Domain/sector community",
  1: "Indirect connection",
};

const ANGEL_SURFACE: Record<string, CSSProperties> = {
  toolbar: {
    padding: "24px 26px",
    borderRadius: 22,
    border: "1px solid #dbe6f2",
    background: "linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)",
    boxShadow: "0 18px 40px rgba(17, 34, 68, 0.06)",
  },
  hero: {
    overflow: "hidden",
    borderRadius: 24,
    border: "1px solid #d5e3ef",
    background: "linear-gradient(135deg, #0f2744 0%, #175089 44%, #17928e 100%)",
    boxShadow: "0 22px 48px rgba(14, 38, 66, 0.16)",
  },
  panel: {
    borderRadius: 22,
    border: "1px solid #dce7f1",
    background: "linear-gradient(180deg, #ffffff 0%, #f9fcff 100%)",
    boxShadow: "0 14px 28px rgba(17, 34, 68, 0.055)",
  },
  companyCard: {
    overflow: "hidden",
    borderRadius: 24,
    border: "1px solid #dbe5f2",
    background: "#ffffff",
    boxShadow: "0 18px 36px rgba(17, 34, 68, 0.07)",
  },
  contactCard: {
    overflow: "hidden",
    borderRadius: 22,
    border: "1px solid #e3edf7",
    background: "#ffffff",
    boxShadow: "0 12px 28px rgba(17, 34, 68, 0.04)",
  },
  pathCard: {
    borderRadius: 20,
    border: "1px solid #e8eff7",
    background: "#fbfdff",
    padding: 20,
  },
};

const ANGEL_TEXT = {
  title: "#1c2b4a",
  body: "#5f7390",
  soft: "#7f91ab",
};

export default function Contacts() {
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState<ProspectingTab>("contacts");

  // ── Contacts state ───────────────────────────────────────────────────
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companyNameById, setCompanyNameById] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [personaFilter, setPersonaFilter] = useState("");
  const [laneFilter, setLaneFilter] = useState("");
  const [sequenceFilter, setSequenceFilter] = useState("");
  const [emailFilter, setEmailFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [resetting, setResetting] = useState(false);

  // ── Angel mapping state ──────────────────────────────────────────────
  const [mappings, setMappings] = useState<AngelMapping[]>([]);
  const [investors, setInvestors] = useState<AngelInvestor[]>([]);
  const [angelLoading, setAngelLoading] = useState(true);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [angelSearch, setAngelSearch] = useState("");
  const [filterStrength, setFilterStrength] = useState<number>(0);
  const [showAddInvestor, setShowAddInvestor] = useState(false);
  const [newInvestor, setNewInvestor] = useState({ name: "", current_role: "", current_company: "" });

  const load = () => {
    setLoading(true);
    Promise.all([contactsApi.list(), companiesApi.list()]).then(([cs, co]) => {
      setContacts(cs);
      setCompanyNameById(Object.fromEntries(co.map((c: Company) => [c.id, c.name])));
      setLoading(false);
    });
  };

  const loadAngels = () => {
    setAngelLoading(true);
    Promise.all([
      angelMappingApi.listMappings(),
      angelMappingApi.listInvestors(),
    ]).then(([m, inv]) => {
      setMappings(m);
      setInvestors(inv);
      setAngelLoading(false);
    }).catch(() => setAngelLoading(false));
  };

  useEffect(() => {
    load();
    loadAngels();
  }, []);

  useEffect(() => {
    setTab(location.pathname === "/angel-mapping" ? "angel-mapping" : "contacts");
  }, [location.pathname]);

  // ── Contacts filtering ──────────────────────────────────────────────
  const companyOptions = Array.from(
    new Set(
      contacts
        .map((c) => c.company_name || (c.company_id ? companyNameById[c.company_id] : ""))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  const filtered = contacts.filter((c) => {
    const companyLabel = c.company_name || (c.company_id ? companyNameById[c.company_id] : "") || "";
    const matchesSearch =
      !search.trim()
      || `${c.first_name} ${c.last_name}`.toLowerCase().includes(search.toLowerCase())
      || (c.email || "").toLowerCase().includes(search.toLowerCase())
      || (c.title || "").toLowerCase().includes(search.toLowerCase())
      || companyLabel.toLowerCase().includes(search.toLowerCase());

    const matchesCompany = !companyFilter || companyLabel === companyFilter;
    const matchesPersona = !personaFilter || (c.persona || "unknown") === personaFilter;
    const matchesLane = !laneFilter || (c.outreach_lane || "") === laneFilter;
    const matchesSequence = !sequenceFilter || (c.sequence_status || "") === sequenceFilter;
    const matchesEmail =
      !emailFilter
      || (emailFilter === "has_email" && Boolean(c.email))
      || (emailFilter === "missing_email" && !c.email)
      || (emailFilter === "verified" && c.email_verified)
      || (emailFilter === "unverified" && !c.email_verified);

    return matchesSearch && matchesCompany && matchesPersona && matchesLane && matchesSequence && matchesEmail;
  });

  // ── Angel mapping grouping ──────────────────────────────────────────
  const filteredMappings = mappings
    .filter((m) => !filterStrength || m.strength >= filterStrength)
    .filter((m) => {
      if (!angelSearch.trim()) return true;
      const q = angelSearch.toLowerCase();
      return (
        (m.company_name || "").toLowerCase().includes(q) ||
        (m.contact_name || "").toLowerCase().includes(q) ||
        (m.angel_name || "").toLowerCase().includes(q)
      );
    });

  const groupedByCompany = Object.entries(
    filteredMappings.reduce<Record<string, { mappings: AngelMapping[] }>>((acc, m) => {
      const key = m.company_name || "Unknown Company";
      if (!acc[key]) acc[key] = { mappings: [] };
      acc[key].mappings.push(m);
      return acc;
    }, {})
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([companyName, { mappings: cms }]) => {
      const byContact = cms.reduce<Record<string, { name: string; title: string; linkedin?: string; mappings: AngelMapping[] }>>((acc, m) => {
        const k = m.contact_name || "Unknown";
        if (!acc[k]) acc[k] = { name: k, title: m.contact_title || "", linkedin: m.contact_linkedin, mappings: [] };
        acc[k].mappings.push(m);
        return acc;
      }, {});
      return {
        companyName,
        contacts: Object.values(byContact).sort((a, b) => a.name.localeCompare(b.name)),
        totalMappings: cms.length,
        maxStrength: Math.max(...cms.map((m) => m.strength)),
      };
    });

  const investorMappingCounts = mappings.reduce<Record<string, number>>((acc, mapping) => {
    acc[mapping.angel_investor_id] = (acc[mapping.angel_investor_id] || 0) + 1;
    return acc;
  }, {});

  const visibleInvestorCount = new Set(filteredMappings.map((mapping) => mapping.angel_investor_id)).size;
  const visibleContactCount = new Set(
    filteredMappings.map((mapping) => `${mapping.company_name || "Unknown Company"}::${mapping.contact_name || mapping.contact_id}`)
  ).size;
  const strongPathCount = filteredMappings.filter((mapping) => mapping.strength >= 4).length;
  const avgStrength = filteredMappings.length
    ? (filteredMappings.reduce((sum, mapping) => sum + mapping.strength, 0) / filteredMappings.length).toFixed(1)
    : "0.0";

  const handleTabChange = (nextTab: ProspectingTab) => {
    const contactsPath = location.pathname === "/contacts" ? "/contacts" : "/prospecting";
    navigate(nextTab === "angel-mapping" ? "/angel-mapping" : contactsPath);
  };

  const handleAddInvestor = async () => {
    if (!newInvestor.name.trim()) return;
    try {
      const created = await angelMappingApi.createInvestor(newInvestor);
      setInvestors((prev) => [...prev, created]);
      setNewInvestor({ name: "", current_role: "", current_company: "" });
      setShowAddInvestor(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create investor");
    }
  };

  const handleDeleteMapping = async (id: string) => {
    try {
      await angelMappingApi.deleteMapping(id);
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete mapping");
    }
  };

  const handleDeleteInvestor = async (id: string) => {
    if (!confirm("Delete this investor and all their mappings?")) return;
    try {
      await angelMappingApi.deleteInvestor(id);
      setInvestors((prev) => prev.filter((i) => i.id !== id));
      setMappings((prev) => prev.filter((m) => m.angel_investor_id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <>
      <div className="crm-page contacts-page space-y-6">
        {/* ── Top bar with tabs ──────────────────────────────────────── */}
        <div className="crm-panel contacts-toolbar overflow-hidden" style={ANGEL_SURFACE.toolbar}>
          <div className="flex flex-1 flex-wrap items-stretch gap-3">
            <ProspectingTabButton
              active={tab === "contacts"}
              icon={<Users className="h-4 w-4" />}
              label="Contacts"
              description="Stakeholders, personas, and outreach readiness."
              count={contacts.length}
              countLabel="people"
              accent="blue"
              onClick={() => handleTabChange("contacts")}
            />
            <ProspectingTabButton
              active={tab === "angel-mapping"}
              icon={<Network className="h-4 w-4" />}
              label="Angel Mapping"
              description="Warm intro paths from investors into target accounts."
              count={mappings.length}
              countLabel="paths"
              accent="teal"
              onClick={() => handleTabChange("angel-mapping")}
            />
          </div>
          <div className="crm-toolbar-actions">
            {tab === "contacts" && (
              <>
                <button
                  type="button"
                  className="crm-button soft h-12 px-4 text-[13px] border-[#f2cfd4] text-[#b42336] hover:bg-[#fff6f7]"
                  disabled={resetting}
                  onClick={async () => {
                    if (!window.confirm("Clear all Prospecting contacts, outreach sequences, and contact activities while keeping companies?")) return;
                    setResetting(true);
                    try {
                      const result = await accountSourcingApi.resetData("prospecting");
                      load();
                      window.alert(`Prospecting cleared.\n${Object.entries(result.summary).map(([key, value]) => `${key}: ${value}`).join("\n")}`);
                    } finally {
                      setResetting(false);
                    }
                  }}
                >
                  {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  Clear Prospecting
                </button>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8094a8] pointer-events-none" />
                  <input
                    className="h-12 w-84 max-w-[78vw] rounded-xl border border-[#d7e2ee] bg-white pl-10 pr-4 text-[14px] placeholder-[#92a4b8] outline-none focus:border-[#c2d3e5]"
                    placeholder="Search people, title, email"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </>
            )}
            {tab === "angel-mapping" && (
              <>
                <button
                  onClick={() => setShowAddInvestor(true)}
                  className="crm-button soft h-12 px-4 text-[13px]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Investor
                </button>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8094a8] pointer-events-none" />
                  <input
                    className="h-12 w-84 max-w-[78vw] rounded-xl border border-[#d7e2ee] bg-white pl-10 pr-4 text-[14px] placeholder-[#92a4b8] outline-none focus:border-[#c2d3e5]"
                    placeholder="Search company, prospect, angel..."
                    value={angelSearch}
                    onChange={(e) => setAngelSearch(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* CONTACTS TAB                                                   */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === "contacts" && (
          <>
            {/* Filters */}
            <div className="crm-panel px-6 py-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <select className="h-11 min-w-[170px] px-3 text-[13px]" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
                    <option value="">All companies</option>
                    {companyOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  <select className="h-11 min-w-[150px] px-3 text-[13px]" value={personaFilter} onChange={(e) => setPersonaFilter(e.target.value)}>
                    <option value="">All personas</option>
                    <option value="economic_buyer">Economic Buyer</option>
                    <option value="champion">Champion</option>
                    <option value="technical_evaluator">Technical Evaluator</option>
                    <option value="unknown">Unknown</option>
                  </select>
                  <select className="h-11 min-w-[150px] px-3 text-[13px]" value={laneFilter} onChange={(e) => setLaneFilter(e.target.value)}>
                    <option value="">All lanes</option>
                    <option value="warm_intro">Warm Intro</option>
                    <option value="event_follow_up">Event Follow-up</option>
                    <option value="cold_operator">Cold Operator</option>
                    <option value="cold_strategic">Cold Strategic</option>
                  </select>
                  <select className="h-11 min-w-[150px] px-3 text-[13px]" value={sequenceFilter} onChange={(e) => setSequenceFilter(e.target.value)}>
                    <option value="">All sequence states</option>
                    <option value="research_needed">Research Needed</option>
                    <option value="ready">Ready</option>
                    <option value="queued_instantly">Queued in Instantly</option>
                    <option value="sent">Sent</option>
                    <option value="replied">Replied</option>
                    <option value="meeting_booked">Meeting Booked</option>
                  </select>
                  <select className="h-11 min-w-[145px] px-3 text-[13px]" value={emailFilter} onChange={(e) => setEmailFilter(e.target.value)}>
                    <option value="">All email states</option>
                    <option value="has_email">Has email</option>
                    <option value="missing_email">Missing email</option>
                    <option value="verified">Verified</option>
                    <option value="unverified">Unverified</option>
                  </select>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="crm-chip">{filtered.length} shown</span>
                  <button
                    type="button"
                    className="crm-button soft h-11 px-4 text-[13px]"
                    onClick={() => {
                      setSearch(""); setCompanyFilter(""); setPersonaFilter("");
                      setLaneFilter(""); setSequenceFilter(""); setEmailFilter("");
                    }}
                  >
                    Reset filters
                  </button>
                </div>
              </div>
            </div>

            {/* Contacts Table */}
            {loading ? (
              <div className="crm-panel p-14 text-center crm-muted">Loading contacts...</div>
            ) : filtered.length === 0 ? (
              <div className="crm-panel p-14 text-center text-[#6f8297]">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-30" />
                No contacts match your search.
              </div>
            ) : (
              <div className="crm-panel overflow-hidden contacts-table-panel">
                <div className="overflow-x-auto">
                  <table className="crm-table" style={{ minWidth: 1080 }}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Company</th>
                        <th>Title</th>
                        <th>Email</th>
                        <th>Persona</th>
                        <th>Assigned To</th>
                        <th>Verified</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c) => (
                        <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/contacts/${c.id}`)}>
                          <td>
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold ${avatarColor(c.first_name + c.last_name)}`}>
                                {getInitials(`${c.first_name} ${c.last_name}`)}
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-[#25384d] truncate">{c.first_name} {c.last_name}</p>
                                <p className="text-[13px] text-[#7a8ea4] mt-0.5">{c.seniority ?? "-"}</p>
                              </div>
                            </div>
                          </td>
                          <td>
                            {c.company_name || (c.company_id ? companyNameById[c.company_id] : undefined) ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); navigate(`/companies/${c.company_id}`); }}
                                className="text-[#2b6cb0] font-semibold text-[13px] hover:underline"
                              >
                                {c.company_name ?? (c.company_id ? companyNameById[c.company_id] : "")}
                              </button>
                            ) : (
                              <span className="text-[#96a7ba]">-</span>
                            )}
                          </td>
                          <td>{c.title ?? <span className="text-[#96a7ba]">-</span>}</td>
                          <td>{c.email ?? <span className="text-[#96a7ba]">-</span>}</td>
                          <td>
                            {c.persona ? (
                              <span
                                className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold"
                                style={PERSONA_STYLE[c.persona] ?? PERSONA_STYLE.unknown}
                              >
                                {PERSONA_LABEL[c.persona] ?? c.persona}
                              </span>
                            ) : (
                              <span className="text-[#96a7ba]">-</span>
                            )}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <AssignDropdown
                              entityType="contact"
                              entityId={c.id}
                              currentAssignedId={c.assigned_to_id}
                              currentAssignedName={c.assigned_to_name || c.assigned_rep_email}
                              onAssigned={() => load()}
                              compact
                            />
                          </td>
                          <td>
                            {c.email_verified ? (
                              <span className="inline-flex items-center gap-1 text-[#24966f] font-semibold text-[12px]">
                                <CheckCircle2 className="h-4 w-4" />Yes
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[#9caabd] font-semibold text-[12px]">
                                <XCircle className="h-4 w-4" />No
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); setSelectedContact(c); }}
                                className="crm-button soft h-12 px-4 text-[13px]"
                              >
                                <Sparkles className="h-3.5 w-3.5" />Outreach
                              </button>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!window.confirm(`Delete "${c.first_name} ${c.last_name}"?`)) return;
                                  await contactsApi.delete(c.id);
                                  setContacts((prev) => prev.filter((x) => x.id !== c.id));
                                }}
                                className="flex items-center justify-center h-12 w-12 rounded-xl text-[#9eb0c3] hover:text-[#c0392b] hover:bg-[#fff0f0] transition-colors"
                                title="Delete contact"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* ANGEL MAPPING TAB                                              */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === "angel-mapping" && (
          <>
            <div className="crm-panel overflow-hidden" style={ANGEL_SURFACE.hero}>
              <div className="grid gap-6 px-7 py-7 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)] lg:px-8">
                <div>
                  <span
                    className="inline-flex items-center gap-2 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
                    style={{ borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.82)" }}
                  >
                    <Network className="h-3.5 w-3.5" />
                    Warm Intro Graph
                  </span>
                  <h2 className="mt-4 text-[24px] font-bold tracking-[-0.02em]" style={{ color: "#ffffff" }}>
                    Angel Mapping for high-conviction prospecting
                  </h2>
                  <p className="mt-2 max-w-2xl text-[14px] leading-7" style={{ color: "rgba(255,255,255,0.78)" }}>
                    Rank investor-backed paths by strength, scan the best connection story for each stakeholder,
                    and decide where a warm introduction is worth spending team time.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <span
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-semibold"
                      style={{ borderRadius: 999, background: "rgba(255,255,255,0.12)", color: "#ffffff" }}
                    >
                      <Target className="h-3.5 w-3.5" />
                      {strongPathCount} strong path{strongPathCount === 1 ? "" : "s"} at strength 4+
                    </span>
                    <span
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-semibold"
                      style={{ borderRadius: 999, background: "rgba(255,255,255,0.12)", color: "#ffffff" }}
                    >
                      <Users className="h-3.5 w-3.5" />
                      {visibleContactCount} prospects in view
                    </span>
                    <span
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-semibold"
                      style={{ borderRadius: 999, background: "rgba(255,255,255,0.12)", color: "#ffffff" }}
                    >
                      <Building2 className="h-3.5 w-3.5" />
                      {groupedByCompany.length} mapped companies
                    </span>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <AngelOverviewCard
                    icon={<Users className="h-4 w-4" />}
                    label="Investors"
                    value={String(investors.length)}
                    caption="Angel and operator relationships available for intros."
                    tone="teal"
                  />
                  <AngelOverviewCard
                    icon={<Link2 className="h-4 w-4" />}
                    label="Visible Paths"
                    value={String(filteredMappings.length)}
                    caption="Filtered paths after search and strength thresholds."
                    tone="blue"
                  />
                  <AngelOverviewCard
                    icon={<Building2 className="h-4 w-4" />}
                    label="Accounts"
                    value={String(groupedByCompany.length)}
                    caption="Companies with at least one mapped connection path."
                    tone="amber"
                  />
                  <AngelOverviewCard
                    icon={<Star className="h-4 w-4" />}
                    label="Avg Strength"
                    value={avgStrength}
                    caption="Average path quality across the current working set."
                    tone="green"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="crm-panel px-7 py-6" style={ANGEL_SURFACE.panel}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8ca2ba]">Path Filters</p>
                    <p className="mt-3 text-[17px] font-bold text-[#1d2b3c]">Focus the intro graph</p>
                  </div>
                  <span className="crm-chip">
                    {filteredMappings.length} result{filteredMappings.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <span className="text-[13px] text-[#6f8297] font-medium" style={{ marginRight: 4 }}>Minimum path strength</span>
                  {[0, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      onClick={() => setFilterStrength(s)}
                      className="text-[12px] font-semibold border transition-colors"
                      style={{
                        padding: "8px 14px",
                        borderRadius: 12,
                        borderColor: filterStrength === s ? "#1f6feb" : "#d9e1ec",
                        background: filterStrength === s ? "#1f6feb" : "#ffffff",
                        color: filterStrength === s ? "#ffffff" : "#55657a",
                        boxShadow: filterStrength === s ? "0 10px 18px rgba(31,111,235,0.16)" : "none",
                      }}
                    >
                      {s === 0 ? "All" : `${s}+`}
                    </button>
                  ))}
                </div>
                <div className="mt-5 flex items-center gap-x-4 gap-y-3 flex-wrap">
                  {[5, 4, 3, 2, 1].map((s) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <StrengthBadge strength={s} compact />
                      <span className="text-[11px] text-[#7f8fa5]">{STRENGTH_LABEL[s]}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="crm-panel px-7 py-6" style={ANGEL_SURFACE.panel}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8ca2ba]">Coverage Snapshot</p>
                <div className="mt-5 space-y-3.5">
                  <SnapshotRow label="Mapped prospects" value={String(visibleContactCount)} tone="blue" />
                  <SnapshotRow label="Connected investors" value={String(visibleInvestorCount)} tone="teal" />
                  <SnapshotRow label="Strength 5 paths" value={String(filteredMappings.filter((m) => m.strength === 5).length)} tone="green" />
                </div>
              </div>
            </div>

            {investors.length > 0 && (
              <div className="crm-panel px-7 py-6" style={ANGEL_SURFACE.panel}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8ca2ba]">Relationship Bench</p>
                    <p className="mt-3 text-[17px] font-bold text-[#1d2b3c]">Investor network at a glance</p>
                  </div>
                  <span className="text-[12px] font-medium text-[#7f8fa5]">
                    Delete an investor here to remove their mapping graph.
                  </span>
                </div>
                <div className="mt-5 grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                  {investors.map((inv) => {
                    const count = investorMappingCounts[inv.id] || 0;
                    const companyCount = new Set(
                      mappings
                        .filter((m) => m.angel_investor_id === inv.id)
                        .map((m) => m.company_name || "Unknown Company")
                    ).size;

                    return (
                      <div key={inv.id} className="group px-5 py-5" style={ANGEL_SURFACE.panel}>
                        <div className="flex items-start gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#dff4f2] text-[#14766f]">
                            <Network className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-[14px] font-bold text-[#1d2b3c]">{inv.name}</p>
                                <p className="mt-1 text-[12px] text-[#6c8196]">
                                  {inv.current_role && inv.current_company
                                    ? `${inv.current_role} @ ${inv.current_company}`
                                    : inv.current_role || inv.current_company || "Role or firm not added yet"}
                                </p>
                              </div>
                              <button
                                onClick={() => handleDeleteInvestor(inv.id)}
                                className="opacity-0 group-hover:opacity-100 rounded-lg p-1 text-[#aac0d4] transition hover:bg-[#fff2f2] hover:text-[#c0392b]"
                                title="Delete investor"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="mt-5 flex items-center gap-2 flex-wrap">
                              <span className="rounded-full bg-[#edf8f7] px-3 py-1.5 text-[11px] font-bold text-[#14766f]">
                                {count} mapped path{count === 1 ? "" : "s"}
                              </span>
                              {count > 0 && (
                                <span className="text-[11px] text-[#8aa0b4]">
                                  Active on {companyCount} account{companyCount === 1 ? "" : "s"}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Mapping cards grouped by company */}
            {angelLoading ? (
              <div className="crm-panel p-14 text-center crm-muted">Loading angel mappings...</div>
            ) : groupedByCompany.length === 0 ? (
              <div className="crm-panel p-14 text-center text-[#6f8297]" style={ANGEL_SURFACE.panel}>
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center" style={{ borderRadius: 18, background: "#ecf7f6", color: "#16857d" }}>
                  <Network className="h-7 w-7" />
                </div>
                <p className="text-[17px] font-semibold text-[#2e4359]">No angel mappings in view yet</p>
                <p className="mx-auto mt-2 max-w-lg text-[13px] leading-6">
                  Import relationship data or add investors first, then use strength filters to focus the best warm-introduction paths.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {groupedByCompany.map(({ companyName, contacts: companyContacts, totalMappings, maxStrength }) => (
                  <div
                    key={companyName}
                    className="crm-panel overflow-hidden transition-all"
                    style={{
                      ...ANGEL_SURFACE.companyCard,
                      boxShadow: expandedCompany === companyName
                        ? "0 18px 36px rgba(17, 34, 68, 0.1), 0 0 0 1px #dce8f7 inset"
                        : ANGEL_SURFACE.companyCard.boxShadow,
                    }}
                  >
                    <button
                      onClick={() => setExpandedCompany(expandedCompany === companyName ? null : companyName)}
                      className="w-full px-7 py-6 text-left transition-colors"
                      style={{
                        background: expandedCompany === companyName
                          ? "linear-gradient(180deg, #f7fbff 0%, #f4f9fd 100%)"
                          : "#ffffff",
                      }}
                    >
                      <div className="flex flex-wrap items-start gap-4 lg:flex-nowrap lg:items-center">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center" style={{ borderRadius: 18, background: "#eaf3ff", color: "#1f6feb" }}>
                            <Building2 className="h-4 w-4" />
                          </div>
                          <div className="flex items-center gap-3">
                            {expandedCompany === companyName
                              ? <ChevronDown className="h-4 w-4 text-[#8094a8]" />
                              : <ChevronRight className="h-4 w-4 text-[#8094a8]" />
                            }
                            <div>
                              <p className="text-[16px] font-bold text-[#1d2b3c]">{companyName}</p>
                              <p className="mt-1.5 text-[12px] text-[#72879c]">
                                {companyContacts.length} stakeholder{companyContacts.length === 1 ? "" : "s"} with mapped intros
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2.5 lg:ml-auto">
                          <span className="px-3.5 py-1.5 text-[11px] font-bold" style={{ borderRadius: 999, background: "#eef5ff", color: "#235dc6" }}>
                            {totalMappings} connection{totalMappings === 1 ? "" : "s"}
                          </span>
                          <span className="px-3.5 py-1.5 text-[11px] font-semibold" style={{ borderRadius: 999, background: "#f5f9fc", color: "#70849a" }}>
                            {companyContacts.filter((contact) => contact.mappings.some((mapping) => mapping.strength >= 4)).length} ready for warm intro
                          </span>
                          <StrengthBadge strength={maxStrength} labelPrefix="Best path" />
                        </div>
                      </div>
                    </button>

                    {expandedCompany === companyName && (
                      <div className="border-t border-[#e8eef5] p-6" style={{ background: "#fbfdff" }}>
                        <div className="space-y-5">
                          {companyContacts.map(({ name, title, linkedin, mappings: contactMappings }) => (
                            <div key={name} className="overflow-hidden" style={ANGEL_SURFACE.contactCard}>
                              <div
                                className="flex flex-wrap items-center gap-4 border-b border-[#eef3f8] px-6 py-5"
                                style={{ background: "linear-gradient(180deg, #ffffff 0%, #f9fbff 100%)" }}
                              >
                                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${avatarColor(name)}`}>
                                  {getInitials(name)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-[14px] font-bold text-[#25384d]">{name}</span>
                                    {linkedin && (
                                      <a href={linkedin} target="_blank" rel="noopener noreferrer" className="text-[#2b6cb0] hover:text-[#1a4f8a]">
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </a>
                                    )}
                                  </div>
                                  {title && <p className="mt-1.5 text-[13px] text-[#7a8ea4]">{title}</p>}
                                </div>
                                <div className="px-3.5 py-1.5 text-[11px] font-semibold" style={{ borderRadius: 999, background: "#f2f6fb", color: "#6f8399" }}>
                                  {contactMappings.length} path{contactMappings.length === 1 ? "" : "s"}
                                </div>
                              </div>

                              <div className="space-y-4 p-5">
                                {contactMappings
                                  .sort((a, b) => a.rank - b.rank)
                                  .map((m) => (
                                    <div key={m.id} className="group transition" style={ANGEL_SURFACE.pathCard}>
                                      <div className="flex items-start gap-5">
                                        <div
                                          className="flex h-9 w-9 shrink-0 items-center justify-center text-[11px] font-mono font-bold"
                                          style={{ borderRadius: 12, background: "#eef4fb", color: "#5f7992" }}
                                        >
                                          #{m.rank}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center gap-2.5">
                                            <span className="text-[14px] font-bold text-[#145d97]">{m.angel_name}</span>
                                            {m.angel_current_company && (
                                              <span className="text-[12px] text-[#7f8fa5]" style={{ lineHeight: 1.6 }}>
                                                {m.angel_current_role ? `${m.angel_current_role} @ ` : ""}
                                                {m.angel_current_company}
                                              </span>
                                            )}
                                            <StrengthBadge strength={m.strength} />
                                          </div>
                                          {m.connection_path && (
                                            <div
                                              className="mt-4 px-4 py-3.5 text-[13px] leading-7 text-[#55657a]"
                                              style={{ borderRadius: 16, background: "#f2f7fc" }}
                                            >
                                              <span className="font-semibold text-[#30465f]">Path</span>
                                              <p className="mt-1">{m.connection_path}</p>
                                            </div>
                                          )}
                                          {m.why_it_works && (
                                            <p className="mt-4 text-[13px] leading-7 text-[#677f96]" style={{ marginBottom: 0 }}>
                                              <span className="font-semibold text-[#3a4e63]">Why it works:</span> {m.why_it_works}
                                            </p>
                                          )}
                                          {m.recommended_strategy && (
                                            <div
                                              className="mt-4 inline-flex items-center px-3.5 py-2 text-[11px] font-semibold"
                                              style={{ borderRadius: 999, background: "#e8f5f4", color: "#126b64" }}
                                            >
                                              Strategy: {m.recommended_strategy}
                                            </div>
                                          )}
                                        </div>
                                        <button
                                          onClick={() => handleDeleteMapping(m.id)}
                                          className="opacity-0 group-hover:opacity-100 rounded-lg p-1.5 text-[#b7c6d4] transition hover:bg-[#fff2f2] hover:text-[#c0392b]"
                                          title="Remove mapping"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Outreach drawer (contacts tab) */}
      <OutreachDrawer contact={selectedContact} onClose={() => setSelectedContact(null)} />

      {/* Add Investor modal */}
      {showAddInvestor && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowAddInvestor(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md border border-[#d9e1ec]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-bold text-[#1d2b3c] mb-4">Add Angel Investor</h2>
            <div className="space-y-3">
              <input
                placeholder="Name *"
                value={newInvestor.name}
                onChange={(e) => setNewInvestor({ ...newInvestor, name: e.target.value })}
                className="w-full h-11 px-4 rounded-xl border border-[#d7e2ee] bg-white text-[14px] placeholder-[#92a4b8] outline-none focus:border-[#1f6feb]"
                autoFocus
              />
              <input
                placeholder="Current Role (e.g. CEO, Partner)"
                value={newInvestor.current_role}
                onChange={(e) => setNewInvestor({ ...newInvestor, current_role: e.target.value })}
                className="w-full h-11 px-4 rounded-xl border border-[#d7e2ee] bg-white text-[14px] placeholder-[#92a4b8] outline-none focus:border-[#1f6feb]"
              />
              <input
                placeholder="Current Company"
                value={newInvestor.current_company}
                onChange={(e) => setNewInvestor({ ...newInvestor, current_company: e.target.value })}
                className="w-full h-11 px-4 rounded-xl border border-[#d7e2ee] bg-white text-[14px] placeholder-[#92a4b8] outline-none focus:border-[#1f6feb]"
              />
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setShowAddInvestor(false)}
                className="crm-button soft h-11 px-5 text-[13px]"
              >
                Cancel
              </button>
              <button
                onClick={handleAddInvestor}
                className="h-11 px-5 rounded-xl bg-[#1f6feb] text-white text-[13px] font-semibold hover:bg-[#1960d1] transition-colors"
              >
                Add Investor
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ProspectingTabButton({
  active,
  icon,
  label,
  description,
  count,
  countLabel,
  accent,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  description: string;
  count: number;
  countLabel: string;
  accent: "blue" | "teal";
  onClick: () => void;
}) {
  const accentStyles = active
    ? accent === "blue"
      ? {
          shell: {
            borderColor: "transparent",
            background: "linear-gradient(135deg, #1c4f93 0%, #1f6feb 100%)",
            boxShadow: "0 16px 32px rgba(31, 111, 235, 0.22)",
            color: "#ffffff",
          },
          icon: { background: "rgba(255,255,255,0.14)", color: "#ffffff" },
          badge: { background: "rgba(255,255,255,0.14)", color: "#ffffff" },
        }
      : {
          shell: {
            borderColor: "transparent",
            background: "linear-gradient(135deg, #124a4c 0%, #1b8a86 100%)",
            boxShadow: "0 16px 32px rgba(27, 138, 134, 0.22)",
            color: "#ffffff",
          },
          icon: { background: "rgba(255,255,255,0.14)", color: "#ffffff" },
          badge: { background: "rgba(255,255,255,0.14)", color: "#ffffff" },
        }
    : accent === "blue"
      ? {
          shell: {
            borderColor: "#d9e1ec",
            background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
            boxShadow: "0 8px 20px rgba(17, 34, 68, 0.04)",
            color: "#1d2b3c",
          },
          icon: { background: "#eaf2ff", color: "#1f6feb" },
          badge: { background: "#edf4ff", color: "#1f6feb" },
        }
      : {
          shell: {
            borderColor: "#d9e1ec",
            background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
            boxShadow: "0 8px 20px rgba(17, 34, 68, 0.04)",
            color: "#1d2b3c",
          },
          icon: { background: "#e7f7f5", color: "#177b75" },
          badge: { background: "#edf9f8", color: "#177b75" },
        };

  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-[250px] flex-1 border p-4 text-left transition-all"
      style={{ borderRadius: 22, ...accentStyles.shell }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center"
          style={{ borderRadius: 18, ...accentStyles.icon }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[15px] font-bold">{label}</p>
              <p
                className="mt-1 text-[12px] leading-5"
                style={{ color: active ? "rgba(255,255,255,0.78)" : "#6f8297" }}
              >
                {description}
              </p>
            </div>
            <span
              className="shrink-0 px-2.5 py-1 text-[11px] font-bold"
              style={{ borderRadius: 999, ...accentStyles.badge }}
            >
              {count}
            </span>
          </div>
          <p
            className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: active ? "rgba(255,255,255,0.62)" : "#90a3b8" }}
          >
            {countLabel}
          </p>
        </div>
      </div>
    </button>
  );
}

function AngelOverviewCard({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption: string;
  tone: "blue" | "teal" | "amber" | "green";
}) {
  const toneStyles = {
    blue: { background: "#eef5ff", color: "#1f6feb" },
    teal: { background: "#e8f7f6", color: "#177b75" },
    amber: { background: "#fff5e6", color: "#b56d00" },
    green: { background: "#eaf8f0", color: "#1f8f5f" },
  }[tone];

  return (
    <div
      className="p-0"
      style={{
        padding: "20px 20px 18px",
        borderRadius: 22,
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(255,255,255,0.1)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center"
          style={{ borderRadius: 18, ...toneStyles }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.62)" }}>{label}</p>
          <p className="mt-3 text-[30px] font-bold leading-none" style={{ color: "#ffffff" }}>{value}</p>
          <p className="mt-3 text-[12px] leading-6" style={{ color: "rgba(255,255,255,0.72)" }}>{caption}</p>
        </div>
      </div>
    </div>
  );
}

function SnapshotRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "teal" | "green";
}) {
  const toneStyles = {
    blue: { background: "#eef5ff", color: "#235dc6" },
    teal: { background: "#edf9f8", color: "#177b75" },
    green: { background: "#eaf8f0", color: "#1f8f5f" },
  }[tone];

  return (
    <div
      className="flex items-center justify-between px-4 py-3"
      style={{ borderRadius: 18, border: "1px solid #e4edf5", background: "#fbfdff", padding: "14px 16px" }}
    >
      <span className="text-[13px] font-medium text-[#60758a]">{label}</span>
      <span className="px-2.5 py-1 text-[11px] font-bold" style={{ borderRadius: 999, ...toneStyles }}>{value}</span>
    </div>
  );
}

function StrengthBadge({
  strength,
  compact = false,
  labelPrefix,
}: {
  strength: number;
  compact?: boolean;
  labelPrefix?: string;
}) {
  return (
    <span
      className={`inline-flex items-center font-bold ${compact ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-[11px]"}`}
      style={{ borderRadius: 999, ...(STRENGTH_STYLE[strength] || {}) }}
    >
      {labelPrefix ? `${labelPrefix}: ` : ""}
      {strength}/5
    </span>
  );
}
