import { useEffect, useState, type CSSProperties } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  companiesApi,
  contactsApi,
  dealsApi,
  enrichmentApi,
  intelligenceApi,
  outreachApi,
  signalsApi,
} from "../lib/api";
import type { Company, Contact, Deal, Signal } from "../types";
import {
  ArrowLeft,
  BrainCircuit,
  ExternalLink,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { formatCurrency, formatDate, avatarColor, getInitials } from "../lib/utils";
import OutreachDrawer from "../components/outreach/OutreachDrawer";

const TIER_STYLE: Record<string, CSSProperties> = {
  hot: { color: "#8f2f11", background: "#ffe4d9", border: "1px solid #ffc5b3" },
  warm: { color: "#86581a", background: "#fff3dd", border: "1px solid #f7dda4" },
  monitor: { color: "#265179", background: "#eaf4ff", border: "1px solid #c7def8" },
  cold: { color: "#4f6073", background: "#eef3f8", border: "1px solid #d5e0ea" },
};

const PERSONA_STYLE: Record<string, CSSProperties> = {
  economic_buyer: { color: "#7b3a1d", background: "#ffe8de", border: "1px solid #ffc8b4" },
  champion: { color: "#1b6f53", background: "#e4fbf3", border: "1px solid #b8efd8" },
  technical_evaluator: { color: "#24567e", background: "#eaf4ff", border: "1px solid #c9e0f8" },
  unknown: { color: "#546679", background: "#edf3f9", border: "1px solid #d7e1eb" },
};

const PERSONA_SHORT: Record<string, string> = {
  economic_buyer: "Buyer", champion: "Champion", technical_evaluator: "Tech Eval", unknown: "Unknown",
};

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [companyDeals, setCompanyDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState("");
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const [signalsRefreshing, setSignalsRefreshing] = useState(false);
  const [signalsMsg, setSignalsMsg] = useState("");
  const [showDealModal, setShowDealModal] = useState(false);
  const [creatingDeal, setCreatingDeal] = useState(false);
  const [dealError, setDealError] = useState("");
  const [dealForm, setDealForm] = useState({
    name: "",
    value: "",
    stage: "discovery",
    close_date_est: "",
  });
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [contactBriefs, setContactBriefs] = useState<Record<string, string>>({});
  const [contactBriefLoading, setContactBriefLoading] = useState<Record<string, boolean>>({});
  const [discoveringContacts, setDiscoveringContacts] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState("");

  const loadCompanyContext = async (companyId: string) => {
    const [c, cs, ds, sig] = await Promise.all([
      companiesApi.get(companyId),
      contactsApi.list(0, 100, companyId),
      companiesApi.getDeals(companyId),
      signalsApi.getCompanySignals(companyId),
    ]);
    setCompany(c);
    setContacts(cs);
    setCompanyDeals(ds);
    setSignals(sig.slice(0, 8));
  };

  useEffect(() => {
    if (!id) return;
    loadCompanyContext(id).finally(() => setLoading(false));
  }, [id]);

  const handleGetBrief = async () => {
    if (!company) return;
    setBriefLoading(true); setBrief(null);
    try { const r = await intelligenceApi.getAccountBrief(company.id); setBrief(r.brief ?? "No brief generated."); }
    catch { setBrief("Failed — check API is running."); }
    finally { setBriefLoading(false); }
  };

  const handleBulkOutreach = async () => {
    if (!company) return;
    setBulkGenerating(true); setBulkMsg("Generating with GPT-4o…");
    try {
      const r = await outreachApi.bulkGenerate(company.id);
      setBulkMsg(`${r.generated} generated · ${r.skipped_existing} existed`);
      setTimeout(() => setBulkMsg(""), 4000);
    } catch { setBulkMsg("Failed"); }
    finally { setBulkGenerating(false); }
  };

  const handleEnrich = async () => {
    if (!company) return;
    setEnriching(true); setEnrichMsg("Queuing…");
    try {
      const { task_id } = await enrichmentApi.triggerCompany(company.id);
      setEnrichMsg("Enriching…");
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const s = await enrichmentApi.taskStatus(task_id);
        if (s.status === "SUCCESS") break;
        if (s.status === "FAILURE") { setEnrichMsg("Failed"); return; }
      }
      await loadCompanyContext(company.id);
      setEnrichMsg("Done ✓");
      setTimeout(() => setEnrichMsg(""), 3000);
    } catch { setEnrichMsg("Error"); }
    finally { setEnriching(false); }
  };

  const handleRefreshSignals = async () => {
    if (!company) return;
    setSignalsRefreshing(true);
    setSignalsMsg("");
    try {
      const res = await signalsApi.refreshCompanySignals(company.id);
      const latest = await signalsApi.getCompanySignals(company.id);
      setSignals(latest.slice(0, 8));
      setSignalsMsg(`${res.signals_created} new signals`);
      setTimeout(() => setSignalsMsg(""), 4000);
    } catch {
      setSignalsMsg("Signal refresh failed");
    } finally {
      setSignalsRefreshing(false);
    }
  };

  const handleCreateDeal = async () => {
    if (!company) return;
    if (!dealForm.name.trim()) {
      setDealError("Deal name is required.");
      return;
    }

    setCreatingDeal(true);
    setDealError("");
    try {
      await dealsApi.create({
        company_id: company.id,
        name: dealForm.name.trim(),
        stage: dealForm.stage,
        value: dealForm.value ? Number(dealForm.value) : undefined,
        close_date_est: dealForm.close_date_est || undefined,
      });
      const refreshedDeals = await companiesApi.getDeals(company.id);
      setCompanyDeals(refreshedDeals);
      setShowDealModal(false);
      setDealForm({ name: "", value: "", stage: "discovery", close_date_est: "" });
    } catch (e) {
      setDealError(e instanceof Error ? e.message : "Failed to create deal");
    } finally {
      setCreatingDeal(false);
    }
  };

  const handleDiscoverContacts = async () => {
    if (!company) return;
    setDiscoveringContacts(true);
    setDiscoverMsg("Searching Hunter…");
    try {
      const found = await contactsApi.discover(company.id);
      if (found.length === 0) {
        setDiscoverMsg("No new contacts found");
      } else {
        setContacts((prev) => [...prev, ...found]);
        setDiscoverMsg(`${found.length} contact${found.length !== 1 ? "s" : ""} added`);
      }
      setTimeout(() => setDiscoverMsg(""), 4000);
    } catch {
      setDiscoverMsg("Discovery failed");
    } finally {
      setDiscoveringContacts(false);
    }
  };

  const handleContactBrief = async (contactId: string) => {
    setContactBriefLoading((prev) => ({ ...prev, [contactId]: true }));
    try {
      const res = await contactsApi.getBrief(contactId);
      setContactBriefs((prev) => ({ ...prev, [contactId]: res.brief ?? "No brief generated." }));
    } catch {
      setContactBriefs((prev) => ({ ...prev, [contactId]: "Failed to generate brief." }));
    } finally {
      setContactBriefLoading((prev) => ({ ...prev, [contactId]: false }));
    }
  };

  if (loading) return <div className="crm-panel p-14 text-center crm-muted">Loading company profile...</div>;
  if (!company) return <div className="crm-panel p-14 text-center crm-muted">Company not found.</div>;

  const techStack = company.tech_stack as Record<string, string> | null;
  const initials = getInitials(company.name);
  const avatarCls = avatarColor(company.name);

  return (
    <>
      <div
        className="crm-page company-detail-page"
        style={{ display: "flex", flexDirection: "column", gap: 24 }}
      >
        <div className="flex items-center justify-between gap-3 company-detail-top-actions">
          <button onClick={() => navigate("/companies")} className="crm-button soft">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Companies
          </button>
          <div className="flex items-center gap-2">
            {enrichMsg && <span className="text-[12px] text-[#ff6b35] font-semibold">{enrichMsg}</span>}
            <button className="crm-button soft" onClick={handleEnrich} disabled={enriching}>
              <RefreshCw className={`h-3.5 w-3.5 ${enriching ? "animate-spin" : ""}`} />
              {enriching ? "Enriching..." : "Re-enrich"}
            </button>
            <button
              className="crm-button soft text-[#c0392b] border-[#fcc] hover:bg-[#fff5f5]"
              onClick={async () => {
                if (!company) return;
                if (!window.confirm(`Delete "${company.name}"? This will remove all associated contacts and deals.`)) return;
                await companiesApi.delete(company.id);
                navigate("/companies");
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </div>

        <section className="crm-panel p-8 company-detail-hero" style={{ padding: 32 }}>
          <div className="company-detail-hero-header flex flex-wrap gap-6 items-start justify-between">
            <div className="company-detail-hero-identity flex items-start gap-6 min-w-0">
              <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-[16px] font-extrabold ${avatarCls}`}>
                {initials}
              </div>
              <div className="company-detail-hero-title min-w-0">
                <h2 className="text-[30px] font-extrabold tracking-tight text-[#1f2d3d]">{company.name}</h2>
                <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[14px] text-[#61788f] hover:text-[#ff6b35] mt-1.5">
                  {company.domain}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
            <div className="company-detail-hero-badges flex items-center gap-2">
              {company.icp_tier && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold capitalize" style={TIER_STYLE[company.icp_tier] ?? TIER_STYLE.cold}>
                  {company.icp_tier}
                </span>
              )}
              {company.icp_score != null && (
                <span className="crm-chip tabular">
                  ICP {company.icp_score}
                </span>
              )}
            </div>
          </div>

          {company.icp_score != null && (
            <div className="mt-4">
              <div className="h-2.5 rounded-full bg-[#edf3fa] overflow-hidden max-w-105">
                <div className="h-2.5 rounded-full bg-[#ff6b35]" style={{ width: `${company.icp_score}%` }} />
              </div>
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-6 company-detail-core-grid" style={{ rowGap: 28, columnGap: 28 }}>
          <div className="crm-panel p-8 xl:col-span-2 company-detail-facts">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4" style={{ gap: 14 }}>
              {[
                { label: "Industry", value: company.industry },
                { label: "Employees", value: company.employee_count?.toLocaleString() },
                { label: "ARR Estimate", value: formatCurrency(company.arr_estimate) },
                { label: "Funding", value: company.funding_stage },
                { label: "Vertical", value: company.vertical },
                { label: "DAP", value: company.has_dap ? company.dap_tool ?? "Yes" : "No" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-[#e3eaf3] bg-[#f9fbfe] px-4 py-4" style={{ padding: "14px 16px" }}>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#7d8fa3] font-semibold">{item.label}</p>
                  <p className="text-[14px] font-bold text-[#2b3f55] mt-1.5">{item.value ?? "-"}</p>
                </div>
              ))}
            </div>

            {techStack && Object.keys(techStack).length > 0 && (
              <div className="mt-6">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#7d8fa3] font-semibold mb-3">Tech Stack</p>
                <div className="flex flex-wrap gap-2.5">
                  {Object.entries(techStack).map(([name, tool]) => (
                    <span key={name} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#d8e3ee] bg-white text-[12px]">
                      <span className="text-[#7a8ea4] capitalize">{name}:</span>
                      <span className="font-semibold text-[#2e4358]">{tool}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="crm-panel p-6 company-detail-automation" style={{ padding: 26 }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[15px] font-bold text-[#2b3f55]">Outreach Automation</p>
              <span className="crm-chip text-[10px]">{formatDate(company.enriched_at)}</span>
            </div>
            <p className="text-[13px] text-[#6f8399] leading-relaxed">Keep account data fresh with weekly enrichment and outreach generation.</p>
            <button className="crm-button primary w-full mt-4" onClick={handleBulkOutreach} disabled={bulkGenerating}>
              <Sparkles className="h-3.5 w-3.5" />
              {bulkGenerating ? "Generating..." : "Generate Outreach For All"}
            </button>
            {bulkMsg && <p className="text-[12px] text-[#ff6b35] mt-3">{bulkMsg}</p>}
          </div>
        </section>

        <section className="crm-panel p-6 company-detail-brief" style={{ padding: 26 }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-[#ff6b35]" />
              <p className="text-[15px] font-bold text-[#2b3f55]">AI Account Brief</p>
            </div>
            <button className="crm-button soft" onClick={handleGetBrief} disabled={briefLoading}>
              {briefLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {briefLoading ? "Researching..." : "Generate Brief"}
            </button>
          </div>
          {brief ? (
            <div className="rounded-xl border border-[#dce6f0] bg-[#f8fbff] p-5 space-y-2.5">
              {brief
                .split("\n")
                .filter((line) => line.trim())
                .map((line, i) => (
                  <p key={i} className="text-[14px] leading-relaxed text-[#2d4258]">{line}</p>
                ))}
            </div>
          ) : (
            <p className="text-[13px] text-[#6f8399]">Generate a pre-meeting summary from website data, recent signals, and persona context.</p>
          )}
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6 company-detail-insights-grid" style={{ rowGap: 28, columnGap: 28 }}>
          <div className="crm-panel p-6 company-detail-signals" style={{ padding: 26 }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[15px] font-bold text-[#2b3f55]">Signals</p>
              <div className="flex items-center gap-2">
                {signalsMsg && <span className="text-[12px] text-[#ff6b35] font-semibold">{signalsMsg}</span>}
                <button className="crm-button soft h-10 px-3" onClick={handleRefreshSignals} disabled={signalsRefreshing}>
                  <RefreshCw className={`h-3.5 w-3.5 ${signalsRefreshing ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
            </div>
            {signals.length === 0 ? (
              <p className="text-[13px] text-[#6f8399]">No signals available yet.</p>
            ) : (
              <div className="space-y-3">
                {signals.slice(0, 5).map((s) => (
                  <div key={s.id} className="rounded-xl border border-[#e3eaf3] bg-[#fbfdff] p-3">
                    <div className="flex items-center gap-2 text-[12px] text-[#6f8399] capitalize">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          background:
                            s.signal_type === "funding"
                              ? "#f59e0b"
                              : s.signal_type === "pr"
                              ? "#3b82f6"
                              : s.signal_type === "news"
                              ? "#64748b"
                              : "#94a3b8",
                        }}
                      />
                      {s.signal_type}
                    </div>
                    <p className="text-[14px] font-semibold text-[#2b3f55] mt-1">{s.title}</p>
                    {s.summary && <p className="text-[13px] text-[#647a91] mt-1">{s.summary}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="crm-panel p-6 company-detail-deals" style={{ padding: 26 }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[15px] font-bold text-[#2b3f55]">Linked Deals ({companyDeals.length})</p>
              <button className="crm-button primary h-10 px-3" onClick={() => setShowDealModal(true)}>
                <Plus className="h-3.5 w-3.5" />
                Create Deal
              </button>
            </div>

            {companyDeals.length === 0 ? (
              <p className="text-[13px] text-[#6f8399]">No deals linked yet.</p>
            ) : (
              <div className="space-y-3">
                {companyDeals.map((d) => (
                  <div key={d.id} className="rounded-xl border border-[#e3eaf3] bg-[#fbfdff] px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/deals/${d.id}`} className="text-[14px] font-bold text-[#24364b] hover:text-[#ff6b35]">
                        {d.name}
                      </Link>
                      <p className="text-[12px] text-[#7a8ea4] mt-1 capitalize">{d.stage.replace(/_/g, " ")} · {formatDate(d.close_date_est)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold tabular text-[#2d4056]">{formatCurrency(d.value)}</span>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete deal "${d.name}"?`)) return;
                          await dealsApi.delete(d.id);
                          setCompanyDeals((prev) => prev.filter((x) => x.id !== d.id));
                        }}
                        className="flex items-center justify-center h-7 w-7 rounded-lg text-[#9eb0c3] hover:text-[#c0392b] hover:bg-[#fff0f0] transition-colors"
                        title="Delete deal"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="crm-panel p-6 company-detail-stakeholders" style={{ padding: 24, marginTop: 4 }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[#4a627c]" />
              <p className="text-[15px] font-bold text-[#2b3f55]">Stakeholders ({contacts.length})</p>
            </div>
            <div className="flex items-center gap-2">
              {discoverMsg && <span className="text-[12px] text-[#ff6b35] font-semibold">{discoverMsg}</span>}
              <button className="crm-button soft" onClick={handleDiscoverContacts} disabled={discoveringContacts}>
                <Users className={`h-3.5 w-3.5 ${discoveringContacts ? "animate-pulse" : ""}`} />
                {discoveringContacts ? "Searching…" : "Find Contacts"}
              </button>
            </div>
          </div>
          {contacts.length === 0 ? (
            <p className="text-[12px] text-[#6f8399]">No contacts found for this account yet.</p>
          ) : (
            <div className="space-y-3" style={{ rowGap: 10, display: "grid" }}>
              {contacts.map((c) => (
                <div key={c.id} className="rounded-xl border border-[#e0e8f1] bg-white px-4 py-4" style={{ padding: "12px 14px" }}>
                  <div className="flex items-center justify-between gap-4" style={{ alignItems: "flex-start", gap: 12 }}>
                    <div className="flex items-center gap-3 min-w-0" style={{ flex: 1, paddingRight: 8 }}>
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold ${avatarColor(c.first_name + c.last_name)}`}>
                        {getInitials(`${c.first_name} ${c.last_name}`)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold text-[#26384e] truncate">{c.first_name} {c.last_name}</p>
                        <p className="text-[13px] text-[#7b8fa4] truncate mt-0.5">{c.title ?? "-"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2" style={{ flexWrap: "wrap", justifyContent: "flex-end", rowGap: 8, columnGap: 8, marginLeft: 8 }}>
                      {c.persona && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold" style={PERSONA_STYLE[c.persona] ?? PERSONA_STYLE.unknown}>
                          {PERSONA_SHORT[c.persona] ?? c.persona}
                        </span>
                      )}
                      <button className="crm-button soft h-10 px-3 text-[12px]" style={{ minWidth: 92, height: 38, padding: "0 14px" }} onClick={() => handleContactBrief(c.id)} disabled={contactBriefLoading[c.id]}>
                        {contactBriefLoading[c.id] ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <BrainCircuit className="h-3.5 w-3.5" />}
                        Brief
                      </button>
                      <button className="crm-button soft h-10 px-3 text-[12px]" style={{ minWidth: 128, height: 38, padding: "0 14px" }} onClick={() => setSelectedContact(c)}>
                        <Sparkles className="h-3.5 w-3.5" />
                        Outreach
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete "${c.first_name} ${c.last_name}"?`)) return;
                          await contactsApi.delete(c.id);
                          setContacts((prev) => prev.filter((x) => x.id !== c.id));
                        }}
                        className="flex items-center justify-center h-10 w-10 rounded-xl text-[#9eb0c3] hover:text-[#c0392b] hover:bg-[#fff0f0] transition-colors"
                        style={{ height: 38, width: 38 }}
                        title="Delete contact"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {contactBriefs[c.id] && (
                    <div className="rounded-lg border border-[#dce6f0] bg-[#f8fbff] px-3 py-2 mt-3 space-y-1">
                      {contactBriefs[c.id]
                        .split("\n")
                        .filter(Boolean)
                        .map((line, i) => (
                          <p key={i} className="text-[13px] text-[#2d4258]">{line}</p>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {showDealModal && (
        <>
          <div className="fixed inset-0 bg-black/25 z-40" onClick={() => setShowDealModal(false)} />
          <div className="fixed inset-0 z-50 grid place-items-center p-4">
            <div className="crm-panel w-full max-w-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[18px] font-bold">Create Deal</h3>
                <button className="text-[#7a8ea4] hover:text-[#31465f]" onClick={() => setShowDealModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-3">
                <input
                  className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px]"
                  placeholder="Deal name"
                  value={dealForm.name}
                  onChange={(e) => setDealForm((f) => ({ ...f, name: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px]"
                    placeholder="Value"
                    value={dealForm.value}
                    onChange={(e) => setDealForm((f) => ({ ...f, value: e.target.value }))}
                  />
                  <select
                    className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px] bg-white"
                    value={dealForm.stage}
                    onChange={(e) => setDealForm((f) => ({ ...f, stage: e.target.value }))}
                  >
                    <option value="discovery">discovery</option>
                    <option value="demo">demo</option>
                    <option value="poc">poc</option>
                    <option value="proposal">proposal</option>
                    <option value="negotiation">negotiation</option>
                    <option value="closed_won">closed_won</option>
                    <option value="closed_lost">closed_lost</option>
                  </select>
                </div>
                <input
                  type="date"
                  className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px]"
                  value={dealForm.close_date_est}
                  onChange={(e) => setDealForm((f) => ({ ...f, close_date_est: e.target.value }))}
                />
              </div>

              {dealError && <p className="text-[12px] text-[#b94a24] font-semibold">{dealError}</p>}

              <div className="flex justify-end gap-2">
                <button className="crm-button soft" onClick={() => setShowDealModal(false)}>Cancel</button>
                <button className="crm-button primary" onClick={handleCreateDeal} disabled={creatingDeal}>
                  {creatingDeal ? "Creating..." : "Create Deal"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <OutreachDrawer contact={selectedContact} onClose={() => setSelectedContact(null)} />
    </>
  );
}
