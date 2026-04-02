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
  AlertTriangle,
  Newspaper,
  Radar,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

import { accountSourcingApi, contactsApi, dealsApi } from "../lib/api";
import { Plus, UserPlus } from "lucide-react";
import {
  getProspectTrackingScore,
  getProspectTrackingStage,
  getProspectTrackingSummary,
  getProspectTrackingTone,
} from "../lib/prospectTracking";
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
  influencer: { background: "#f0e6ff", color: "#6b3fa0" },
  implementation_owner: { background: "#e6f7ff", color: "#0369a1" },
};

const PERSONA_LABEL: Record<string, string> = {
  buyer: "Economic Buyer",
  champion: "Champion",
  evaluator: "Technical Evaluator",
  blocker: "Blocker",
  influencer: "Influencer",
  implementation_owner: "Implementation Owner",
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
  if (normalized === "influencer") return "influencer";
  if (normalized === "implementation_owner") return "implementation_owner";
  return "unknown";
}

function isPriorityStakeholder(contact: Contact): boolean {
  const normalizedTitle = (contact.title || "").toLowerCase();
  const normalizedPersona = (contact.persona_type || contact.persona || "").toLowerCase();
  if (["buyer", "champion", "evaluator", "technical_evaluator", "implementation_owner"].includes(normalizedPersona)) {
    return true;
  }
  return [
    "director of engineering",
    "engineering director",
    "vp engineering",
    "head of engineering",
    "professional services",
    "implementation",
    "solutions consulting",
    "product management",
    "product manager",
    "director of product",
    "technology",
    "technical",
    "data science",
    "data",
    "enterprise applications",
  ].some((needle) => normalizedTitle.includes(needle));
}

function MetricCard({ label, value, hint, tone = "neutral", onClick }: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "primary" | "warm" | "green";
  onClick?: () => void;
}) {
  const toneStyle = {
    neutral: { bg: "#fbfdff", border: colors.border, accent: colors.sub },
    primary: { bg: "#eef5ff", border: "#cfe0fb", accent: colors.primary },
    warm: { bg: "#fff7eb", border: "#ffe0b2", accent: colors.amber },
    green: { bg: "#eefcf5", border: "#cdeedc", accent: colors.green },
  }[tone];

  return (
    <div
      onClick={onClick}
      style={{
        border: `1px solid ${toneStyle.border}`,
        background: toneStyle.bg,
        borderRadius: 14,
        padding: "14px 16px",
        cursor: onClick ? "pointer" : "default",
      }}
    >
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

function ContactItem({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const [re, setRe] = useState(false);

  const persona = canonicalPersona(contact.persona, contact.persona_type);
  const talkingPoints = Array.isArray(contact.talking_points) ? contact.talking_points : [];
  const warmPath = (contact.warm_intro_path || {}) as Record<string, unknown>;
  const enrichData = (contact.enrichment_data || {}) as Record<string, unknown>;
  const emailConfidence = typeof enrichData.confidence === "number" ? enrichData.confidence : null;
  const trackingTone = getProspectTrackingTone(contact);

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
            <span
              style={{
                background: trackingTone.background,
                color: trackingTone.color,
                borderRadius: 999,
                border: `1px solid ${trackingTone.border}`,
                fontSize: 11,
                padding: "4px 8px",
                fontWeight: 800,
              }}
            >
              {getProspectTrackingStage(contact)}
            </span>
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
          <div
            style={{
              marginTop: 10,
              borderRadius: 12,
              border: `1px solid ${trackingTone.border}`,
              background: trackingTone.soft,
              padding: "10px 12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: trackingTone.color, fontSize: 12, fontWeight: 800 }}>Automated progress</span>
              <span style={{ color: trackingTone.color, fontSize: 12, fontWeight: 900 }}>{getProspectTrackingScore(contact)}</span>
            </div>
            <div style={{ marginTop: 5, color: colors.sub, fontSize: 12.5, lineHeight: 1.55 }}>
              {getProspectTrackingSummary(contact)}
            </div>
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
          <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
            <div style={{ color: colors.faint, fontSize: 11, fontWeight: 700 }}>AE</div>
            <AssignDropdown
              entityType="contact"
              entityId={contact.id}
              currentAssignedId={contact.assigned_to_id}
              currentAssignedName={contact.assigned_to_name || contact.assigned_rep_email}
              onAssigned={() => onChanged()}
              compact
              role="ae"
              label="Assign AE"
            />
            <div style={{ color: colors.faint, fontSize: 11, fontWeight: 700 }}>SDR</div>
            <AssignDropdown
              entityType="contact"
              entityId={contact.id}
              currentAssignedId={contact.sdr_id}
              currentAssignedName={contact.sdr_name}
              onAssigned={() => onChanged()}
              compact
              role="sdr"
              label="Assign SDR"
            />
          </div>
          <div style={{ display: "inline-flex", gap: 8 }}>
            <button
              onClick={async () => {
                setRe(true);
                try {
                  await accountSourcingApi.reEnrichContact(contact.id);
                  onChanged();
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
  const [showAddStakeholder, setShowAddStakeholder] = useState(false);
  const [showDealModal, setShowDealModal] = useState(false);
  const [creatingDeal, setCreatingDeal] = useState(false);
  const [dealError, setDealError] = useState("");
  const [dealForm, setDealForm] = useState({
    name: "",
    value: "",
    stage: "discovery",
    close_date_est: "",
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

  const cache = useMemo(() => (company?.enrichment_cache || {}) as Record<string, unknown>, [company]);
  const prospectingProfile = (company?.prospecting_profile || {}) as Record<string, unknown>;
  const outreachPlan = (company?.outreach_plan || {}) as Record<string, unknown>;
  const ai = unwrapCache(cache, "ai_summary");
  const web = unwrapCache(cache, "web_scrape");
  const apollo = unwrapCache(cache, "apollo_company");
  const committee = unwrapCache(cache, "committee_coverage");
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
  const salesPlay = useMemo(() => {
    const play = prospectingProfile.sales_play;
    return play && typeof play === "object" ? (play as Record<string, unknown>) : undefined;
  }, [prospectingProfile]);
  const entryPersona = salesPlay?.best_persona && typeof salesPlay.best_persona === "object"
    ? (salesPlay.best_persona as Record<string, unknown>)
    : undefined;
  const entryPersonaTitle = asText(entryPersona?.title);
  const entryPersonaRelevance = asText(entryPersona?.relevance);
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
  const relevantContacts = useMemo(() => {
    const filtered = contacts.filter(isPriorityStakeholder);
    return filtered.length ? filtered : contacts;
  }, [contacts]);
  const contactMomentum = useMemo(() => {
    if (!relevantContacts.length) return null;
    const ranked = [...relevantContacts].sort((a, b) => (b.tracking_score || 0) - (a.tracking_score || 0));
    const best = ranked[0];
    const goodCount = relevantContacts.filter((contact) => contact.tracking_label === "good").length;
    const blockedCount = relevantContacts.filter((contact) => contact.tracking_label === "blocked").length;
    return {
      best,
      goodCount,
      blockedCount,
      hint:
        goodCount > 0
          ? `${goodCount} stakeholder${goodCount === 1 ? "" : "s"} showing positive momentum.`
          : blockedCount === relevantContacts.length
            ? "All visible stakeholders are currently blocked."
            : "No stakeholder has a strong signal yet.",
    };
  }, [relevantContacts]);
  const fundingSources = sourceList(researchSources.pr_funding_expansion);
  const eventsSources = sourceList(researchSources.events_thought_leadership);
  const reviewsSources = sourceList(researchSources.reviews_case_studies);
  const aiOverlapSources = sourceList(researchSources.internal_ai_overlap);
  const strategicSources = sourceList(researchSources.strategic_constraints);
  const revenueSources = sourceList(researchSources.revenue_funding);
  const committeeCoverageSources = sourceList(researchSources.committee_coverage);
  const nextStepSources = sourceList(researchSources.next_steps);
  const activityEntries = useMemo(() => {
    const entries = cache.activity_log;
    return Array.isArray(entries) ? [...entries].reverse().slice(0, 8) as Array<Record<string, unknown>> : [];
  }, [cache]);
  const competitorCards = useMemo(() => {
    const items = cache.competitive_landscape_v2;
    return Array.isArray(items) ? items as Array<Record<string, unknown>> : [];
  }, [cache]);
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
      setShowDealModal(false);
      setDealForm({ name: "", value: "", stage: "discovery", close_date_est: "" });
    } catch (error) {
      setDealError(error instanceof Error ? error.message : "Failed to create deal");
    } finally {
      setCreatingDeal(false);
    }
  };

  const scrollToContacts = () => {
    document.getElementById("stakeholders-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

            <div style={{ display: "grid", gap: 10, alignContent: "start", minWidth: 230 }}>
              <div style={{ ...cardStyle, padding: "12px 14px", display: "grid", gap: 8 }}>
                <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>ACCOUNT OWNER</div>
                <AssignDropdown
                  entityType="company"
                  entityId={company.id}
                  currentAssignedId={company.assigned_to_id}
                  currentAssignedName={company.assigned_to_name || company.assigned_rep_name || company.assigned_rep}
                  onAssigned={() => load()}
                  label="Assign owner"
                />
                <div style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.55 }}>
                  Assign ownership here. Stakeholder-level AE and SDR assignment stays inside the contacts section.
                </div>
              </div>
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
                type="button"
                onClick={() => setShowDealModal(true)}
                style={{ border: `1px solid #cde5ff`, background: "#eff7ff", color: "#1f5ecc", borderRadius: 12, padding: "10px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "center" }}
              >
                <Plus size={13} /> Add to Deal
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
            label="Priority"
            value={priority ? `${priority.priorityScore}` : "0"}
            hint={priority ? `${priority.priorityBand} priority based on fit, timing, evidence, and sales feedback.` : "Priority unavailable"}
            tone={priority?.priorityBand === "high" ? "green" : "primary"}
          />
          <MetricCard
            label="Contacts"
            value={String(relevantContacts.length)}
            hint="Relevant stakeholders ready for prospecting and meeting prep."
            tone="neutral"
            onClick={scrollToContacts}
          />
          <MetricCard
            label="Prospect Momentum"
            value={contactMomentum?.best ? getProspectTrackingStage(contactMomentum.best) : "No signals"}
            hint={
              contactMomentum?.best
                ? `${getProspectTrackingScore(contactMomentum.best)} · ${contactMomentum.hint}`
                : "Prospect momentum will appear once stakeholders start showing outreach or deal signals."
            }
            tone={
              contactMomentum?.best?.tracking_label === "good"
                ? "green"
                : contactMomentum?.best?.tracking_label === "blocked"
                  ? "warm"
                  : "primary"
            }
          />
        </div>

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

            <Section title="Competitive Landscape" icon={<Radar size={15} color={colors.primary} />}>
              {competitorCards.length === 0 ? (
                <div style={{ color: colors.faint }}>No competitor view has been captured yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {competitorCards.map((item, idx) => (
                    <div key={`competitor-${idx}`} style={{ border: `1px solid ${colors.border}`, background: "#fbfdff", borderRadius: 14, padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ color: colors.text, fontWeight: 800 }}>{String(item.name || `Competitor ${idx + 1}`)}</div>
                        {item.website ? (
                          <a href={String(item.website)} target="_blank" rel="noreferrer" style={{ color: colors.primary, fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                            Visit site <ExternalLink size={11} style={{ display: "inline" }} />
                          </a>
                        ) : null}
                      </div>
                      {item.summary ? <div style={{ marginTop: 8, color: colors.sub, fontSize: 13.5, lineHeight: 1.6 }}>{String(item.summary)}</div> : null}
                      {item.pitch_angle ? (
                        <div style={{ marginTop: 10, borderRadius: 10, background: "#eef5ff", border: "1px solid #d5e5ff", padding: "10px 12px" }}>
                          <div style={{ color: colors.primary, fontSize: 11, fontWeight: 800, letterSpacing: 0.3 }}>PITCH ANGLE</div>
                          <div style={{ marginTop: 4, color: colors.sub, fontSize: 13, lineHeight: 1.6 }}>{String(item.pitch_angle)}</div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Account Activity" icon={<MessageSquare size={15} color={colors.primary} />}>
              {activityEntries.length === 0 ? (
                <div style={{ color: colors.faint }}>No account activity captured yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {activityEntries.map((entry, idx) => (
                    <div key={`activity-${idx}`} style={{ border: `1px solid ${colors.border}`, background: "#fbfdff", borderRadius: 14, padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ color: colors.text, fontWeight: 700 }}>
                          {`${String(entry.message || entry.action || "Update")}${entry.actor_name ? ` by ${String(entry.actor_name)}` : ""}`}
                        </div>
                        <div style={{ color: colors.faint, fontSize: 12 }}>{typeof entry.at === "string" ? ts(String(entry.at)) : "-"}</div>
                      </div>
                      <div style={{ color: colors.sub, fontSize: 12.5, marginTop: 6 }}>
                        {entry.actor_name ? `By ${String(entry.actor_name)}` : "By system"}
                        {entry.actor_email ? ` • ${String(entry.actor_email)}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <div id="stakeholders-section">
            <Section title={`Stakeholders (${relevantContacts.length})`} icon={<Users size={15} color={colors.primary} />}>
              {/* Add Stakeholder button */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                <button
                  onClick={() => setShowAddStakeholder(true)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "7px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700,
                    background: colors.primary, color: "#fff", border: "none", cursor: "pointer",
                  }}
                >
                  <UserPlus size={13} /> Add Stakeholder
                </button>
              </div>

              {/* Buying Committee grouped view */}
              {relevantContacts.length > 0 && (() => {
                const grouped: Record<string, Contact[]> = {};
                for (const c of relevantContacts) {
                  const role = canonicalPersona(c.persona, c.persona_type);
                  (grouped[role] ??= []).push(c);
                }
                const roleOrder = ["champion", "buyer", "evaluator", "influencer", "implementation_owner", "blocker", "unknown"];
                const sortedRoles = roleOrder.filter((r) => grouped[r]?.length);
                if (sortedRoles.length > 1 || (sortedRoles.length === 1 && sortedRoles[0] !== "unknown")) {
                  return (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ color: colors.faint, fontWeight: 700, fontSize: 12, letterSpacing: 0.3, marginBottom: 8 }}>BUYING COMMITTEE</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {sortedRoles.map((role) => (
                          <span key={role} style={{
                            ...PERSONA_STYLE[role] ?? { background: "#f1f5f9", color: "#64748b" },
                            borderRadius: 999, fontSize: 11, padding: "4px 10px", fontWeight: 700,
                          }}>
                            {PERSONA_LABEL[role] ?? role} ({grouped[role].length})
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

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
              {relevantContacts.length === 0 && icpPersonas.length === 0 ? (
                <div style={{ color: colors.faint }}>No contacts discovered yet.</div>
              ) : relevantContacts.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {relevantContacts.map((c) => <ContactItem key={c.id} contact={c} onChanged={load} />)}
                </div>
              ) : null}
            </Section>
            </div>

            <Section title="Website Research" icon={<Globe size={15} color={colors.primary} />}>
              {websiteText ? (
                <div style={{ border: `1px solid ${colors.border}`, background: "#fbfdff", borderRadius: 14, padding: "16px 18px", maxHeight: 420, overflow: "auto" }}>
                  <div style={{ color: colors.sub, lineHeight: 1.75, fontSize: 14, whiteSpace: "pre-wrap" }}>{websiteText.slice(0, 4000)}</div>
                </div>
              ) : (
                <div style={{ color: colors.faint }}>No website scrape content available.</div>
              )}
            </Section>
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

      {/* ── Add Stakeholder Modal ──────────────────────────────────── */}
      {showDealModal && (
        <>
          <div onClick={() => setShowDealModal(false)} style={{
            position: "fixed", inset: 0, background: "rgba(15,23,42,0.22)",
            backdropFilter: "blur(3px)", zIndex: 100,
          }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            zIndex: 101, width: 460, maxWidth: "90vw", background: "#fff",
            borderRadius: 18, boxShadow: "0 20px 60px rgba(15,23,42,0.18)",
            padding: "26px 26px 22px", display: "grid", gap: 14,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: colors.text, margin: 0 }}>Add to Deal</h3>
              <button onClick={() => setShowDealModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint, fontSize: 18 }}>x</button>
            </div>
            <input
              value={dealForm.name}
              onChange={(e) => setDealForm((current) => ({ ...current, name: e.target.value }))}
              placeholder="Deal name"
              style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input
                value={dealForm.value}
                onChange={(e) => setDealForm((current) => ({ ...current, value: e.target.value }))}
                placeholder="Value (optional)"
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text }}
              />
              <input
                type="date"
                value={dealForm.close_date_est}
                onChange={(e) => setDealForm((current) => ({ ...current, close_date_est: e.target.value }))}
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text }}
              />
            </div>
            <select
              value={dealForm.stage}
              onChange={(e) => setDealForm((current) => ({ ...current, stage: e.target.value }))}
              style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text, background: "#fff" }}
            >
              {["discovery", "evaluation", "proposal", "negotiation"].map((stage) => (
                <option key={stage} value={stage}>{stage.replace(/_/g, " ")}</option>
              ))}
            </select>
            {dealError ? <div style={{ color: colors.red, fontSize: 12, fontWeight: 700 }}>{dealError}</div> : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setShowDealModal(false)} style={{
                padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                background: "#f1f5f9", color: colors.sub, border: "none", cursor: "pointer",
              }}>Cancel</button>
              <button onClick={() => void handleCreateDeal()} disabled={creatingDeal} style={{
                padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                background: colors.primary, color: "#fff", border: "none", cursor: "pointer",
                opacity: creatingDeal ? 0.6 : 1,
              }}>
                {creatingDeal ? "Creating..." : "Create deal"}
              </button>
            </div>
          </div>
        </>
      )}
      {showAddStakeholder && (
        <AddStakeholderModal
          companyId={company.id}
          onClose={() => setShowAddStakeholder(false)}
          onCreated={() => { setShowAddStakeholder(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Add Stakeholder Modal ───────────────────────────────────────────────────

function AddStakeholderModal({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    title: "",
    email: "",
    phone: "",
    linkedin_url: "",
    persona_type: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError("First and last name are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await contactsApi.create({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        title: form.title.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        linkedin_url: form.linkedin_url.trim() || undefined,
        persona_type: form.persona_type || undefined,
        company_id: companyId,
      } as Parameters<typeof contactsApi.create>[0]);
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create contact");
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle: CSSProperties = {
    width: "100%", padding: "9px 12px", borderRadius: 10, fontSize: 13,
    border: `1px solid ${colors.border}`, outline: "none", fontFamily: "inherit",
  };

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.22)",
        backdropFilter: "blur(3px)", zIndex: 100,
      }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        zIndex: 101, width: 480, maxWidth: "90vw", background: "#fff",
        borderRadius: 18, boxShadow: "0 20px 60px rgba(15,23,42,0.18)",
        padding: "28px 28px 22px", display: "flex", flexDirection: "column", gap: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: colors.text, margin: 0 }}>Add Stakeholder</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: colors.faint, fontSize: 18 }}>x</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: colors.faint, marginBottom: 4, display: "block" }}>First Name *</label>
            <input style={fieldStyle} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} placeholder="Jane" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: colors.faint, marginBottom: 4, display: "block" }}>Last Name *</label>
            <input style={fieldStyle} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} placeholder="Smith" />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: colors.faint, marginBottom: 4, display: "block" }}>Job Title</label>
          <input style={fieldStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="VP of Engineering" />
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: colors.faint, marginBottom: 4, display: "block" }}>Buying Committee Role</label>
          <select style={{ ...fieldStyle, appearance: "auto" }} value={form.persona_type} onChange={(e) => setForm({ ...form, persona_type: e.target.value })}>
            <option value="">Select role...</option>
            <option value="champion">Champion</option>
            <option value="buyer">Economic Buyer</option>
            <option value="evaluator">Technical Evaluator</option>
            <option value="influencer">Influencer</option>
            <option value="implementation_owner">Implementation Owner</option>
            <option value="blocker">Blocker</option>
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: colors.faint, marginBottom: 4, display: "block" }}>Email</label>
            <input style={fieldStyle} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: colors.faint, marginBottom: 4, display: "block" }}>Phone</label>
            <input style={fieldStyle} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 0100" />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: colors.faint, marginBottom: 4, display: "block" }}>LinkedIn URL</label>
          <input style={fieldStyle} value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} placeholder="https://linkedin.com/in/janesmith" />
        </div>

        {error && <div style={{ color: colors.red, fontSize: 12, fontWeight: 600 }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
          <button onClick={onClose} style={{
            padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: "#f1f5f9", color: colors.sub, border: "none", cursor: "pointer",
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700,
            background: colors.primary, color: "#fff", border: "none", cursor: "pointer",
            opacity: saving ? 0.6 : 1,
          }}>
            {saving ? "Saving..." : "Add Stakeholder"}
          </button>
        </div>
      </div>
    </>
  );
}
