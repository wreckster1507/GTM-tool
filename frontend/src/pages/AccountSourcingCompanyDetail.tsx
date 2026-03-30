import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Brain,
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  AlertTriangle,
  Newspaper,
  Radar,
  Shield,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

import { accountSourcingApi } from "../lib/api";
import type { Company, Contact } from "../types";
import { formatDate, getAccountPrioritySnapshot } from "../lib/utils";
import AssignDropdown from "../components/AssignDropdown";

const colors = {
  bg: "#f4f7fb",
  card: "#ffffff",
  border: "#d9e1ec",
  text: "#1d2b3c",
  sub: "#55657a",
  faint: "#7f8fa5",
  primary: "#1f6feb",
  primarySoft: "#e8f0ff",
  green: "#1f8f5f",
  greenSoft: "#e8f8f0",
  violet: "#7a2dd9",
  violetSoft: "#f3eaff",
  amber: "#b56d00",
  amberSoft: "#fff4df",
  red: "#b42336",
  redSoft: "#ffecef",
};

const ICP_STYLE: Record<string, CSSProperties> = {
  hot: { background: "#ffecef", color: "#b42336", border: "1px solid #ffd0d8" },
  warm: { background: "#fff4df", color: "#9b5a00", border: "1px solid #ffe4b0" },
  monitor: { background: "#ebf3ff", color: "#1f5ecc", border: "1px solid #d5e5ff" },
  cold: { background: "#eef2f7", color: "#5e6d83", border: "1px solid #d9e1ec" },
};

const PERSONA_STYLE: Record<string, CSSProperties> = {
  champion: { background: colors.greenSoft, color: colors.green },
  buyer: { background: "#eaf2ff", color: "#2556c4" },
  evaluator: { background: colors.amberSoft, color: colors.amber },
  blocker: { background: colors.redSoft, color: colors.red },
};

const PERSONA_LABEL: Record<string, string> = {
  buyer: "Buyer",
  champion: "Champion",
  evaluator: "Evaluator",
  blocker: "Blocker",
  unknown: "Unknown",
};

const PRIORITY_STYLE: Record<"high" | "medium" | "low", CSSProperties> = {
  high: { background: "#e8f8f0", color: "#1f8f5f" },
  medium: { background: "#fff4df", color: "#b56d00" },
  low: { background: "#eef2f7", color: "#5e6d83" },
};

const INTEREST_STYLE: Record<"high" | "medium" | "low", CSSProperties> = {
  high: { background: "#eef5ff", color: "#1f6feb" },
  medium: { background: "#f3eaff", color: "#7a2dd9" },
  low: { background: "#ffecef", color: "#b42336" },
};

const DISPOSITION_OPTIONS = [
  { value: "", label: "Unreviewed" },
  { value: "working", label: "Working" },
  { value: "interested", label: "Interested" },
  { value: "nurture", label: "Nurture" },
  { value: "not_interested", label: "Not Interested" },
  { value: "bad_fit", label: "Bad Fit" },
  { value: "do_not_target", label: "Do Not Target" },
];

const OUTREACH_STATUS_OPTIONS = [
  { value: "", label: "Unknown" },
  { value: "not_started", label: "Not Started" },
  { value: "contacted", label: "Contacted" },
  { value: "replied", label: "Replied" },
  { value: "meeting_booked", label: "Meeting Booked" },
];

const OUTREACH_LANE_OPTIONS = [
  { value: "", label: "Auto / Unset" },
  { value: "warm_intro", label: "Warm Intro" },
  { value: "event_follow_up", label: "Event Follow-up" },
  { value: "cold_operator", label: "Cold Operator" },
  { value: "cold_strategic", label: "Cold Strategic" },
];

const pageStyle: CSSProperties = {
  background: colors.bg,
  minHeight: "100%",
  padding: "30px 26px 40px",
};

const wrapStyle: CSSProperties = {
  maxWidth: 1450,
  margin: "0 auto",
  display: "grid",
  gap: 16,
};

const cardStyle: CSSProperties = {
  background: colors.card,
  border: `1px solid ${colors.border}`,
  borderRadius: 16,
  boxShadow: "0 6px 20px rgba(17,34,68,0.05)",
};

function ts(value?: string) {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function unwrapCache(cache: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const e = cache[key] as Record<string, unknown> | undefined;
  if (!e) return undefined;
  return (e.data ?? e) as Record<string, unknown>;
}

function cacheTs(cache: Record<string, unknown>, key: string): string | undefined {
  const e = cache[key] as Record<string, unknown> | undefined;
  if (typeof e?.fetched_at === "string") return e.fetched_at;
  if (typeof e?.analyzed_at === "string") return e.analyzed_at;
  return undefined;
}

function canonicalPersona(persona?: string | null, personaType?: string | null): keyof typeof PERSONA_STYLE | "unknown" {
  const normalized = (personaType || persona || "").toLowerCase();
  if (normalized === "economic_buyer" || normalized === "buyer") return "buyer";
  if (normalized === "technical_evaluator" || normalized === "evaluator") return "evaluator";
  if (normalized === "champion") return "champion";
  if (normalized === "blocker") return "blocker";
  return "unknown";
}

function MetricCard({ label, value, hint, tone = "neutral" }: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "primary" | "warm" | "green";
}) {
  const toneStyle = {
    neutral: { bg: "#fbfdff", border: colors.border, accent: colors.sub },
    primary: { bg: "#eef5ff", border: "#cfe0fb", accent: colors.primary },
    warm: { bg: "#fff7eb", border: "#ffe0b2", accent: colors.amber },
    green: { bg: "#eefcf5", border: "#cdeedc", accent: colors.green },
  }[tone];

  return (
    <div style={{ border: `1px solid ${toneStyle.border}`, background: toneStyle.bg, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ color: colors.faint, fontWeight: 800, fontSize: 11, letterSpacing: 0.5 }}>{label.toUpperCase()}</div>
      <div style={{ marginTop: 8, color: toneStyle.accent, fontWeight: 800, fontSize: 26 }}>{value}</div>
      <div style={{ marginTop: 6, color: colors.sub, fontSize: 13, lineHeight: 1.45 }}>{hint}</div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div style={{ ...cardStyle, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: colors.text, fontWeight: 800, marginBottom: 12 }}>
        {icon}
        <span>{title}</span>
      </div>
      <div style={{ display: "grid", gap: 10 }}>{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value?: ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px minmax(0,1fr)", gap: 10, alignItems: "start" }}>
      <div style={{ color: colors.faint, fontWeight: 700, fontSize: 12, letterSpacing: 0.3 }}>{label.toUpperCase()}</div>
      <div style={{ color: colors.sub, lineHeight: 1.6 }}>{value}</div>
    </div>
  );
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .trim();
  return cleaned || undefined;
}

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(String(item))).filter(Boolean) as string[];
}

function toBriefItems(value: unknown, maxItems = 4): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const normalized = value
    .replace(/\r/g, "")
    .replace(/(?:^|\s)(\d+)[.)]\s+/g, "\n$1. ")
    .replace(/\s+(\d+\))/g, "\n$1")
    .replace(/\s+[•-]\s+/g, "\n- ")
    .replace(/\s+(?=(?:PRIMARY|SECONDARY|TERTIARY|BACKUP|ALT(?:ERNATE)?|RISK|PROOF|ANGLE|PATH|HOOK)\s*:)/gi, "\n")
    .split(/\n+/)
    .map((item) => item.replace(/^\d+[.)]\s*/, "").replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
  return normalized.slice(0, maxItems).map((item) => item.replace(/\s+/g, " "));
}

function clipText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}

function ListCard({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, background: "#fbfdff", borderRadius: 14, padding: "15px 16px" }}>
      <div style={{ color: colors.text, fontWeight: 800, fontSize: 13, marginBottom: 10 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ color: colors.faint, fontSize: 13 }}>{empty || "Nothing captured yet."}</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((item, idx) => (
            <div key={`${title}-${idx}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <CheckCircle2 size={14} color={colors.primary} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ color: colors.sub, fontSize: 13.5, lineHeight: 1.55 }}>{item}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type EvidenceSource = {
  title: string;
  url: string;
  snippet?: string;
};

function sourceList(value: unknown): EvidenceSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : String(item.url || "Source"),
      url: typeof item.url === "string" ? item.url : "",
      snippet: typeof item.snippet === "string" ? item.snippet : undefined,
    }))
    .filter((item) => item.url);
}

function SourceLinks({ items }: { items: EvidenceSource[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
      <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.3 }}>SOURCES</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {items.map((item) => (
          <a
            key={`${item.url}-${item.title}`}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              textDecoration: "none",
              borderRadius: 999,
              border: `1px solid ${colors.border}`,
              background: "#fff",
              color: colors.primary,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 700,
              maxWidth: "100%",
            }}
            title={item.snippet || item.title}
          >
            <ExternalLink size={12} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{item.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function ContactItem({ contact }: { contact: Contact }) {
  const [re, setRe] = useState(false);

  const persona = canonicalPersona(contact.persona, contact.persona_type);
  const talkingPoints = Array.isArray(contact.talking_points) ? contact.talking_points : [];
  const warmPath = (contact.warm_intro_path || {}) as Record<string, unknown>;
  const enrichData = (contact.enrichment_data || {}) as Record<string, unknown>;
  const emailConfidence = typeof enrichData.confidence === "number" ? enrichData.confidence : null;

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 14px", background: "#fbfdff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <Link
            to={`/account-sourcing/contacts/${contact.id}`}
            style={{ color: colors.text, fontWeight: 800, fontSize: 15, textDecoration: "none" }}
          >
            {contact.first_name} {contact.last_name}
          </Link>
          <div style={{ color: colors.sub, marginTop: 3 }}>{contact.title || "No title"}</div>
          <div style={{ color: colors.faint, marginTop: 4, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            {contact.email || "No email"}
            {contact.email_verified && (
              <span style={{ background: "#eefcf5", color: colors.green, borderRadius: 999, fontSize: 10, padding: "2px 6px", fontWeight: 700 }}>verified</span>
            )}
            {emailConfidence !== null && (
              <span style={{
                background: emailConfidence >= 80 ? "#eefcf5" : emailConfidence >= 50 ? "#fff4df" : "#ffecef",
                color: emailConfidence >= 80 ? colors.green : emailConfidence >= 50 ? colors.amber : colors.red,
                borderRadius: 999, fontSize: 10, padding: "2px 6px", fontWeight: 700,
              }}>
                {emailConfidence}% conf
              </span>
            )}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {contact.outreach_lane ? (
              <span style={{ background: "#eef5ff", color: colors.primary, borderRadius: 999, fontSize: 11, padding: "4px 8px", fontWeight: 700 }}>
                {contact.outreach_lane.replace(/_/g, " ")}
              </span>
            ) : null}
            {contact.sequence_status ? (
              <span style={{ background: "#f3eaff", color: colors.violet, borderRadius: 999, fontSize: 11, padding: "4px 8px", fontWeight: 700 }}>
                {contact.sequence_status.replace(/_/g, " ")}
              </span>
            ) : null}
            {contact.assigned_rep_email ? (
              <span style={{ background: "#f7f9fc", color: colors.sub, borderRadius: 999, fontSize: 11, padding: "4px 8px", fontWeight: 700 }}>
                {contact.assigned_rep_email}
              </span>
            ) : null}
          </div>
          {contact.conversation_starter ? (
            <div style={{ marginTop: 10, color: colors.sub, fontSize: 13, lineHeight: 1.55 }}>
              <strong style={{ color: colors.text }}>Starter:</strong> {contact.conversation_starter}
            </div>
          ) : null}
          {warmPath.connection_path ? (
            <div style={{ marginTop: 8, color: colors.sub, fontSize: 13, lineHeight: 1.55 }}>
              <strong style={{ color: colors.text }}>Warm Path:</strong> {String(warmPath.connection_path)}
            </div>
          ) : null}
          {talkingPoints.length > 0 ? (
            <div style={{ marginTop: 8, color: colors.sub, fontSize: 13, lineHeight: 1.55 }}>
              <strong style={{ color: colors.text }}>Talking Points:</strong> {talkingPoints.slice(0, 2).join(" | ")}
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", justifyItems: "end", alignContent: "start", gap: 8 }}>
          {persona !== "unknown" ? (
            <span style={{ ...PERSONA_STYLE[persona], borderRadius: 999, fontSize: 11, padding: "4px 9px", fontWeight: 700 }}>
              {PERSONA_LABEL[persona]}
            </span>
          ) : null}

          <div style={{ display: "inline-flex", gap: 10 }}>
            {contact.email ? <a href={`mailto:${contact.email}`}><Mail size={14} /></a> : null}
            {contact.linkedin_url ? <a href={contact.linkedin_url} target="_blank" rel="noreferrer"><span><Globe size={14} /></span></a> : null}
            {contact.phone ? (
              <button
                type="button"
                onClick={() => window.__aircallDial?.(contact.phone!, `${contact.first_name} ${contact.last_name}`)}
                style={{ background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer" }}
                title={`Call ${contact.phone} in Aircall`}
              >
                <Phone size={14} />
              </button>
            ) : null}
          </div>

          <div style={{ color: colors.faint, fontSize: 12 }}>Enriched: {ts(contact.enriched_at)}</div>
          <div style={{ display: "inline-flex", gap: 8 }}>
            <button
              onClick={async () => {
                setRe(true);
                try {
                  await accountSourcingApi.reEnrichContact(contact.id);
                } finally {
                  setTimeout(() => setRe(false), 2500);
                }
              }}
              style={{ border: `1px solid ${colors.border}`, background: "#fff", color: colors.text, borderRadius: 10, padding: "6px 9px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {re ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Re-enrich
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AccountSourcingCompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();

  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const [re, setRe] = useState(false);
  const [icpResearching, setIcpResearching] = useState(false);
  const [push, setPush] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [workflow, setWorkflow] = useState({
    assigned_rep: "",
    assigned_rep_name: "",
    assigned_rep_email: "",
    outreach_status: "",
    disposition: "",
    recommended_outreach_lane: "",
    instantly_campaign_id: "",
    account_thesis: "",
    why_now: "",
    beacon_angle: "",
    rep_feedback: "",
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [c, ct] = await Promise.all([
        accountSourcingApi.getCompany(id),
        accountSourcingApi.getContacts(id),
      ]);
      setCompany(c);
      setContacts(ct);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const refreshUntilSettled = useCallback(async (options?: { attempts?: number; delayMs?: number; stopWhen?: (company: Company) => boolean }) => {
    if (!id) return;
    const attempts = options?.attempts ?? 18;
    const delayMs = options?.delayMs ?? 5000;
    for (let i = 0; i < attempts; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const [c, ct] = await Promise.all([
        accountSourcingApi.getCompany(id),
        accountSourcingApi.getContacts(id),
      ]);
      setCompany(c);
      setContacts(ct);
      if (options?.stopWhen?.(c)) {
        return;
      }
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setWorkflow({
      assigned_rep: company?.assigned_rep || "",
      assigned_rep_name: company?.assigned_rep_name || "",
      assigned_rep_email: company?.assigned_rep_email || "",
      outreach_status: company?.outreach_status || "",
      disposition: company?.disposition || "",
      recommended_outreach_lane: company?.recommended_outreach_lane || "",
      instantly_campaign_id: company?.instantly_campaign_id || "",
      account_thesis: company?.account_thesis || "",
      why_now: company?.why_now || "",
      beacon_angle: company?.beacon_angle || "",
      rep_feedback: company?.rep_feedback || "",
    });
  }, [
    company?.assigned_rep,
    company?.assigned_rep_name,
    company?.assigned_rep_email,
    company?.outreach_status,
    company?.disposition,
    company?.recommended_outreach_lane,
    company?.instantly_campaign_id,
    company?.account_thesis,
    company?.why_now,
    company?.beacon_angle,
    company?.rep_feedback,
  ]);

  const cache = useMemo(() => (company?.enrichment_cache || {}) as Record<string, unknown>, [company]);
  const prospectingProfile = (company?.prospecting_profile || {}) as Record<string, unknown>;
  const outreachPlan = (company?.outreach_plan || {}) as Record<string, unknown>;
  const ai = unwrapCache(cache, "ai_summary");
  const web = unwrapCache(cache, "web_scrape");
  const apollo = unwrapCache(cache, "apollo_company");
  const committee = unwrapCache(cache, "committee_coverage");
  const priorities = unwrapCache(cache, "prospecting_priorities");
  const committeeScore = typeof committee?.coverage_score === "number" ? committee.coverage_score : 0;
  const missingRoles = Array.isArray(committee?.missing_roles)
    ? (committee.missing_roles as Array<{ label?: string; why?: string }>)
    : [];
  const bestContacts = Array.isArray(committee?.best_contacts)
    ? (committee.best_contacts as Array<{ name?: string; title?: string; label?: string }>)
    : [];
  const fitReasoning = asText(ai?.icp_fit_reasoning);
  const intentSummary = asText(ai?.intent_signals_summary);
  const companySummary = asText(ai?.description) || company?.description || undefined;
  const competitors = asList(ai?.competitive_landscape);
  const techSignals = asList(ai?.tech_stack_signals);
  const websiteText = asText(web?.text);
  const warmPaths = Array.isArray(prospectingProfile.warm_paths)
    ? prospectingProfile.warm_paths as Array<Record<string, unknown>>
    : [];
  const sequenceFamily = asText(outreachPlan.sequence_family);
  const priority = company ? getAccountPrioritySnapshot(company) : null;

  // Intent signals — hiring, funding, product news from Serper
  const intentSignals = useMemo(() => {
    const entry = cache.intent_signals as Record<string, unknown> | undefined;
    if (!entry) return null;
    return (entry.data ?? entry) as Record<string, unknown>;
  }, [cache]);
  const hiringNews = useMemo(() => {
    const items = intentSignals?.hiring;
    return Array.isArray(items) ? items as Array<{ title?: string; snippet?: string; url?: string }> : [];
  }, [intentSignals]);
  const fundingNews = useMemo(() => {
    const items = intentSignals?.funding;
    return Array.isArray(items) ? items as Array<{ title?: string; snippet?: string; url?: string }> : [];
  }, [intentSignals]);
  const productNews = useMemo(() => {
    const items = intentSignals?.product;
    return Array.isArray(items) ? items as Array<{ title?: string; snippet?: string; url?: string }> : [];
  }, [intentSignals]);
  const allNewsItems = useMemo(() => {
    return [...hiringNews, ...fundingNews, ...productNews].filter((n) => n.title);
  }, [hiringNews, fundingNews, productNews]);

  // Tech stack from company model
  const techStackEntries = useMemo(() => {
    if (!company?.tech_stack || typeof company.tech_stack !== "object") return [];
    return Object.entries(company.tech_stack as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => ({ category: k, tools: String(v) }));
  }, [company?.tech_stack]);

  // ICP Intelligence Pipeline data
  const icpAnalysis = useMemo(() => {
    const entry = cache.icp_analysis as Record<string, unknown> | undefined;
    if (!entry) return null;
    const data = (entry.data ?? entry) as Record<string, unknown>;
    return data;
  }, [cache]);
  const researchSources = useMemo(() => {
    const sources = icpAnalysis?.sources;
    return sources && typeof sources === "object" ? (sources as Record<string, unknown>) : {};
  }, [icpAnalysis]);
  const icpAnalyzedAt = useMemo(() => {
    const entry = cache.icp_analysis as Record<string, unknown> | undefined;
    return typeof entry?.analyzed_at === "string" ? entry.analyzed_at : undefined;
  }, [cache]);
  const icpPersonas = useMemo(() => {
    const personas = prospectingProfile.icp_personas;
    return Array.isArray(personas) ? personas as Array<Record<string, string>> : [];
  }, [prospectingProfile]);
  const icpOpenGaps = useMemo(() => {
    const gaps = prospectingProfile.open_gaps;
    return Array.isArray(gaps) ? gaps.map(String) : [];
  }, [prospectingProfile]);
  const icpCommitteeCoverage = asText(prospectingProfile.committee_coverage);
  const implementationCycle = useMemo(() => {
    const raw = icpAnalysis?.implementation_cycle;
    if (!raw || typeof raw !== "object") return null;
    return raw as Record<string, unknown>;
  }, [icpAnalysis]);
  const salesPlay = useMemo(() => {
    const play = prospectingProfile.sales_play;
    return play && typeof play === "object" ? (play as Record<string, unknown>) : undefined;
  }, [prospectingProfile]);
  const entryPersona = salesPlay?.best_persona && typeof salesPlay.best_persona === "object"
    ? (salesPlay.best_persona as Record<string, unknown>)
    : undefined;
  const entryPersonaTitle = asText(entryPersona?.title);
  const entryPersonaRelevance = asText(entryPersona?.relevance);
  const riskFlags = Array.isArray(salesPlay?.risk_flags) ? (salesPlay.risk_flags as unknown[]).map(String).filter(Boolean) : [];
  const proofPoints = Array.isArray(salesPlay?.proof_points) ? (salesPlay.proof_points as unknown[]).map(String).filter(Boolean) : [];
  const whyNowItems = toBriefItems(icpAnalysis?.why_now ?? company?.why_now, 3);
  const outreachItems = toBriefItems(icpAnalysis?.recommended_outreach_strategy, 4);
  const starterItems = toBriefItems(icpAnalysis?.conversation_starter, 2);
  const nextStepItems = toBriefItems(icpAnalysis?.next_steps, 4);
  const fitReasonItems = toBriefItems(icpAnalysis?.icp_why ?? fitReasoning, 3);
  const intentReasonItems = toBriefItems(icpAnalysis?.intent_why ?? intentSummary, 3);
  const beaconCareItems = toBriefItems(icpAnalysis?.account_thesis, 2);
  const engageItems = toBriefItems(icpAnalysis?.beacon_angle, 3);
  const positiveSignalCards = [
    { title: "Hiring", value: clipText(asText(icpAnalysis?.ps_impl_hiring), 220) },
    { title: "Leadership", value: clipText(asText(icpAnalysis?.leadership_org_moves), 220) },
    { title: "Expansion", value: clipText(asText(icpAnalysis?.pr_funding_expansion), 220) },
    { title: "Events", value: clipText(asText(icpAnalysis?.events_thought_leadership), 220) },
    { title: "Proof", value: clipText(asText(icpAnalysis?.reviews_case_studies), 220) },
  ].filter((item) => item.value && item.value.toLowerCase() !== "none observed" && item.value.toLowerCase() !== "not analyzed") as Array<{ title: string; value: string }>;
  const negativeSignalCards = [
    { title: "AI Overlap", value: clipText(asText(icpAnalysis?.internal_ai_overlap), 220) },
    { title: "Constraints", value: clipText(asText(icpAnalysis?.strategic_constraints), 220) },
    { title: "Contraction", value: clipText(asText(icpAnalysis?.ps_cs_contraction), 220) },
    { title: "Build vs Buy", value: clipText(asText(icpAnalysis?.build_vs_buy), 220) },
    { title: "AI Acquisition", value: clipText(asText(icpAnalysis?.ai_acquisition), 220) },
  ].filter((item) => item.value && item.value.toLowerCase() !== "none observed" && item.value.toLowerCase() !== "not analyzed") as Array<{ title: string; value: string }>;
  const implCycle = useMemo(() => {
    const raw = icpAnalysis?.implementation_cycle;
    if (!raw || typeof raw !== "object") return null;
    const cycle = raw as Record<string, unknown>;
    // Only show if at least one field has real content
    const hasContent = ["enterprise", "mid_market", "minimum", "key_drivers", "evidence"]
      .some((k) => { const v = cycle[k]; return typeof v === "string" && v.length > 2; });
    return hasContent ? cycle : null;
  }, [icpAnalysis]);
  const researchQuality = useMemo(() => {
    const entry = cache.research_quality as Record<string, unknown> | undefined;
    if (!entry) return undefined;
    return (entry.data ?? entry) as Record<string, unknown>;
  }, [cache]);
  const evidenceLevel = asText(researchQuality?.evidence_level);
  const evidenceScore = typeof researchQuality?.evidence_score === "number" ? researchQuality.evidence_score : undefined;
  const fitSources = sourceList(researchSources.icp_why);
  const intentSources = sourceList(researchSources.intent_why);
  const thesisSources = sourceList(researchSources.account_thesis);
  const whyNowSources = sourceList(researchSources.why_now);
  const angleSources = sourceList(researchSources.beacon_angle);
  const engageSources = sourceList(researchSources.recommended_outreach_strategy);
  const hookSources = sourceList(researchSources.conversation_starter);
  const hiringSources = sourceList(researchSources.ps_impl_hiring);
  const leadershipSources = sourceList(researchSources.leadership_org_moves);
  const fundingSources = sourceList(researchSources.pr_funding_expansion);
  const eventsSources = sourceList(researchSources.events_thought_leadership);
  const reviewsSources = sourceList(researchSources.reviews_case_studies);
  const aiOverlapSources = sourceList(researchSources.internal_ai_overlap);
  const strategicSources = sourceList(researchSources.strategic_constraints);
  const revenueSources = sourceList(researchSources.revenue_funding);
  const committeeCoverageSources = sourceList(researchSources.committee_coverage);
  const nextStepSources = sourceList(researchSources.next_steps);
  const detailMetaItems = [
    company?.domain ? (company.domain.endsWith(".unknown") ? `Domain unresolved: ${company.domain}` : company.domain) : undefined,
    asText(company?.industry),
    asText(company?.funding_stage),
    company?.employee_count ? `${company.employee_count.toLocaleString()} employees` : undefined,
    typeof icpAnalysis?.category === "string" ? asText(icpAnalysis.category) : undefined,
    company?.headquarters ? `📍 ${company.headquarters}` : undefined,
    company?.region ? `🌐 ${company.region}` : undefined,
  ].filter(Boolean) as string[];

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ ...wrapStyle, ...cardStyle, padding: 28, textAlign: "center" }}>
          <Loader2 className="animate-spin" color={colors.primary} />
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div style={pageStyle}>
        <div style={{ ...wrapStyle, ...cardStyle, padding: 28, textAlign: "center", color: colors.faint }}>
          Company not found.
        </div>
      </div>
    );
  }

  const saveWorkflow = async () => {
    setSavingWorkflow(true);
    try {
      await accountSourcingApi.updateCompany(company.id, {
        assigned_rep: workflow.assigned_rep.trim() || null,
        assigned_rep_name: workflow.assigned_rep_name.trim() || null,
        assigned_rep_email: workflow.assigned_rep_email.trim() || null,
        outreach_status: workflow.outreach_status || null,
        disposition: workflow.disposition || null,
        recommended_outreach_lane: workflow.recommended_outreach_lane || null,
        instantly_campaign_id: workflow.instantly_campaign_id.trim() || null,
        account_thesis: workflow.account_thesis.trim() || null,
        why_now: workflow.why_now.trim() || null,
        beacon_angle: workflow.beacon_angle.trim() || null,
        rep_feedback: workflow.rep_feedback.trim() || null,
      });
      await load();
    } finally {
      setSavingWorkflow(false);
    }
  };

  const tier = company.icp_tier || "cold";

  return (
    <div style={pageStyle}>
      <div style={wrapStyle}>
        <button
          onClick={() => nav("/account-sourcing")}
          style={{
            justifySelf: "start",
            border: 0,
            background: "transparent",
            color: colors.sub,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 700,
            cursor: "pointer",
            padding: 0,
          }}
        >
          <ArrowLeft size={14} /> Back to Account Sourcing
        </button>

        <div
          style={{
            ...cardStyle,
            padding: "24px 26px",
            background: "linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(242,247,255,0.98) 60%, rgba(255,244,236,0.98) 100%)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, maxWidth: 980 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 999, padding: "6px 12px", background: "#eef5ff", color: colors.primary, fontSize: 12, fontWeight: 800, letterSpacing: 0.4 }}>
                <Brain size={13} />
                ACCOUNT INTELLIGENCE
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <Building2 size={18} color="#8b98ad" />
                <h1 style={{ margin: 0, color: colors.text, fontSize: 34, lineHeight: 1.1 }}>{company.name}</h1>
                <span style={{ ...ICP_STYLE[tier], borderRadius: 999, padding: "5px 10px", fontSize: 12, fontWeight: 800 }}>
                  {tier.toUpperCase()} · {company.icp_score ?? 0}/100
                </span>
                {priority ? (
                  <>
                    <span style={{ ...PRIORITY_STYLE[priority.priorityBand], borderRadius: 999, padding: "5px 10px", fontSize: 12, fontWeight: 800 }}>
                      Priority {priority.priorityBand} · {priority.priorityScore}
                    </span>
                    <span style={{ ...INTEREST_STYLE[priority.interestLevel], borderRadius: 999, padding: "5px 10px", fontSize: 12, fontWeight: 800 }}>
                      Interest {priority.interestLevel}
                    </span>
                  </>
                ) : null}
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {detailMetaItems.map((item) => (
                  <span
                    key={item}
                    style={{
                      borderRadius: 999,
                      padding: "6px 10px",
                      background: item.startsWith("Domain unresolved") ? "#fff4df" : "#f4f7fb",
                      border: `1px solid ${item.startsWith("Domain unresolved") ? "#ffe0b2" : colors.border}`,
                      color: item.startsWith("Domain unresolved") ? colors.amber : colors.sub,
                      fontSize: 12,
                      fontWeight: 600,
                      lineHeight: 1.2,
                    }}
                  >
                    {item}
                  </span>
                ))}
                {!company.domain.endsWith(".unknown") ? (
                  <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" style={{ color: colors.primary, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 2px" }}>
                    <Globe size={13} /> Visit site <ExternalLink size={11} />
                  </a>
                ) : null}
              </div>

              <p style={{ marginTop: 14, marginBottom: 0, color: colors.sub, lineHeight: 1.75, fontSize: 15, maxWidth: 920 }}>
                {companySummary || "This account is in sourcing. Use the sections below to quickly decide fit, identify missing stakeholders, and shape the next prospecting move."}
              </p>

              {(company.domain.endsWith(".unknown") || !company.enriched_at) ? (
                <div style={{ marginTop: 14, border: `1px solid #ffe0b2`, background: "#fff9f0", borderRadius: 12, padding: "10px 12px", color: colors.amber, fontSize: 13, lineHeight: 1.55 }}>
                  {company.domain.endsWith(".unknown")
                    ? "This account still has an unresolved domain placeholder, so some web and paid enrichment may be incomplete."
                    : "This account has not completed enrichment yet."}
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
              <button
                onClick={async () => {
                  setIcpResearching(true);
                  try {
                    await accountSourcingApi.icpResearch(company.id);
                    const currentEnrichedAt = company.enriched_at;
                    await refreshUntilSettled({
                      stopWhen: (next) =>
                        next.enriched_at !== currentEnrichedAt ||
                        !next.domain.endsWith(".unknown"),
                    });
                  } finally {
                    setIcpResearching(false);
                    load();
                  }
                }}
                style={{ border: `1px solid #d0e8d0`, background: "#eef8ef", color: "#1f8f5f", borderRadius: 12, padding: "10px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "center" }}
              >
                {icpResearching ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />} ICP Research
              </button>

              <button
                onClick={async () => {
                  setRe(true);
                  try {
                    await accountSourcingApi.reEnrichCompany(company.id);
                    const currentEnrichedAt = company.enriched_at;
                    await refreshUntilSettled({
                      stopWhen: (next) =>
                        next.enriched_at !== currentEnrichedAt ||
                        !next.domain.endsWith(".unknown"),
                    });
                  } finally {
                    setRe(false);
                    load();
                  }
                }}
                style={{ border: `1px solid ${colors.border}`, background: "#fff", color: colors.text, borderRadius: 12, padding: "10px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "center" }}
              >
                {re ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Re-enrich
              </button>

              <button
                onClick={async () => {
                  setPush(true);
                  try {
                    await accountSourcingApi.pushToInstantly(company.id, workflow.instantly_campaign_id || company.instantly_campaign_id || "default");
                  } finally {
                    setTimeout(() => setPush(false), 1800);
                  }
                }}
                style={{ border: `1px solid #cde5ff`, background: "#eff7ff", color: "#1f5ecc", borderRadius: 12, padding: "10px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "center" }}
              >
                {push ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Push to Instantly
              </button>
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.border}`, display: "flex", gap: 16, flexWrap: "wrap", color: colors.faint, fontSize: 13 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Clock size={12} /> Enriched: {ts(company.enriched_at)}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Clock size={12} /> Created: {formatDate(company.created_at)}</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <MetricCard
            label="ICP Score"
            value={`${company.icp_score ?? 0}`}
            hint="Current fit score based on firmographics, signals, and detected tooling."
            tone={tier === "hot" ? "warm" : "primary"}
          />
          <MetricCard
            label="TAL Verdict"
            value={typeof icpAnalysis?.classification === "string" ? String(icpAnalysis.classification) : "N/A"}
            hint={typeof icpAnalysis?.fit_type === "string" ? String(icpAnalysis.fit_type) : "Verdict pending"}
            tone={String(icpAnalysis?.classification || "").toLowerCase() === "target" ? "green" : "primary"}
          />
          <MetricCard
            label="Research Quality"
            value={evidenceLevel || "Pending"}
            hint={typeof evidenceScore === "number" ? `Evidence score ${evidenceScore}` : "Waiting for enough live evidence."}
            tone={evidenceLevel === "strong" ? "green" : evidenceLevel === "partial" ? "primary" : "warm"}
          />
          <MetricCard
            label="Best Entry"
            value={entryPersonaTitle || "Need mapping"}
            hint={entryPersonaRelevance || "Lead with the operator most likely to own rollout pain."}
            tone="primary"
          />
          <MetricCard
            label="Proof / Risks"
            value={`${proofPoints.length} / ${riskFlags.length}`}
            hint={riskFlags.length === 0 ? "Clean signal set so far." : "Review the captured risks before sequencing."}
            tone={riskFlags.length === 0 ? "green" : "warm"}
          />
          <MetricCard
            label="Priority"
            value={priority ? `${priority.priorityScore}` : "0"}
            hint={priority ? `${priority.priorityBand} priority based on fit, timing, evidence, and sales feedback.` : "Priority unavailable"}
            tone={priority?.priorityBand === "high" ? "green" : "primary"}
          />
          <MetricCard
            label="Contacts"
            value={String(contacts.length)}
            hint="Discovered stakeholders available for prospecting and meeting prep."
            tone="neutral"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.45fr) minmax(320px, 0.95fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 14 }}>
            <Section title="Account Thesis" icon={<Target size={15} color={colors.primary} />}>
              {toBriefItems(icpAnalysis?.core_focus, 3).length > 0 && (
                <div style={{ background: "#f8fbff", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ color: colors.faint, fontWeight: 800, fontSize: 11, letterSpacing: 0.4, marginBottom: 6 }}>WHAT THEY DO & WHY IMPLEMENTATIONS ARE COMPLEX</div>
                  <div style={{ color: colors.sub, fontSize: 13.5, lineHeight: 1.65 }}>
                    {toBriefItems(icpAnalysis?.core_focus, 3).join(" ")}
                  </div>
                </div>
              )}

              <div>
                <div style={{ color: colors.text, fontWeight: 800, marginBottom: 8 }}>Why this account fits Beacon</div>
                <ListCard title="Fit Summary" items={fitReasonItems} empty="No fit reasoning available yet." />
                <SourceLinks items={fitSources} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                <div>
                  <ListCard title="Intent Summary" items={intentReasonItems.length ? intentReasonItems : intentSummary ? [intentSummary] : []} empty="No intent summary available." />
                  <SourceLinks items={intentSources} />
                </div>
              </div>
            </Section>

            {implementationCycle && (
              <Section title="Implementation Cycle" icon={<Clock size={15} color={colors.amber} />}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  {typeof implementationCycle.enterprise === "string" && implementationCycle.enterprise && (
                    <div style={{ background: colors.redSoft, border: `1px solid #ffd0d8`, borderRadius: 10, padding: "10px 14px" }}>
                      <div style={{ color: colors.red, fontWeight: 800, fontSize: 10, letterSpacing: 0.4, marginBottom: 4 }}>ENTERPRISE</div>
                      <div style={{ color: colors.text, fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{String(implementationCycle.enterprise)}</div>
                    </div>
                  )}
                  {typeof implementationCycle.midmarket === "string" && implementationCycle.midmarket && (
                    <div style={{ background: colors.amberSoft, border: `1px solid #ffe4b0`, borderRadius: 10, padding: "10px 14px" }}>
                      <div style={{ color: colors.amber, fontWeight: 800, fontSize: 10, letterSpacing: 0.4, marginBottom: 4 }}>MID-MARKET</div>
                      <div style={{ color: colors.text, fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{String(implementationCycle.midmarket)}</div>
                    </div>
                  )}
                  {typeof implementationCycle.minimum === "string" && implementationCycle.minimum && (
                    <div style={{ background: colors.greenSoft, border: `1px solid #c8e8d8`, borderRadius: 10, padding: "10px 14px" }}>
                      <div style={{ color: colors.green, fontWeight: 800, fontSize: 10, letterSpacing: 0.4, marginBottom: 4 }}>MINIMUM</div>
                      <div style={{ color: colors.text, fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>{String(implementationCycle.minimum)}</div>
                    </div>
                  )}
                </div>
                {Array.isArray(implementationCycle.key_drivers) && (implementationCycle.key_drivers as string[]).length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ color: colors.faint, fontWeight: 800, fontSize: 10, letterSpacing: 0.4, marginBottom: 6 }}>KEY DRIVERS</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(implementationCycle.key_drivers as string[]).map((driver, i) => (
                        <span key={i} style={{
                          fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999,
                          background: "#f0f3f9", color: colors.sub, border: `1px solid ${colors.border}`,
                        }}>{driver}</span>
                      ))}
                    </div>
                  </div>
                )}
                {typeof implementationCycle.review_signals === "string" && implementationCycle.review_signals && (
                  <div style={{ marginTop: 10, background: "#f8f7f5", border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ color: colors.faint, fontWeight: 800, fontSize: 10, letterSpacing: 0.4, marginBottom: 4 }}>G2 / CAPTERRA / REDDIT REVIEWS</div>
                    <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.65, fontStyle: "italic" }}>{String(implementationCycle.review_signals)}</div>
                  </div>
                )}
              </Section>
            )}

            {icpAnalysis ? (
              <Section title="Sales Brief" icon={<Brain size={15} color="#7a2dd9" />}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  {icpAnalyzedAt && (
                    <span style={{ fontSize: 11, color: colors.faint, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Clock size={11} /> Analyzed: {ts(icpAnalyzedAt)}
                    </span>
                  )}
                  {typeof icpAnalysis.confidence === "string" && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "2px 8px",
                      background: icpAnalysis.confidence === "high" ? colors.greenSoft : icpAnalysis.confidence === "medium" ? colors.amberSoft : colors.redSoft,
                      color: icpAnalysis.confidence === "high" ? colors.green : icpAnalysis.confidence === "medium" ? colors.amber : colors.red,
                    }}>
                      {String(icpAnalysis.confidence).toUpperCase()} CONFIDENCE
                    </span>
                  )}
                  {typeof icpAnalysis._source === "string" && icpAnalysis._source === "claude_icp_pipeline" && (
                    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "2px 8px", background: "#f3eaff", color: "#7a2dd9" }}>
                      AI-RESEARCHED
                    </span>
                  )}
                  {evidenceLevel && (
                    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "2px 8px", background: "#eef5ff", color: colors.primary }}>
                      {evidenceLevel.toUpperCase()} EVIDENCE
                    </span>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                  <MetricCard
                    label="ICP Fit"
                    value={typeof icpAnalysis.icp_fit_score === "number" ? `${icpAnalysis.icp_fit_score}/10` : "N/A"}
                    hint={typeof icpAnalysis.classification === "string" ? String(icpAnalysis.classification) : "TAL classification"}
                    tone={Number(icpAnalysis.icp_fit_score) >= 7 ? "green" : Number(icpAnalysis.icp_fit_score) >= 4 ? "primary" : "warm"}
                  />
                  <MetricCard
                    label="Intent"
                    value={typeof icpAnalysis.intent_score === "number" ? `${icpAnalysis.intent_score}/10` : "N/A"}
                    hint={typeof icpAnalysis.fit_type === "string" ? String(icpAnalysis.fit_type) : "Fit type"}
                    tone={Number(icpAnalysis.intent_score) >= 7 ? "green" : Number(icpAnalysis.intent_score) >= 4 ? "primary" : "warm"}
                  />
                  <MetricCard
                    label="Financial"
                    value={icpAnalysis.financial_capacity_met ? "Met" : "Not Met"}
                    hint={typeof icpAnalysis.revenue_funding === "string" ? String(icpAnalysis.revenue_funding).slice(0, 80) : "150K+ ACV capacity"}
                    tone={icpAnalysis.financial_capacity_met ? "green" : "warm"}
                  />
                </div>
                <SourceLinks items={revenueSources} />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                  <div>
                    <ListCard title="Why Beacon Should Care" items={beaconCareItems} empty="No account thesis generated yet." />
                    <SourceLinks items={thesisSources} />
                  </div>
                  <div>
                    <ListCard title="Why Now" items={whyNowItems} empty="No timing trigger captured yet." />
                    <SourceLinks items={whyNowSources} />
                  </div>
                  <div>
                    <ListCard title="How To Engage" items={engageItems} empty="No Beacon angle generated yet." />
                    <SourceLinks items={angleSources.length ? angleSources : engageSources} />
                  </div>
                  <div>
                    <ListCard title="What To Say First" items={starterItems} empty="No opening hook captured yet." />
                    <SourceLinks items={hookSources} />
                  </div>
                </div>

                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.green, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                    <Radar size={14} /> Positive Signals
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                    {positiveSignalCards.map((item) => (
                      <div key={item.title} style={{ background: "#f0faf4", border: "1px solid #d0e8d0", borderRadius: 10, padding: "10px 14px" }}>
                        <div style={{ color: colors.green, fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>{item.title.toUpperCase()}</div>
                        <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.6, marginTop: 4 }}>{item.value}</div>
                        <SourceLinks
                          items={
                            item.title === "Hiring" ? hiringSources :
                            item.title === "Leadership" ? leadershipSources :
                            item.title === "Expansion" ? fundingSources :
                            item.title === "Events" ? eventsSources :
                            reviewsSources
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.red, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                    <AlertTriangle size={14} /> Negative Signals
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                    {negativeSignalCards.map((item) => (
                      <div key={item.title} style={{ background: "#fff5f5", border: "1px solid #ffd0d8", borderRadius: 10, padding: "10px 14px" }}>
                        <div style={{ color: colors.red, fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>{item.title.toUpperCase()}</div>
                        <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.6, marginTop: 4 }}>{item.value}</div>
                        <SourceLinks items={item.title === "AI Overlap" ? aiOverlapSources : strategicSources} />
                      </div>
                    ))}
                    {negativeSignalCards.length === 0 && (
                      <div style={{ color: colors.green, fontSize: 13 }}>No negative signals detected.</div>
                    )}
                  </div>
                </div>

                {/* Implementation Cycle Duration */}
                {implCycle && (
                  <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.violet, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                      <Clock size={14} /> Implementation Cycle
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
                      {typeof implCycle.enterprise === "string" && implCycle.enterprise && (
                        <div style={{ background: "#f3eaff", border: "1px solid #e0d0f5", borderRadius: 10, padding: "10px 14px" }}>
                          <div style={{ color: colors.violet, fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>ENTERPRISE</div>
                          <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.6, marginTop: 4 }}>{implCycle.enterprise}</div>
                        </div>
                      )}
                      {typeof implCycle.mid_market === "string" && implCycle.mid_market && (
                        <div style={{ background: "#eef5ff", border: "1px solid #d5e5ff", borderRadius: 10, padding: "10px 14px" }}>
                          <div style={{ color: colors.primary, fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>MID-MARKET</div>
                          <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.6, marginTop: 4 }}>{implCycle.mid_market}</div>
                        </div>
                      )}
                      {typeof implCycle.minimum === "string" && implCycle.minimum && (
                        <div style={{ background: "#e8f8f0", border: "1px solid #c8e8d8", borderRadius: 10, padding: "10px 14px" }}>
                          <div style={{ color: colors.green, fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>MINIMUM</div>
                          <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.6, marginTop: 4 }}>{implCycle.minimum}</div>
                        </div>
                      )}
                    </div>
                    {typeof implCycle.key_drivers === "string" && implCycle.key_drivers && (
                      <div style={{ marginTop: 8, background: "#f8f5ff", border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 14px" }}>
                        <div style={{ color: colors.faint, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, marginBottom: 4 }}>KEY DRIVERS</div>
                        <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.6 }}>{implCycle.key_drivers}</div>
                      </div>
                    )}
                    {typeof implCycle.evidence === "string" && implCycle.evidence && (
                      <div style={{ marginTop: 6, color: colors.faint, fontSize: 12, fontStyle: "italic", lineHeight: 1.5 }}>
                        {implCycle.evidence}
                      </div>
                    )}
                  </div>
                )}

                {/* Sales Strategy */}
                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.text, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                    <Target size={14} /> Action Plan
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                    <ListCard title="Outreach Strategy" items={outreachItems} empty="No outreach strategy captured yet." />
                    <div>
                      <ListCard title="Next Steps" items={nextStepItems} empty="No next steps captured yet." />
                      <SourceLinks items={nextStepSources} />
                    </div>
                  </div>
                </div>
              </Section>
            ) : null}

            <Section title="Warm Intro Map" icon={<Users size={15} color={colors.primary} />}>
              {warmPaths.length === 0 ? (
                <div style={{ color: colors.faint }}>No connector paths captured for this account yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {warmPaths.map((item, idx) => (
                    <div key={`warm-path-${idx}`} style={{ border: `1px solid ${colors.border}`, background: "#fbfdff", borderRadius: 14, padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ color: colors.text, fontWeight: 800 }}>{String(item.name || `Connector ${idx + 1}`)}</div>
                        {item.strength ? (
                          <span style={{ borderRadius: 999, padding: "4px 8px", background: "#eef5ff", color: colors.primary, fontSize: 11, fontWeight: 800 }}>
                            Strength {String(item.strength)}
                          </span>
                        ) : null}
                      </div>
                      {item.connection_path ? (
                        <div style={{ marginTop: 8, color: colors.sub, fontSize: 13.5, lineHeight: 1.6 }}>
                          <strong style={{ color: colors.text }}>Path:</strong> {String(item.connection_path)}
                        </div>
                      ) : null}
                      {item.why_it_works ? (
                        <div style={{ marginTop: 6, color: colors.sub, fontSize: 13.5, lineHeight: 1.6 }}>
                          <strong style={{ color: colors.text }}>Why it works:</strong> {String(item.why_it_works)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {allNewsItems.length > 0 && (
              <Section title="Recent News & Signals" icon={<Newspaper size={15} color={colors.primary} />}>
                <div style={{ display: "grid", gap: 8 }}>
                  {hiringNews.length > 0 && (
                    <div>
                      <div style={{ color: colors.green, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, marginBottom: 6 }}>HIRING SIGNALS</div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {hiringNews.map((item, idx) => (
                          <div key={`h-${idx}`} style={{ border: `1px solid #d0e8d0`, background: "#f0faf4", borderRadius: 10, padding: "10px 14px" }}>
                            <div style={{ color: colors.text, fontSize: 13, fontWeight: 700 }}>{item.title}</div>
                            {item.snippet && <div style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.5, marginTop: 4 }}>{item.snippet}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {fundingNews.length > 0 && (
                    <div>
                      <div style={{ color: colors.primary, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, marginBottom: 6 }}>FUNDING & INVESTMENT</div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {fundingNews.map((item, idx) => (
                          <div key={`f-${idx}`} style={{ border: `1px solid #cde5ff`, background: "#eff7ff", borderRadius: 10, padding: "10px 14px" }}>
                            <div style={{ color: colors.text, fontSize: 13, fontWeight: 700 }}>{item.title}</div>
                            {item.snippet && <div style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.5, marginTop: 4 }}>{item.snippet}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {productNews.length > 0 && (
                    <div>
                      <div style={{ color: colors.violet, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, marginBottom: 6 }}>PRODUCT & PARTNERSHIPS</div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {productNews.map((item, idx) => (
                          <div key={`p-${idx}`} style={{ border: `1px solid #e0d5f5`, background: "#f8f4ff", borderRadius: 10, padding: "10px 14px" }}>
                            <div style={{ color: colors.text, fontSize: 13, fontWeight: 700 }}>{item.title}</div>
                            {item.snippet && <div style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.5, marginTop: 4 }}>{item.snippet}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            )}

            <Section title="Competitive & Tech Landscape" icon={<Shield size={15} color={colors.primary} />}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                <ListCard title="Competitors" items={competitors} empty="No competitive landscape captured." />
                <ListCard title="Tech Signals" items={techSignals} empty="No tech signals captured." />
              </div>
              {techStackEntries.length > 0 && (
                <div>
                  <div style={{ color: colors.faint, fontWeight: 700, fontSize: 12, letterSpacing: 0.3, marginBottom: 8 }}>DETECTED TECH STACK</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {techStackEntries.map(({ category, tools }) => (
                      <span key={category} style={{ borderRadius: 999, padding: "6px 10px", background: "#f3eaff", color: colors.violet, fontSize: 12, fontWeight: 600 }}>
                        {category}: {tools}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(priorities) && priorities.length > 0 ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ color: colors.text, fontWeight: 800 }}>Prospecting priorities</div>
                  {(priorities as unknown[]).map((item, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 8, alignItems: "flex-start", borderRadius: 12, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "12px 14px" }}>
                      <CheckCircle2 size={14} color={colors.primary} style={{ marginTop: 2, flexShrink: 0 }} />
                      <div style={{ color: colors.sub, fontSize: 13.5, lineHeight: 1.6 }}>{String(item)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </Section>

            <Section title={`Stakeholders (${contacts.length})`} icon={<Users size={15} color={colors.primary} />}>
              {icpPersonas.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: colors.faint, fontWeight: 700, fontSize: 12, letterSpacing: 0.3, marginBottom: 8 }}>KEY PERSONAS</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {icpPersonas.map((p, i) => (
                      <div key={i} style={{ background: "#fbfdff", border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 14px" }}>
                        <div style={{ color: colors.text, fontSize: 13, fontWeight: 700 }}>{p.title || "Unknown"}</div>
                        {p.name && <div style={{ color: colors.primary, fontSize: 12 }}>{p.name}</div>}
                        {p.relevance && <div style={{ color: colors.faint, fontSize: 12, marginTop: 2 }}>{p.relevance}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {contacts.length === 0 && icpPersonas.length === 0 ? (
                <div style={{ color: colors.faint }}>No contacts discovered yet.</div>
              ) : contacts.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {contacts.map((c) => <ContactItem key={c.id} contact={c} />)}
                </div>
              ) : null}
            </Section>

            <Section title="Rep Workflow" icon={<MessageSquare size={15} color={colors.primary} />}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <div style={{ background: "#f8fafc", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 11, color: colors.faint, fontWeight: 600, marginBottom: 6 }}>Assigned Owner</div>
                  <AssignDropdown
                    entityType="company"
                    entityId={company.id}
                    currentAssignedId={company.assigned_to_id}
                    currentAssignedName={company.assigned_to_name || company.assigned_rep_name || company.assigned_rep}
                    onAssigned={() => load()}
                  />
                </div>
                <MetricCard
                  label="Outreach Lane"
                  value={company.recommended_outreach_lane ? company.recommended_outreach_lane.replace(/_/g, " ") : "Auto"}
                  hint={sequenceFamily || "Lane determines whether this should go through a connector, event follow-up, or Instantly."}
                  tone="primary"
                />
                <MetricCard
                  label="Leverage"
                  value={priority ? `${priority.outreachLeverage}` : "0"}
                  hint={
                    warmPaths.length > 0
                      ? `${warmPaths.length} warm paths available. ${company.disposition ? `Disposition: ${company.disposition.replace(/_/g, " ")}.` : ""}`
                      : company.disposition ? `Disposition: ${company.disposition.replace(/_/g, " ")}` : "No warm path captured yet."
                  }
                  tone="green"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <input
                  value={workflow.assigned_rep_name}
                  onChange={(e) => setWorkflow((current) => ({ ...current, assigned_rep_name: e.target.value }))}
                  placeholder="Assigned rep name"
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text }}
                />
                <input
                  value={workflow.assigned_rep_email}
                  onChange={(e) => setWorkflow((current) => ({ ...current, assigned_rep_email: e.target.value }))}
                  placeholder="Assigned rep email"
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text }}
                />
                <input
                  value={workflow.assigned_rep}
                  onChange={(e) => setWorkflow((current) => ({ ...current, assigned_rep: e.target.value }))}
                  placeholder="Legacy owner label"
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <select
                  value={workflow.outreach_status}
                  onChange={(e) => setWorkflow((current) => ({ ...current, outreach_status: e.target.value }))}
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text, background: "#fff" }}
                >
                  {OUTREACH_STATUS_OPTIONS.map((option) => (
                    <option key={option.value || "blank"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={workflow.recommended_outreach_lane}
                  onChange={(e) => setWorkflow((current) => ({ ...current, recommended_outreach_lane: e.target.value }))}
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text, background: "#fff" }}
                >
                  {OUTREACH_LANE_OPTIONS.map((option) => (
                    <option key={option.value || "blank"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  value={workflow.instantly_campaign_id}
                  onChange={(e) => setWorkflow((current) => ({ ...current, instantly_campaign_id: e.target.value }))}
                  placeholder="Instantly campaign ID"
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text }}
                />
                <select
                  value={workflow.disposition}
                  onChange={(e) => setWorkflow((current) => ({ ...current, disposition: e.target.value }))}
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text, background: "#fff" }}
                >
                  {DISPOSITION_OPTIONS.map((option) => (
                    <option key={option.value || "blank"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                value={workflow.rep_feedback}
                onChange={(e) => setWorkflow((current) => ({ ...current, rep_feedback: e.target.value }))}
                placeholder="What happened in outreach? Why is this account worth pushing, pausing, or dropping?"
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "12px 14px", fontSize: 13, color: colors.text, minHeight: 92, resize: "vertical" }}
              />

              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ color: colors.faint, fontSize: 12 }}>
                  {company.last_outreach_at ? `Last outreach saved on ${formatDate(company.last_outreach_at)}.` : "Rep feedback will shape the interest and priority indicators for this account."}
                </div>
                <button
                  onClick={saveWorkflow}
                  disabled={savingWorkflow}
                  style={{ border: `1px solid ${colors.border}`, background: "#fff", color: colors.text, borderRadius: 10, padding: "9px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}
                >
                  {savingWorkflow ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Save workflow
                </button>
              </div>
            </Section>

            <Section title="Website Research" icon={<Globe size={15} color={colors.primary} />}>
              {websiteText ? (
                <div style={{ border: `1px solid ${colors.border}`, background: "#fbfdff", borderRadius: 14, padding: "16px 18px", maxHeight: 420, overflow: "auto" }}>
                  <div style={{ color: colors.sub, lineHeight: 1.75, fontSize: 14, whiteSpace: "pre-wrap" }}>{websiteText.slice(0, 4000)}</div>
                </div>
              ) : (
                <div style={{ color: colors.faint }}>No website scrape content available.</div>
              )}
            </Section>
          </div>

          <div style={{ display: "grid", gap: 14 }}>

            <Section title="Data Freshness" icon={<TrendingUp size={15} color={colors.primary} />}>
              {[
                ["Website Scrape", cacheTs(cache, "web_scrape")],
                ["Intent Signals", cacheTs(cache, "intent_signals")],
                ["Apollo Company", cacheTs(cache, "apollo_company")],
                ["Apollo Contacts", cacheTs(cache, "apollo_contacts")],
                ["Committee Coverage", cacheTs(cache, "committee_coverage")],
                ["AI Summary", cacheTs(cache, "ai_summary") || cacheTs(cache, "icp_analysis")],
              ].map(([name, t]) => (
                <div key={String(name)} style={{ display: "flex", justifyContent: "space-between", gap: 8, color: colors.sub }}>
                  <span style={{ fontWeight: 700 }}>{name}</span>
                  <span style={{ color: colors.faint, fontSize: 13 }}>{t ? ts(String(t)) : "-"}</span>
                </div>
              ))}

              {apollo ? (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${colors.border}` }}>
                  <div style={{ fontWeight: 800, color: colors.text, marginBottom: 6 }}>Apollo Snapshot</div>
                  {Object.entries(apollo).slice(0, 8).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, color: colors.sub, fontSize: 13, marginBottom: 3 }}>
                      <span>{k}</span>
                      <span>{String(v)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
