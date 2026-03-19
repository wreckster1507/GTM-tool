import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, BrainCircuit, ExternalLink, RefreshCw, Sparkles,
  Users, Newspaper, BookOpen, Shield, ChevronDown, ChevronUp,
  Building2, TrendingUp, Lightbulb, Search, PlayCircle,
  Swords, MessageSquareWarning, ArrowRight,
} from "lucide-react";
import { companiesApi, contactsApi, intelligenceApi, meetingsApi, signalsApi } from "../lib/api";
import type { Company, Contact, Meeting, Signal } from "../types";
import { formatCurrency, formatDate, avatarColor, getInitials } from "../lib/utils";

// ── Styles ───────────────────────────────────────────────────────────────────

const SIGNAL_DOT: Record<string, string> = {
  funding: "#f59e0b", pr: "#3b82f6", jobs: "#10b981",
  review: "#8b5cf6", linkedin: "#ec4899", news: "#64748b",
};

const PERSONA_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  economic_buyer:      { color: "#7b3a1d", bg: "#ffe8de", border: "#ffc8b4" },
  champion:            { color: "#1b6f53", bg: "#e4fbf3", border: "#b8efd8" },
  technical_evaluator: { color: "#24567e", bg: "#eaf4ff", border: "#c9e0f8" },
  unknown:             { color: "#546679", bg: "#edf3f9", border: "#d7e1eb" },
};

const PERSONA_LABEL: Record<string, string> = {
  economic_buyer: "Buyer", champion: "Champion",
  technical_evaluator: "Tech Eval", unknown: "Unknown",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface CompanyBackground {
  title?: string;
  description?: string;
  extract?: string;
  url?: string;
  founded?: string;
}

interface WebResearch {
  company_background?: CompanyBackground | null;
  recent_news?: Array<{ title: string; url: string; snippet: string }>;
  milestones?: Array<{ title: string; url: string; snippet: string }>;
  relevant_battlecards?: Array<{ id: string; title: string; category: string; summary: string }>;
}

// ── Demo strategy section config ─────────────────────────────────────────────

const STORY_SECTIONS = [
  { icon: Lightbulb,            color: "#ff6b35", bg: "#fff8f5", border: "#ffd5be", label: "Opening Hook" },
  { icon: Search,               color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", label: "Discovery Question" },
  { icon: PlayCircle,           color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe", label: "Story Lineup" },
  { icon: Swords,               color: "#0f766e", bg: "#f0fdfa", border: "#99f6e4", label: "Key Differentiation" },
  { icon: MessageSquareWarning, color: "#b91c1c", bg: "#fef2f2", border: "#fecaca", label: "Objection Handling" },
  { icon: ArrowRight,           color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0", label: "Next Step" },
];

/** Parse GPT-4o numbered output into { title, body }[] sections */
function parseDemoSections(text: string): { title: string; body: string }[] {
  // Split on lines starting with a digit+dot (1. 2. etc.)
  const chunks = text.split(/\n(?=\d+\.\s)/);
  return chunks.map((chunk) => {
    const firstNewline = chunk.indexOf("\n");
    const heading = firstNewline === -1 ? chunk : chunk.slice(0, firstNewline);
    const body = firstNewline === -1 ? "" : chunk.slice(firstNewline + 1).trim();
    // Strip leading "1. " and markdown bold markers from the heading
    const title = heading.replace(/^\d+\.\s*/, "").replace(/\*\*/g, "").replace(/:$/, "").trim();
    return { title, body };
  }).filter((s) => s.title);
}

function DemoStrategyCards({ strategy, onRegenerate, regenerating }: {
  strategy: string;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const sections = parseDemoSections(strategy);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {sections.map((sec, i) => {
          const cfg = STORY_SECTIONS[i] ?? STORY_SECTIONS[0];
          const Icon = cfg.icon;
          return (
            <div
              key={i}
              className="rounded-xl border p-4"
              style={{ background: cfg.bg, borderColor: cfg.border }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} style={{ color: cfg.color }} />
                <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: cfg.color }}>
                  {cfg.label}
                </span>
              </div>
              <p className="text-[12px] font-semibold text-[#2b3f55] mb-1">{sec.title}</p>
              <div className="text-[13px] text-[#3d5268] leading-relaxed whitespace-pre-wrap">
                {sec.body.replace(/\*\*/g, "").replace(/^\s*[-–]\s*/gm, "• ")}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end pt-1">
        <button className="crm-button soft text-[12px]" onClick={onRegenerate} disabled={regenerating}>
          {regenerating ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {regenerating ? "Regenerating…" : "Regenerate Story"}
        </button>
      </div>
    </div>
  );
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

function Section({ title, icon, children, defaultOpen = true, badge }: {
  title: string; icon: React.ReactNode; children: React.ReactNode;
  defaultOpen?: boolean; badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="crm-panel overflow-hidden">
      <button className="flex items-center justify-between w-full px-6 py-4 text-left" style={{ padding: "16px 22px" }} onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[15px] font-bold text-[#2b3f55]">{title}</span>
          {badge && <span className="crm-chip text-[11px]">{badge}</span>}
        </div>
        {open ? <ChevronUp size={14} className="text-[#7a8ea4]" /> : <ChevronDown size={14} className="text-[#7a8ea4]" />}
      </button>
      {open && <div className="px-6 pb-6" style={{ padding: "0 22px 22px" }}>{children}</div>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MeetingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [meeting, setMeeting]     = useState<Meeting | null>(null);
  const [company, setCompany]     = useState<Company | null>(null);
  const [contacts, setContacts]   = useState<Contact[]>([]);
  const [signals, setSignals]     = useState<Signal[]>([]);
  const [accountBrief, setAccountBrief] = useState<string | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(false);

  const [loading, setLoading]         = useState(true);
  const [running, setRunning]         = useState(false);
  const [generatingStory, setGeneratingStory] = useState(false);
  const [scoring, setScoring]         = useState(false);
  const [rawNotes, setRawNotes]       = useState("");
  const [error, setError]             = useState("");
  const [statusMsg, setStatusMsg]     = useState("");

  // ── Load all existing DB data on mount ──────────────────────────────────────
  const loadAll = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const m = await meetingsApi.get(id);
      setMeeting(m);
      setRawNotes(m.raw_notes ?? "");

      if (m.company_id) {
        const [c, cts, sig] = await Promise.all([
          companiesApi.get(m.company_id),
          contactsApi.list(0, 50, m.company_id),
          signalsApi.getCompanySignals(m.company_id),
        ]);
        setCompany(c);
        setContacts(cts);
        setSignals(sig.slice(0, 8));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [id]);

  // Web research + demo strategy saved in meeting.research_data / meeting.demo_strategy
  const webResearch = useMemo((): WebResearch => (meeting?.research_data as WebResearch) ?? {}, [meeting]);
  // True once intel has been run at all — regardless of whether web results came back
  const intelWasRun = !!meeting?.research_data;
  const hasWikipedia = !!webResearch.company_background;
  const hasNews = (webResearch.recent_news?.length ?? 0) > 0;
  const hasMilestones = (webResearch.milestones?.length ?? 0) > 0;

  // ── Fetch account brief from intelligence endpoint ──────────────────────────
  const handleGetAccountBrief = async () => {
    if (!company) return;
    setLoadingBrief(true);
    try {
      const r = await intelligenceApi.getAccountBrief(company.id);
      setAccountBrief(r.brief ?? "No brief generated.");
    } catch {
      setAccountBrief("Failed to generate brief — check API.");
    } finally {
      setLoadingBrief(false);
    }
  };

  // ── Run web research only (Wikipedia + DDG news/milestones) ─────────────────
  const handleRunIntelligence = async () => {
    if (!id) return;
    setRunning(true);
    setStatusMsg("Searching Wikipedia, recent news, milestones…");
    setError("");
    try {
      await meetingsApi.runIntelligence(id);
      await loadAll();
      setStatusMsg("Web intel saved ✓");
      setTimeout(() => setStatusMsg(""), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Intelligence run failed");
      setStatusMsg("");
    } finally {
      setRunning(false);
    }
  };

  // ── Generate GPT-4o demo strategy (reads cached research_data) ──────────────
  const handleGenerateDemoStrategy = async () => {
    if (!id) return;
    setGeneratingStory(true);
    setError("");
    try {
      await meetingsApi.generateDemoStrategy(id);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demo strategy generation failed");
    } finally {
      setGeneratingStory(false);
    }
  };

  // ── Post-debrief scoring ─────────────────────────────────────────────────────
  const handlePostScore = async () => {
    if (!id) return;
    if (!rawNotes.trim()) { setError("Paste raw meeting notes before scoring."); return; }
    setScoring(true); setError("");
    try {
      await meetingsApi.postScore(id, rawNotes);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to score meeting");
    } finally {
      setScoring(false);
    }
  };

  if (loading) return <div className="crm-panel p-14 text-center crm-muted">Loading meeting workspace...</div>;
  if (!meeting) return <div className="crm-panel p-14 text-center crm-muted">Meeting not found.</div>;

  const techStack = company?.tech_stack as Record<string, string> | null;

  return (
    <div className="meeting-detail-page" style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <button className="crm-button soft" onClick={() => navigate("/meetings")}>
          <ArrowLeft size={14} /> Back to Meetings
        </button>
        <span className="crm-chip capitalize">{meeting.status} · {meeting.meeting_type}</span>
      </div>

      {/* ── Hero ── */}
      <div className="crm-panel p-8" style={{ padding: 32 }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[28px] font-extrabold text-[#1f2d3d]">{meeting.title}</h2>
            <p className="text-[14px] text-[#647a91] mt-2 flex items-center gap-2 flex-wrap">
              {company ? (
                <>
                  <Link to={`/companies/${company.id}`} className="font-semibold text-[#24364b] hover:text-[#ff6b35]">
                    {company.name}
                  </Link>
                  ·
                  <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-[#ff6b35]">
                    {company.domain} <ExternalLink size={12} />
                  </a>
                </>
              ) : "No linked company"}
              {meeting.scheduled_at && <span>· {formatDate(meeting.scheduled_at)}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {statusMsg && <span className="text-[12px] text-[#ff6b35] font-semibold">{statusMsg}</span>}
            <button className="crm-button soft" onClick={handleRunIntelligence} disabled={running}>
              {running ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
              {running ? "Searching…" : intelWasRun ? "Re-run Web Intel" : "Run Web Intel"}
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1 — Account Intelligence (existing DB data, shown immediately)
      ══════════════════════════════════════════════════════════════════════ */}
      <Section title="Account Intelligence" icon={<Building2 size={15} className="text-[#ff6b35]" />}>
        {!company ? (
          <p className="text-[13px] text-[#6f8399]">No company linked to this meeting.</p>
        ) : (
          <div className="space-y-5" style={{ rowGap: 18, display: "grid" }}>

            {/* Company facts grid — from DB, instant */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3" style={{ gap: 12 }}>
              {[
                { label: "Industry",      value: company.industry },
                { label: "Employees",     value: company.employee_count?.toLocaleString() },
                { label: "ARR Estimate",  value: formatCurrency(company.arr_estimate) },
                { label: "Funding Stage", value: company.funding_stage },
                { label: "ICP Score",     value: company.icp_score != null ? `${company.icp_score} (${company.icp_tier})` : null },
                { label: "DAP Tool",      value: company.has_dap ? (company.dap_tool ?? "Yes — unknown tool") : "No DAP detected" },
              ].filter(i => i.value).map(item => (
                <div key={item.label} className="rounded-xl border border-[#e3eaf3] bg-[#f9fbfe] px-4 py-3" style={{ padding: "13px 15px" }}>
                  <p className="text-[11px] uppercase tracking-wide text-[#7d8fa3] font-semibold">{item.label}</p>
                  <p className="text-[13px] font-bold text-[#2b3f55] mt-1 capitalize">{item.value}</p>
                </div>
              ))}
            </div>

            {/* Tech stack — from DB */}
            {techStack && Object.keys(techStack).length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[#7d8fa3] font-semibold mb-2">Tech Stack</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(techStack).map(([name, tool]) => (
                    <span key={name} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#d8e3ee] bg-white text-[12px]">
                      <span className="text-[#7a8ea4] capitalize">{name}:</span>
                      <span className="font-semibold text-[#2e4358]">{tool}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Company background — scraped from own website + GPT-4o */}
            {webResearch.company_background && (
              <div className="rounded-xl border border-[#dce6f0] bg-[#f8fbff] p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] uppercase tracking-wide text-[#7d8fa3] font-semibold">Company Background</p>
                  {webResearch.company_background.url && (
                    <a href={webResearch.company_background.url} target="_blank" rel="noopener noreferrer"
                      className="text-[11px] text-[#4a7fa5] hover:underline flex items-center gap-1">
                      Source <ExternalLink size={10} />
                    </a>
                  )}
                </div>
                {webResearch.company_background.description && (
                  <p className="text-[12px] text-[#546679] mb-1">{webResearch.company_background.description}</p>
                )}
                <p className="text-[14px] text-[#2d4258] leading-relaxed">{webResearch.company_background.extract}</p>
                {webResearch.company_background.founded && (
                  <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-full bg-[#edf5ff] border border-[#c9e0f8] text-[11px] text-[#24567e] font-semibold">
                    Founded {webResearch.company_background.founded}
                  </span>
                )}
              </div>
            )}

            {/* Recent news — from Run Intel */}
            {(webResearch.recent_news?.length ?? 0) > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[#7d8fa3] font-semibold mb-2">
                  Recent News & Signals <span className="text-[#ff6b35] normal-case font-normal">(web research)</span>
                </p>
                <div className="space-y-2" style={{ rowGap: 10, display: "grid" }}>
                  {webResearch.recent_news!.map((item, i) => (
                    <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-start gap-3 rounded-xl border border-[#e3eaf3] bg-white px-4 py-3 hover:border-[#ff6b35] transition-colors">
                      <Newspaper size={13} className="text-[#9eb0c3] mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-[#24364b]">{item.title}</p>
                        {item.snippet && <p className="text-[12px] text-[#6f8399] mt-0.5 line-clamp-2">{item.snippet}</p>}
                      </div>
                      <ExternalLink size={11} className="text-[#9eb0c3] shrink-0 mt-0.5" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Milestones — from Run Intel */}
            {hasMilestones && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[#7d8fa3] font-semibold mb-2">
                  Company Milestones <span className="text-[#ff6b35] normal-case font-normal">(web research)</span>
                </p>
                <div className="space-y-2" style={{ rowGap: 10, display: "grid" }}>
                  {webResearch.milestones!.map((item, i) => (
                    <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-start gap-3 rounded-xl border border-[#e3eaf3] bg-white px-4 py-3 hover:border-[#ff6b35] transition-colors">
                      <TrendingUp size={13} className="text-[#9eb0c3] mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-[#24364b]">{item.title}</p>
                        {item.snippet && <p className="text-[12px] text-[#6f8399] mt-0.5 line-clamp-2">{item.snippet}</p>}
                      </div>
                      <ExternalLink size={11} className="text-[#9eb0c3] shrink-0 mt-0.5" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Web intel state: not run / run but no results / has results (already rendered above) */}
            {!intelWasRun && (
              <div className="rounded-xl border border-dashed border-[#c9daf0] bg-[#f5f9ff] px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-[13px] text-[#5a7a99]">
                  Click <strong>Run Web Intel</strong> to add Wikipedia background, recent news, and milestones.
                </p>
                <button className="crm-button soft shrink-0" onClick={handleRunIntelligence} disabled={running}>
                  <Sparkles size={13} /> Run Web Intel
                </button>
              </div>
            )}
            {intelWasRun && !hasWikipedia && !hasNews && !hasMilestones && (
              <p className="text-[13px] text-[#8fa5bc]">
                No public web results found for <strong>{company.name}</strong>. This can happen due to search rate limits or if the company has limited public coverage.
                Try clicking <strong>Re-run Web Intel</strong> to search again.
              </p>
            )}
          </div>
        )}
      </Section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2 — Stakeholders (existing contacts, shown immediately)
      ══════════════════════════════════════════════════════════════════════ */}
      <Section
        title="Stakeholders / Attendees"
        icon={<Users size={15} className="text-[#4a627c]" />}
        badge={contacts.length > 0 ? String(contacts.length) : undefined}
      >
        {contacts.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[13px] text-[#6f8399]">No contacts found for this company.</p>
            {company && (
              <p className="text-[12px] text-[#8fa5bc]">
                Go to <Link to={`/companies/${company.id}`} className="font-semibold text-[#4a7fa5] hover:underline">{company.name}</Link> and click "Find Contacts" to discover stakeholders.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3" style={{ rowGap: 10, display: "grid" }}>
            {contacts.map((c) => {
              const ps = PERSONA_STYLE[c.persona ?? "unknown"] ?? PERSONA_STYLE.unknown;
              return (
                <div key={c.id} className="flex items-center gap-4 rounded-xl border border-[#e0e8f1] bg-white px-4 py-3" style={{ padding: "12px 14px", gap: 12 }}>
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold ${avatarColor(`${c.first_name}${c.last_name}`)}`}>
                    {getInitials(`${c.first_name} ${c.last_name}`)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-bold text-[#26384e]">{c.first_name} {c.last_name}</p>
                      {c.persona && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
                          style={{ color: ps.color, background: ps.bg, border: `1px solid ${ps.border}` }}>
                          {PERSONA_LABEL[c.persona] ?? c.persona}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-[#7b8fa4] mt-0.5">{c.title ?? c.seniority ?? "—"}</p>
                    {c.email && <p className="text-[12px] text-[#4a7fa5] mt-0.5">{c.email}</p>}
                  </div>
                  {c.linkedin_url && (
                    <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer"
                      className="text-[11px] text-[#0077b5] font-semibold hover:underline shrink-0 flex items-center gap-1">
                      LinkedIn <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 3 — Demo Strategy & Story Lineup (GPT-4o, on-demand)
      ══════════════════════════════════════════════════════════════════════ */}
      <Section title="Demo Strategy & Story Lineup" icon={<Sparkles size={15} className="text-[#ff6b35]" />}>
        {meeting.demo_strategy ? (
          <DemoStrategyCards strategy={meeting.demo_strategy} onRegenerate={handleGenerateDemoStrategy} regenerating={generatingStory} />
        ) : (
          <div className="rounded-xl border border-dashed border-[#ffd5be] bg-[#fff8f5] px-5 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="text-[14px] font-bold text-[#8f3a14]">No story lineup yet</p>
              <p className="text-[13px] text-[#b05a2a] mt-0.5">
                GPT-4o will read your account intel and build a tailored demo playbook — opening hook, discovery question, 3 story chapters, objection handling, and next step.
              </p>
            </div>
            <button className="crm-button primary shrink-0" onClick={handleGenerateDemoStrategy} disabled={generatingStory}>
              {generatingStory ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {generatingStory ? "Building story…" : "Create Story & Pre-Intel"}
            </button>
          </div>
        )}
      </Section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 4 — Company Signals (from DB, shown immediately)
      ══════════════════════════════════════════════════════════════════════ */}
      {signals.length > 0 && (
        <Section title="Company Signals" icon={<TrendingUp size={15} className="text-[#4a7fa5]" />}
          badge={String(signals.length)} defaultOpen={false}>
          <div className="space-y-3">
            {signals.map((s) => (
              <div key={s.id} className="rounded-xl border border-[#e3eaf3] bg-[#fbfdff] px-4 py-3">
                <div className="flex items-center gap-2 text-[12px] text-[#6f8399] capitalize mb-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: SIGNAL_DOT[s.signal_type] ?? "#94a3b8" }} />
                  {s.signal_type}
                </div>
                <p className="text-[14px] font-semibold text-[#2b3f55]">{s.title}</p>
                {s.summary && <p className="text-[13px] text-[#647a91] mt-1">{s.summary}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 5 — Relevant Battlecards (from Run Intel)
      ══════════════════════════════════════════════════════════════════════ */}
      {(webResearch.relevant_battlecards?.length ?? 0) > 0 && (
        <Section title="Relevant Battlecards" icon={<Shield size={15} className="text-[#4a627c]" />} defaultOpen={false}>
          <div className="space-y-3">
            {webResearch.relevant_battlecards!.map((bc) => (
              <div key={bc.id} className="rounded-xl border border-[#e3eaf3] bg-[#fbfdff] px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex px-2 py-0.5 rounded-full bg-[#fff3e8] border border-[#ffd9be] text-[10px] font-bold text-[#b05a1a] capitalize">
                    {bc.category}
                  </span>
                  <p className="text-[14px] font-bold text-[#2b3f55]">{bc.title}</p>
                </div>
                <p className="text-[13px] text-[#4d6178] leading-relaxed">{bc.summary}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 6 — AI Account Brief (on-demand, Playwright + GPT-4o)
      ══════════════════════════════════════════════════════════════════════ */}
      <Section title="AI Account Brief" icon={<BrainCircuit size={15} className="text-[#ff6b35]" />} defaultOpen={false}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13px] text-[#6f8399]">
            Scrapes the company website live + summarises with GPT-4o. ~10s.
          </p>
          <button className="crm-button soft" onClick={handleGetAccountBrief} disabled={loadingBrief || !company}>
            {loadingBrief ? <RefreshCw size={13} className="animate-spin" /> : <BrainCircuit size={13} />}
            {loadingBrief ? "Generating…" : "Generate Brief"}
          </button>
        </div>
        {accountBrief ? (
          <div className="rounded-xl border border-[#dce6f0] bg-[#f8fbff] p-4 space-y-2">
            {accountBrief.split("\n").filter(Boolean).map((line, i) => (
              <p key={i} className="text-[14px] text-[#2d4258] leading-relaxed">{line}</p>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-[#6f8399]">Not generated yet.</p>
        )}
      </Section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 7 — Post-Debrief & Scoring
      ══════════════════════════════════════════════════════════════════════ */}
      <Section title="Post-Debrief & Scoring" icon={<BookOpen size={15} className="text-[#4a627c]" />} defaultOpen={false}>
        <textarea
          className="w-full min-h-40 rounded-xl border border-[#d7e2ee] bg-white p-4 text-[14px] text-[#223145] outline-none focus:border-[#c2d3e5] mb-3"
          placeholder="Paste raw meeting notes here — AI will score the call, identify wins/losses, and draft the MoM email."
          value={rawNotes}
          onChange={(e) => setRawNotes(e.target.value)}
        />
        <div className="flex justify-end">
          <button className="crm-button primary" onClick={handlePostScore} disabled={scoring}>
            {scoring ? "Scoring…" : "Score Meeting & Draft MoM"}
          </button>
        </div>
        {(meeting.meeting_score != null || meeting.what_went_right || meeting.mom_draft) && (
          <div className="rounded-xl border border-[#dce6f0] bg-[#f8fbff] p-5 space-y-3 mt-4">
            {meeting.meeting_score != null && (
              <p className="text-[14px]"><span className="font-bold">Score:</span>{" "}
                <span className="tabular font-extrabold text-[#ff6b35]">{meeting.meeting_score}/100</span>
              </p>
            )}
            {meeting.what_went_right && (
              <p className="text-[14px]"><span className="font-bold text-[#1b6f53]">✓ What went right:</span> {meeting.what_went_right}</p>
            )}
            {meeting.what_went_wrong && (
              <p className="text-[14px]"><span className="font-bold text-[#8f2f11]">✗ What went wrong:</span> {meeting.what_went_wrong}</p>
            )}
            {meeting.next_steps && (
              <p className="text-[14px]"><span className="font-bold">→ Next steps:</span> {meeting.next_steps}</p>
            )}
            {meeting.mom_draft && (
              <div>
                <p className="text-[13px] font-bold uppercase tracking-wide text-[#7a8ea4] mb-2">MoM Email Draft</p>
                <pre className="whitespace-pre-wrap text-[13px] text-[#2d4258] font-sans leading-relaxed">{meeting.mom_draft}</pre>
              </div>
            )}
          </div>
        )}
      </Section>

      {error && <p className="text-[12px] text-[#b94a24] font-semibold px-1">{error}</p>}
    </div>
  );
}
