import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { accountSourcingApi, angelMappingApi, authApi, contactsApi, settingsApi } from "../lib/api";
import type { Contact, AngelInvestor, AngelMapping, RolePermissionsSettings, User } from "../types";
import { useAuth } from "../lib/AuthContext";
import {
  Search, Users, CheckCircle2, XCircle, Sparkles, Trash2, AlertCircle, Loader2,
  Network, ChevronDown, ChevronRight, ExternalLink, Star, Plus, Link2,
  Building2, Target, Settings2, Phone, Upload, Download,
} from "lucide-react";
import { avatarColor, getInitials } from "../lib/utils";
import {
  getProspectTrackingScore,
  getProspectTrackingStage,
  getProspectTrackingSummary,
  getProspectTrackingTone,
} from "../lib/prospectTracking";
import OutreachDrawer from "../components/outreach/OutreachDrawer";
import SequenceSettingsModal from "../components/outreach/SequenceSettingsModal";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, user } = useAuth();
  const [tab, setTab] = useState<ProspectingTab>("contacts");
  const pageSize = 50;

  // ── Contacts state — initialised from URL so filters survive navigation ──
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [personaFilter, setPersonaFilter] = useState(() => searchParams.get("persona") ?? "");
  const [laneFilter, setLaneFilter] = useState(() => searchParams.get("lane") ?? "");
  const [sequenceFilter, setSequenceFilter] = useState(() => searchParams.get("seq") ?? "");
  const [emailFilter, setEmailFilter] = useState(() => searchParams.get("email") ?? "");
  const [aeFilter, setAeFilter] = useState(() => searchParams.get("ae") ?? "");
  const [sdrFilter, setSdrFilter] = useState(() => searchParams.get("sdr") ?? "");
  const [teamUsers, setTeamUsers] = useState<User[]>([]);
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("q") ?? "");
  const [page, setPage] = useState(() => parseInt(searchParams.get("pg") ?? "1", 10) || 1);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [contactsPages, setContactsPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [resetting, setResetting] = useState(false);
  const [showSequenceSettings, setShowSequenceSettings] = useState(false);
  const [uploadingProspects, setUploadingProspects] = useState(false);
  const [rolePermissions, setRolePermissions] = useState<RolePermissionsSettings | null>(null);
  const [importSummary, setImportSummary] = useState<{
    imported_rows: number;
    created_count: number;
    updated_count: number;
    skipped_count: number;
    missing_company_count: number;
    missing_companies: { name: string; domain?: string; contacts_count: number }[];
    message: string;
  } | null>(null);
  const [creatingMissingCompanies, setCreatingMissingCompanies] = useState(false);
  const [enrichingMissingKey, setEnrichingMissingKey] = useState<string | null>(null);

  // ── Angel mapping state ──────────────────────────────────────────────
  const [mappings, setMappings] = useState<AngelMapping[]>([]);
  const [investors, setInvestors] = useState<AngelInvestor[]>([]);
  const [angelLoading, setAngelLoading] = useState(true);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [angelSearch, setAngelSearch] = useState("");
  const [filterStrength, setFilterStrength] = useState<number>(0);
  const [showAddInvestor, setShowAddInvestor] = useState(false);
  const [newInvestor, setNewInvestor] = useState({ name: "", current_role: "", current_company: "" });
  const [showAddProspect, setShowAddProspect] = useState(false);
  const [addProspectForm, setAddProspectForm] = useState({ first_name: "", last_name: "", email: "", phone: "", title: "", linkedin_url: "" });
  const [addProspectSaving, setAddProspectSaving] = useState(false);
  const [addProspectError, setAddProspectError] = useState("");
  const canMigrateProspects =
    isAdmin || Boolean(user && user.role !== "admin" && rolePermissions?.[user.role]?.prospect_migration);

  const loadContacts = () => {
    setLoading(true);
    contactsApi.searchPaginated({
      skip: (page - 1) * pageSize,
      limit: pageSize,
      q: debouncedSearch || undefined,
      persona: personaFilter || undefined,
      outreachLane: laneFilter || undefined,
      sequenceStatus: sequenceFilter || undefined,
      emailState: emailFilter || undefined,
      aeId: aeFilter || undefined,
      sdrId: sdrFilter || undefined,
    }).then((result) => {
      setContacts(result.items);
      setContactsTotal(result.total);
      setContactsPages(result.pages);
    }).finally(() => setLoading(false));
  };

  const downloadProspectTemplate = () => {
    const template = [
      ["Company Name", "Domain", "First Name", "Last Name", "Title", "Email", "LinkedIn URL", "Phone"],
      ["BlackLine", "blackline.com", "Victoria", "Subbotina", "Director of Professional Services", "victoria.subbotina@blackline.com", "https://linkedin.com/in/victoriasubbotina", "+15135330040"],
    ]
      .map((row) => row.join(","))
      .join("\n");
    const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "beacon-prospect-upload-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleProspectUpload = async (file: File) => {
    setUploadingProspects(true);
    try {
      const result = await contactsApi.importCsv(file);
      setImportSummary(result);
      setPage(1);
      loadContacts();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to import prospects");
    } finally {
      setUploadingProspects(false);
    }
  };

  const removeMissingCompanyFromSummary = (name: string, domain?: string) => {
    setImportSummary((current) => {
      if (!current) return current;
      const nextMissing = current.missing_companies.filter(
        (company) => !(company.name === name && (company.domain || "") === (domain || ""))
      );
      return {
        ...current,
        missing_company_count: nextMissing.length,
        missing_companies: nextMissing,
      };
    });
  };

  const handleEnrichMissingCompany = async (company: { name: string; domain?: string }) => {
    const shouldEnrich = window.confirm(
      `Beacon already created a placeholder account for ${company.name}. Do you want to start enrichment now?`
    );
    if (!shouldEnrich) return;

    const key = `${company.domain || ""}-${company.name}`;
    setEnrichingMissingKey(key);
    try {
      await accountSourcingApi.createManualCompany({
        name: company.name,
        domain: company.domain,
      });
      removeMissingCompanyFromSummary(company.name, company.domain);
      window.alert(`${company.name} was queued for enrichment.`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to queue company enrichment");
    } finally {
      setEnrichingMissingKey(null);
    }
  };

  const handleCreateMissingCompanies = async () => {
    if (!importSummary?.missing_companies.length) return;
    const shouldEnrich = window.confirm(
      `Beacon created ${importSummary.missing_company_count} placeholder compan${importSummary.missing_company_count === 1 ? "y" : "ies"}. Do you want to start enrichment for ${importSummary.missing_company_count === 1 ? "it" : "them"} now?`
    );
    if (!shouldEnrich) return;

    setCreatingMissingCompanies(true);
    try {
      for (const company of importSummary.missing_companies) {
        await accountSourcingApi.createManualCompany({
          name: company.name,
          domain: company.domain,
        });
      }
      setImportSummary((current) =>
        current
          ? { ...current, missing_company_count: 0, missing_companies: [] }
          : current
      );
      window.alert("The placeholder companies were queued for enrichment.");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to queue missing companies");
    } finally {
      setCreatingMissingCompanies(false);
    }
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
    loadAngels();
  }, []);

  useEffect(() => {
    settingsApi.getRolePermissions().then(setRolePermissions).catch(() => setRolePermissions(null));
  }, []);

  useEffect(() => {
    authApi.listUsers().then(setTeamUsers).catch(() => setTeamUsers([]));
  }, []);

  useEffect(() => {
    setTab(location.pathname === "/angel-mapping" ? "angel-mapping" : "contacts");
  }, [location.pathname]);

  // Sync all filter state into URL so navigating away and back restores position
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      search.trim() ? next.set("q", search.trim()) : next.delete("q");
      personaFilter ? next.set("persona", personaFilter) : next.delete("persona");
      laneFilter ? next.set("lane", laneFilter) : next.delete("lane");
      sequenceFilter ? next.set("seq", sequenceFilter) : next.delete("seq");
      emailFilter ? next.set("email", emailFilter) : next.delete("email");
      aeFilter ? next.set("ae", aeFilter) : next.delete("ae");
      sdrFilter ? next.set("sdr", sdrFilter) : next.delete("sdr");
      page > 1 ? next.set("pg", String(page)) : next.delete("pg");
      return next;
    }, { replace: true });
  }, [search, personaFilter, laneFilter, sequenceFilter, emailFilter, aeFilter, sdrFilter, page]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, personaFilter, laneFilter, sequenceFilter, emailFilter, aeFilter, sdrFilter]);

  useEffect(() => {
    if (tab !== "contacts") return;
    loadContacts();
  }, [tab, page, debouncedSearch, personaFilter, laneFilter, sequenceFilter, emailFilter, aeFilter, sdrFilter]);

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
        {/* ── Tab switcher + action bar ──────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Row 1 — tab cards */}
          <div style={{ display: "flex", gap: 12 }}>
            {/* Contacts tab */}
            <button
              type="button"
              onClick={() => handleTabChange("contacts")}
              style={{
                flex: 1, display: "flex", alignItems: "center", gap: 14,
                padding: "16px 20px", borderRadius: 16, cursor: "pointer",
                border: tab === "contacts" ? "1.5px solid #b8d0f0" : "1.5px solid #e8eef5",
                background: tab === "contacts"
                  ? "linear-gradient(135deg, #f0f6ff 0%, #e8f0fb 100%)"
                  : "#fff",
                boxShadow: tab === "contacts"
                  ? "0 4px 16px rgba(23, 80, 137, 0.08)"
                  : "0 2px 8px rgba(17,34,68,0.04)",
                transition: "all 0.15s ease",
                textAlign: "left",
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: tab === "contacts" ? "#175089" : "#eaf2ff",
                color: tab === "contacts" ? "#fff" : "#175089",
              }}>
                <Users size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#0f2744" }}>Contacts</span>
                  <span style={{
                    fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 999,
                    background: tab === "contacts" ? "#175089" : "#e8f0fb",
                    color: tab === "contacts" ? "#fff" : "#175089",
                  }}>{contactsTotal}</span>
                </div>
                <div style={{ fontSize: 12, color: "#7a96b0", marginTop: 2 }}>
                  Stakeholders, personas, and outreach readiness
                </div>
              </div>
            </button>

            {/* Angel Mapping tab — hidden */}
            {false && <button
              type="button"
              onClick={() => handleTabChange("angel-mapping")}
              style={{
                flex: 1, display: "flex", alignItems: "center", gap: 14,
                padding: "16px 20px", borderRadius: 16, cursor: "pointer",
                border: tab === "angel-mapping" ? "1.5px solid #b2e0dc" : "1.5px solid #e8eef5",
                background: tab === "angel-mapping"
                  ? "linear-gradient(135deg, #f0faf9 0%, #e6f5f4 100%)"
                  : "#fff",
                boxShadow: tab === "angel-mapping"
                  ? "0 4px 16px rgba(23, 123, 117, 0.08)"
                  : "0 2px 8px rgba(17,34,68,0.04)",
                transition: "all 0.15s ease",
                textAlign: "left",
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: tab === "angel-mapping" ? "#177b75" : "#e7f7f5",
                color: tab === "angel-mapping" ? "#fff" : "#177b75",
              }}>
                <Network size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#0f2744" }}>Angel Mapping</span>
                  <span style={{
                    fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 999,
                    background: tab === "angel-mapping" ? "#177b75" : "#e7f7f5",
                    color: tab === "angel-mapping" ? "#fff" : "#177b75",
                  }}>{mappings.length}</span>
                </div>
                <div style={{ fontSize: 12, color: "#7a96b0", marginTop: 2 }}>
                  Warm intro paths from investors into target accounts
                </div>
              </div>
            </button>}
          </div>

          {/* Row 2 — contextual action bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "#fff", borderRadius: 14,
            border: "1px solid #e8eef5",
            padding: "10px 14px",
            boxShadow: "0 2px 8px rgba(17,34,68,0.04)",
            flexWrap: "wrap",
          }}>
            {tab === "contacts" && (
              <>
                {/* Search — left aligned, grows */}
                <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
                  <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#94a8bc", pointerEvents: "none" }} />
                  <input
                    style={{
                      width: "100%", height: 38, borderRadius: 10,
                      border: "1px solid #e0eaf4", background: "#f7fbff",
                      paddingLeft: 34, paddingRight: 12,
                      fontSize: 13, color: "#1e3a52", outline: "none",
                    }}
                    placeholder="Search people, title, email…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                {/* Sequence Timing */}
                <button
                  type="button"
                  title="Sequence timing settings"
                  onClick={() => setShowSequenceSettings(true)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    height: 38, padding: "0 14px", borderRadius: 10,
                    border: "1px solid #d0dcea", background: "#f7fbff",
                    color: "#2c4a63", fontSize: 13, fontWeight: 600,
                    cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  <Settings2 size={14} />
                  Sequence Timing
                </button>

                <button
                  type="button"
                  onClick={downloadProspectTemplate}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    height: 38, padding: "0 14px", borderRadius: 10,
                    border: "1px solid #d0dcea", background: "#ffffff",
                    color: "#2c4a63", fontSize: 13, fontWeight: 600,
                    cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  <Download size={14} />
                  Template
                </button>

                <label
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    height: 38, padding: "0 14px", borderRadius: 10,
                    border: "1px solid #b8d0f0", background: "#eef5ff",
                    color: "#175089", fontSize: 13, fontWeight: 700,
                    cursor: uploadingProspects || !canMigrateProspects ? "default" : "pointer", whiteSpace: "nowrap", flexShrink: 0,
                    opacity: uploadingProspects || !canMigrateProspects ? 0.7 : 1,
                  }}
                >
                  {uploadingProspects ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Migrate Prospects
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    style={{ display: "none" }}
                    disabled={uploadingProspects || !canMigrateProspects}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void handleProspectUpload(file);
                      }
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                {/* Clear — danger, right side */}
                {isAdmin && (
                  <button
                    type="button"
                    disabled={resetting}
                    onClick={async () => {
                      if (!window.confirm("Clear all Prospecting contacts, outreach sequences, and contact activities while keeping companies?")) return;
                      setResetting(true);
                      try {
                        const result = await accountSourcingApi.resetData("prospecting");
                        setPage(1);
                        loadContacts();
                        window.alert(`Prospecting cleared.\n${Object.entries(result.summary).map(([key, value]) => `${key}: ${value}`).join("\n")}`);
                      } finally {
                        setResetting(false);
                      }
                    }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      height: 38, padding: "0 14px", borderRadius: 10,
                      border: "1px solid #fad2d6", background: "#fff8f8",
                      color: "#b42336", fontSize: 13, fontWeight: 600,
                      cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                      opacity: resetting ? 0.6 : 1,
                    }}
                  >
                    {resetting ? <Loader2 size={13} className="animate-spin" /> : <AlertCircle size={13} />}
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowAddProspect(true)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    height: 38, padding: "0 14px", borderRadius: 10,
                    border: "1px solid #c7d5e5", background: "#fff",
                    color: "#175089", fontSize: 13, fontWeight: 700,
                    cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  <Plus size={14} />
                  Add Prospect
                </button>
              </>
            )}

            {tab === "angel-mapping" && (
              <>
                <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
                  <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#94a8bc", pointerEvents: "none" }} />
                  <input
                    style={{
                      width: "100%", height: 38, borderRadius: 10,
                      border: "1px solid #e0eaf4", background: "#f7fbff",
                      paddingLeft: 34, paddingRight: 12,
                      fontSize: 13, color: "#1e3a52", outline: "none",
                    }}
                    placeholder="Search company, prospect, angel…"
                    value={angelSearch}
                    onChange={(e) => setAngelSearch(e.target.value)}
                  />
                </div>
                <button
                  onClick={() => setShowAddInvestor(true)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    height: 38, padding: "0 14px", borderRadius: 10,
                    border: "1px solid #b2e0dc", background: "#f0faf9",
                    color: "#177b75", fontSize: 13, fontWeight: 600,
                    cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  <Plus size={14} />
                  Add Investor
                </button>
              </>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* CONTACTS TAB                                                   */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === "contacts" && (
          <>
            <div
              style={{
                background: "#fff8e8",
                border: "1px solid #f5ddaa",
                borderRadius: 14,
                padding: "12px 16px",
                display: "flex",
                alignItems: "start",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ color: "#8a5b00", fontSize: 12, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase" }}>
                  Prospect sourcing update
                </div>
                <div style={{ color: "#6c5a2f", fontSize: 13, lineHeight: 1.6, maxWidth: 860 }}>
                  Beacon is temporarily not pulling contacts during company research. Use this to migrate prospects into Beacon and map them onto sourced companies. If a company is missing, Beacon will ask whether you want to add and enrich that account now.
                </div>
              </div>
            </div>

            {/* Filters */}
            {(() => {
              const hasFilters = !!(personaFilter || laneFilter || sequenceFilter || emailFilter || aeFilter || sdrFilter || search);
              const selectStyle = (active: boolean): CSSProperties => ({
                appearance: "none" as const,
                WebkitAppearance: "none" as const,
                height: 36, paddingLeft: 12, paddingRight: 30,
                borderRadius: 9,
                border: active ? "1.5px solid #175089" : "1px solid #dce8f4",
                background: active ? "#eef5ff" : "#f7fbff",
                color: active ? "#175089" : "#4a6580",
                fontSize: 13, fontWeight: active ? 600 : 500,
                cursor: "pointer", outline: "none",
                minWidth: 0,
              });
              return (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                  background: "#fff", borderRadius: 14,
                  border: "1px solid #e8eef5",
                  padding: "10px 14px",
                  boxShadow: "0 2px 8px rgba(17,34,68,0.04)",
                  position: "sticky",
                  top: 16,
                  zIndex: 5,
                }}>
                  {/* Selects */}
                  {[
                    {
                      value: personaFilter, onChange: setPersonaFilter,
                      options: [["", "All personas"], ["economic_buyer", "Economic Buyer"], ["champion", "Champion"], ["technical_evaluator", "Tech Evaluator"], ["unknown", "Unknown"]],
                    },
                    {
                      value: laneFilter, onChange: setLaneFilter,
                      options: [["", "All lanes"], ["warm_intro", "Warm Intro"], ["event_follow_up", "Event Follow-up"], ["cold_operator", "Cold Operator"], ["cold_strategic", "Cold Strategic"]],
                    },
                    {
                      value: sequenceFilter, onChange: setSequenceFilter,
                      options: [["", "All sequence states"], ["research_needed", "Research Needed"], ["ready", "Ready"], ["queued_instantly", "Queued — Instantly"], ["sent", "Sent"], ["replied", "Replied"], ["meeting_booked", "Meeting Booked"]],
                    },
                    {
                      value: emailFilter, onChange: setEmailFilter,
                      options: [["", "All email states"], ["has_email", "Has email"], ["missing_email", "Missing email"], ["verified", "Verified"], ["unverified", "Unverified"]],
                    },
                  ].map((f, i) => (
                    <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                      <select
                        value={f.value}
                        onChange={(e) => f.onChange(e.target.value)}
                        style={selectStyle(!!f.value)}
                      >
                        {(f.options as [string, string][]).map(([val, label]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>
                      <ChevronDown
                        size={13}
                        style={{
                          position: "absolute", right: 9, top: "50%",
                          transform: "translateY(-50%)",
                          color: f.value ? "#175089" : "#94a8bc",
                          pointerEvents: "none",
                        }}
                      />
                    </div>
                  ))}

                  {/* Owner filters */}
                  {teamUsers.length > 0 && (
                    <>
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <select
                          value={aeFilter}
                          onChange={(e) => setAeFilter(e.target.value)}
                          style={selectStyle(!!aeFilter)}
                        >
                          <option value="">AE: All</option>
                          {teamUsers.map((u) => (
                            <option key={u.id} value={u.id}>{u.name || u.email}</option>
                          ))}
                        </select>
                        <ChevronDown size={13} style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: aeFilter ? "#175089" : "#94a8bc", pointerEvents: "none" }} />
                      </div>
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <select
                          value={sdrFilter}
                          onChange={(e) => setSdrFilter(e.target.value)}
                          style={selectStyle(!!sdrFilter)}
                        >
                          <option value="">SDR: All</option>
                          {teamUsers.map((u) => (
                            <option key={u.id} value={u.id}>{u.name || u.email}</option>
                          ))}
                        </select>
                        <ChevronDown size={13} style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", color: sdrFilter ? "#175089" : "#94a8bc", pointerEvents: "none" }} />
                      </div>
                    </>
                  )}

                  {/* Divider */}
                  <div style={{ flex: 1 }} />

                  {/* Count */}
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: "#4a6580",
                    background: "#f0f5fb", border: "1px solid #dce8f4",
                    borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap",
                  }}>
                    {contactsTotal === 0 ? "0 shown" : `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, contactsTotal)} of ${contactsTotal}`}
                  </span>

                  {/* Reset — only when filters active */}
                  {hasFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch(""); setPersonaFilter("");
                        setLaneFilter(""); setSequenceFilter(""); setEmailFilter("");
                        setAeFilter(""); setSdrFilter("");
                      }}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        height: 34, padding: "0 12px", borderRadius: 9,
                        border: "1px solid #dce8f4", background: "#fff",
                        color: "#4a6580", fontSize: 12, fontWeight: 600,
                        cursor: "pointer", whiteSpace: "nowrap",
                      }}
                    >
                      <XCircle size={12} />
                      Reset
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Contacts Table */}
            {loading ? (
              <div className="crm-panel p-14 text-center crm-muted">Loading contacts...</div>
            ) : contacts.length === 0 ? (
              <div className="crm-panel p-14 text-center text-[#6f8297]">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-30" />
                No contacts match your search.
              </div>
            ) : (
              <div className="crm-panel overflow-hidden contacts-table-panel">
                <div className="overflow-x-auto">
                  <table className="crm-table" style={{ minWidth: 1360 }}>
                    <thead>
                      <tr>
                        <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#f7faff" }}>Name</th>
                        <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#f7faff" }}>Company</th>
                        <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#f7faff" }}>Title</th>
                        <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#f7faff" }}>Email</th>
                        <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#f7faff" }}>Stage</th>
                        <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#f7faff" }}>Progress</th>
                        <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#f7faff" }}>Persona</th>
                        <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#f7faff" }}>AE</th>
                        <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#f7faff" }}>SDR</th>
                        <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#f7faff" }}>Verified</th>
                        <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#f7faff" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((c) => (
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
                            {c.company_name ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); navigate(`/companies/${c.company_id}`); }}
                                className="text-[#2b6cb0] font-semibold text-[13px] hover:underline"
                              >
                                {c.company_name}
                              </button>
                            ) : (
                              <span className="text-[#96a7ba]">-</span>
                            )}
                          </td>
                          <td>{c.title ?? <span className="text-[#96a7ba]">-</span>}</td>
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                              {c.email
                                ? <span style={{ fontSize: 13, color: "#1e3a52", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</span>
                                : <span className="text-[#96a7ba]">-</span>
                              }
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                                {c.phone && (
                                  <a
                                    href={`tel:${c.phone}`}
                                    title={c.phone}
                                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#175089", textDecoration: "none", background: "#eaf2ff", border: "1px solid #c8daf0", borderRadius: 6, padding: "2px 7px" }}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      if (window.__aircallDial) window.__aircallDial(c.phone!, `${c.first_name} ${c.last_name}`);
                                    }}
                                  >
                                    <Phone size={11} />
                                    {c.phone}
                                  </a>
                                )}
                                {c.linkedin_url && (
                                  <a
                                    href={c.linkedin_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="LinkedIn profile"
                                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#0a66c2", textDecoration: "none", background: "#e8f2ff", border: "1px solid #b8d4f0", borderRadius: 6, padding: "2px 7px" }}
                                  >
                                    <Link2 size={11} />
                                    LinkedIn
                                  </a>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            {(() => {
                              const tone = getProspectTrackingTone(c);
                              return (
                                <div
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    padding: "6px 10px",
                                    borderRadius: 999,
                                    background: tone.background,
                                    border: `1px solid ${tone.border}`,
                                    color: tone.color,
                                    fontSize: 11,
                                    fontWeight: 800,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {getProspectTrackingStage(c)}
                                </div>
                              );
                            })()}
                          </td>
                          <td>
                            {(() => {
                              const tone = getProspectTrackingTone(c);
                              return (
                                <div
                                  style={{
                                    minWidth: 250,
                                    padding: "10px 12px",
                                    borderRadius: 14,
                                    background: tone.soft,
                                    border: `1px solid ${tone.border}`,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 10,
                                      marginBottom: 6,
                                    }}
                                  >
                                    <span style={{ color: tone.color, fontWeight: 800, fontSize: 12 }}>
                                      {getProspectTrackingScore(c)}
                                    </span>
                                    {c.tracking_last_activity_at ? (
                                      <span style={{ color: "#7a8ea4", fontSize: 11, fontWeight: 600 }}>
                                        {new Date(c.tracking_last_activity_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div style={{ color: "#4d6178", fontSize: 12.5, lineHeight: 1.5 }}>
                                    {getProspectTrackingSummary(c)}
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
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
                              onAssigned={() => loadContacts()}
                              role="ae"
                              label="AE"
                              compact
                            />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <AssignDropdown
                              entityType="contact"
                              entityId={c.id}
                              currentAssignedId={c.sdr_id}
                              currentAssignedName={c.sdr_name}
                              onAssigned={() => loadContacts()}
                              role="sdr"
                              label="SDR"
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
                              {c.phone && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.__aircallDial) {
                                      window.__aircallDial(c.phone!, `${c.first_name} ${c.last_name}`);
                                    }
                                  }}
                                  className="flex items-center justify-center h-12 w-12 rounded-xl text-[#175089] hover:text-[#fff] hover:bg-[#175089] transition-colors border border-[#c8d9ec]"
                                  title={`Call ${c.phone}`}
                                >
                                  <Phone className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!window.confirm(`Delete "${c.first_name} ${c.last_name}"?`)) return;
                                  await contactsApi.delete(c.id);
                                  if (contacts.length === 1 && page > 1) {
                                    setPage((current) => current - 1);
                                  } else {
                                    loadContacts();
                                  }
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
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderTop: "1px solid #e8eef5",
                  background: "#fbfdff",
                  flexWrap: "wrap",
                }}>
                  <span style={{ color: "#71839a", fontSize: 12, fontWeight: 600 }}>
                    Page {page} of {Math.max(contactsPages, 1)}
                  </span>
                  <div style={{ display: "inline-flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      disabled={page <= 1}
                      style={{
                        height: 34,
                        padding: "0 12px",
                        borderRadius: 9,
                        border: "1px solid #dce8f4",
                        background: page <= 1 ? "#f7f9fc" : "#ffffff",
                        color: page <= 1 ? "#9eb0c3" : "#4a6580",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: page <= 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((current) => Math.min(Math.max(contactsPages, 1), current + 1))}
                      disabled={page >= contactsPages}
                      style={{
                        height: 34,
                        padding: "0 12px",
                        borderRadius: 9,
                        border: "1px solid #dce8f4",
                        background: page >= contactsPages ? "#f7f9fc" : "#ffffff",
                        color: page >= contactsPages ? "#9eb0c3" : "#4a6580",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: page >= contactsPages ? "not-allowed" : "pointer",
                      }}
                    >
                      Next
                    </button>
                  </div>
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

      {/* Global sequence timing settings */}
      <SequenceSettingsModal
        open={showSequenceSettings}
        onClose={() => setShowSequenceSettings(false)}
      />

      {importSummary && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setImportSummary(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-2xl border border-[#d9e1ec]" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
              <div>
                <h2 className="text-[16px] font-bold text-[#1d2b3c] mb-1">Prospect upload complete</h2>
                <p className="text-[13px] text-[#6b7e92] mb-0">{importSummary.message}</p>
              </div>
              <button
                type="button"
                onClick={() => setImportSummary(null)}
                style={{ border: "1px solid #dce8f4", background: "#fff", color: "#5f7390", borderRadius: 10, width: 34, height: 34, cursor: "pointer" }}
              >
                <XCircle size={14} style={{ margin: "0 auto" }} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 18 }}>
              {[
                ["Rows", importSummary.imported_rows],
                ["Created", importSummary.created_count],
                ["Updated", importSummary.updated_count],
                ["Skipped", importSummary.skipped_count],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ border: "1px solid #dce8f4", borderRadius: 14, background: "#fbfdff", padding: "12px 14px" }}>
                  <div style={{ color: "#7f91ab", fontSize: 11, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase" }}>{label}</div>
                  <div style={{ color: "#1d2b3c", fontSize: 24, fontWeight: 800, marginTop: 6 }}>{value}</div>
                </div>
              ))}
            </div>

            {importSummary.missing_company_count > 0 && (
              <div style={{ marginTop: 18, border: "1px solid #f5ddaa", background: "#fff8e8", borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ color: "#8a5b00", fontSize: 12, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 8 }}>
                  Placeholder companies created
                </div>
                <div style={{ color: "#6c5a2f", fontSize: 13, lineHeight: 1.6 }}>
                  {importSummary.missing_company_count} compan{importSummary.missing_company_count === 1 ? "y was" : "ies were"} imported as a lightweight account so the prospects could migrate now. You can enrich or remap those accounts later when needed.
                </div>
                <div style={{ display: "grid", gap: 8, marginTop: 12, maxHeight: 200, overflowY: "auto" }}>
                  {importSummary.missing_companies.map((company) => (
                    <div
                      key={`${company.domain || ""}-${company.name}`}
                      style={{
                        border: "1px solid #ead6ab",
                        background: "#fffdf6",
                        borderRadius: 12,
                        padding: "10px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <div style={{ color: "#1d2b3c", fontWeight: 700, fontSize: 13 }}>{company.name}</div>
                        <div style={{ color: "#7d6d4f", fontSize: 12, marginTop: 2 }}>
                          {company.domain || "No domain provided"} · {company.contacts_count} prospect{company.contacts_count === 1 ? "" : "s"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleEnrichMissingCompany(company)}
                        disabled={enrichingMissingKey === `${company.domain || ""}-${company.name}` || creatingMissingCompanies}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          borderRadius: 10,
                          border: "1px solid #b8d0f0",
                          background: "#eef5ff",
                          color: "#175089",
                          padding: "8px 12px",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: enrichingMissingKey === `${company.domain || ""}-${company.name}` || creatingMissingCompanies ? "default" : "pointer",
                          opacity: enrichingMissingKey === `${company.domain || ""}-${company.name}` || creatingMissingCompanies ? 0.7 : 1,
                        }}
                      >
                        {enrichingMissingKey === `${company.domain || ""}-${company.name}` ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />}
                        Enrich account
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 14 }}>
                  <div style={{ color: "#7d6d4f", fontSize: 12.5 }}>
                    Choose enrich when you want Beacon to start researching one of these placeholder accounts. If you skip it for now, the prospects stay migrated and you can enrich later.
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCreateMissingCompanies()}
                    disabled={creatingMissingCompanies || importSummary.missing_companies.length === 0}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      borderRadius: 10, border: "1px solid #b8d0f0", background: "#eef5ff", color: "#175089",
                      padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: creatingMissingCompanies || importSummary.missing_companies.length === 0 ? "default" : "pointer",
                      opacity: creatingMissingCompanies || importSummary.missing_companies.length === 0 ? 0.7 : 1,
                    }}
                  >
                    {creatingMissingCompanies ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />}
                    Enrich all missing companies
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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

      {showAddProspect && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.25)", zIndex: 40 }} onClick={() => setShowAddProspect(false)} />
          <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 16 }}>
            <div style={{ width: "100%", maxWidth: 480, borderRadius: 20, background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", padding: 28 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1d2b3c" }}>Add Prospect</h3>
                <button type="button" onClick={() => setShowAddProspect(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#7f8fa5", fontSize: 18 }}>x</button>
              </div>
              {addProspectError && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12, fontWeight: 600 }}>{addProspectError}</div>}
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>First Name</label>
                    <input value={addProspectForm.first_name} onChange={(e) => setAddProspectForm((f) => ({ ...f, first_name: e.target.value }))} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="Jane" />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>Last Name</label>
                    <input value={addProspectForm.last_name} onChange={(e) => setAddProspectForm((f) => ({ ...f, last_name: e.target.value }))} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="Smith" />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>Email</label>
                  <input value={addProspectForm.email} onChange={(e) => setAddProspectForm((f) => ({ ...f, email: e.target.value }))} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="jane@company.com" type="email" />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>Phone</label>
                  <input value={addProspectForm.phone} onChange={(e) => setAddProspectForm((f) => ({ ...f, phone: e.target.value }))} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="+1 555 123 4567" />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>Job Title</label>
                  <input value={addProspectForm.title} onChange={(e) => setAddProspectForm((f) => ({ ...f, title: e.target.value }))} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="VP Engineering" />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>LinkedIn URL</label>
                  <input value={addProspectForm.linkedin_url} onChange={(e) => setAddProspectForm((f) => ({ ...f, linkedin_url: e.target.value }))} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="https://linkedin.com/in/..." />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <button type="button" onClick={() => setShowAddProspect(false)} disabled={addProspectSaving} style={{ height: 38, padding: "0 16px", borderRadius: 10, border: "1px solid #d9e1ec", background: "#fff", color: "#5e738b", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                <button type="button" disabled={addProspectSaving} onClick={async () => {
                  if (!addProspectForm.first_name.trim() && !addProspectForm.last_name.trim()) {
                    setAddProspectError("First or last name is required");
                    return;
                  }
                  setAddProspectSaving(true);
                  setAddProspectError("");
                  try {
                    await contactsApi.create({
                      first_name: addProspectForm.first_name.trim() || undefined,
                      last_name: addProspectForm.last_name.trim() || undefined,
                      email: addProspectForm.email.trim() || undefined,
                      phone: addProspectForm.phone.trim() || undefined,
                      title: addProspectForm.title.trim() || undefined,
                      linkedin_url: addProspectForm.linkedin_url.trim() || undefined,
                    } as Partial<Contact>);
                    setShowAddProspect(false);
                    setAddProspectForm({ first_name: "", last_name: "", email: "", phone: "", title: "", linkedin_url: "" });
                    loadContacts();
                  } catch (err) {
                    setAddProspectError(err instanceof Error ? err.message : "Failed to create prospect");
                  } finally {
                    setAddProspectSaving(false);
                  }
                }} style={{ height: 38, padding: "0 16px", borderRadius: 10, border: "none", background: "#175089", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  {addProspectSaving ? "Creating..." : "Add Prospect"}
                </button>
              </div>
            </div>
          </div>
        </>
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
