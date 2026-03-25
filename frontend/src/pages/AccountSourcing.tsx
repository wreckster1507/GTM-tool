import { CSSProperties, ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Flame,
  Loader2,
  Mail,
  Phone,
  Linkedin,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react";

import { accountSourcingApi } from "../lib/api";
import { formatDate, getAccountPrioritySnapshot } from "../lib/utils";
import AssignDropdown from "../components/AssignDropdown";
import type { Company, Contact, SourcingBatch } from "../types";

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
  padding: "32px 28px 40px",
};

const containerStyle: CSSProperties = {
  maxWidth: 1450,
  margin: "0 auto",
  display: "grid",
  gap: 18,
};

const cardStyle: CSSProperties = {
  background: colors.card,
  border: `1px solid ${colors.border}`,
  borderRadius: 16,
  boxShadow: "0 6px 20px rgba(17,34,68,0.05)",
};

function ts(date?: string) {
  if (!date) return "Never";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function canonicalPersona(persona?: string | null, personaType?: string | null): keyof typeof PERSONA_STYLE | "unknown" {
  const normalized = (personaType || persona || "").toLowerCase();
  if (normalized === "economic_buyer" || normalized === "buyer") return "buyer";
  if (normalized === "technical_evaluator" || normalized === "evaluator") return "evaluator";
  if (normalized === "champion") return "champion";
  if (normalized === "blocker") return "blocker";
  return "unknown";
}

function getIcpAnalysis(company: Company): Record<string, unknown> | undefined {
  const cache = company.enrichment_cache;
  if (!cache || typeof cache !== "object") return undefined;
  const entry = (cache as Record<string, unknown>).icp_analysis;
  if (!entry || typeof entry !== "object") return undefined;
  const data = (entry as Record<string, unknown>).data;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : (entry as Record<string, unknown>);
}

function getSalesPlay(company: Company): Record<string, unknown> | undefined {
  const profile = company.prospecting_profile;
  if (profile && typeof profile === "object") {
    const salesPlay = (profile as Record<string, unknown>).sales_play;
    if (salesPlay && typeof salesPlay === "object") return salesPlay as Record<string, unknown>;
  }
  const cache = company.enrichment_cache;
  if (!cache || typeof cache !== "object") return undefined;
  const icpEntry = (cache as Record<string, unknown>).icp_analysis;
  if (!icpEntry || typeof icpEntry !== "object") return undefined;
  const salesPlay = (icpEntry as Record<string, unknown>).sales_play;
  return salesPlay && typeof salesPlay === "object" ? (salesPlay as Record<string, unknown>) : undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .trim();
  return cleaned || undefined;
}

function toBriefItems(value: unknown, maxItems = 3): string[] {
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
  return normalized
    .slice(0, maxItems)
    .map((item) => clipText(item.replace(/\s+/g, " "), 180) || item.replace(/\s+/g, " "));
}

function clipText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "primary" | "warm" | "green";
}) {
  const toneStyle = {
    neutral: { bg: "#f8fbff", border: colors.border, accent: colors.sub },
    primary: { bg: "#eef5ff", border: "#cfe0fb", accent: colors.primary },
    warm: { bg: "#fff7eb", border: "#ffe0b2", accent: colors.amber },
    green: { bg: "#eefcf5", border: "#cdeedc", accent: colors.green },
  }[tone];

  return (
    <div
      style={{
        ...cardStyle,
        padding: "18px 18px 16px",
        background: toneStyle.bg,
        borderColor: toneStyle.border,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ color: toneStyle.accent }}>{icon}</div>
        <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>{label.toUpperCase()}</div>
      </div>
      <div style={{ marginTop: 14, color: colors.text, fontSize: 28, fontWeight: 800 }}>{value}</div>
      <div style={{ marginTop: 6, color: colors.sub, fontSize: 13, lineHeight: 1.5 }}>{hint}</div>
    </div>
  );
}

function UploadPanel({ onUploaded }: { onUploaded: (batch: SourcingBatch) => void }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const onFile = async (file: File) => {
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".xlsx")) {
      setError("Please upload a .csv or .xlsx file");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const batch = await accountSourcingApi.upload(file);
      onUploaded(batch);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      style={{
        ...cardStyle,
        borderStyle: "dashed",
        borderWidth: 2,
        borderColor: dragging ? "#8ab4ff" : colors.border,
        padding: "34px 28px",
        textAlign: "center",
        background: dragging ? "#f2f7ff" : colors.card,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      {uploading ? (
        <div style={{ display: "grid", gap: 10, placeItems: "center" }}>
          <Loader2 size={30} color={colors.primary} className="animate-spin" />
          <div style={{ color: colors.sub, fontSize: 14 }}>Uploading and parsing CSV...</div>
        </div>
      ) : (
        <>
          <div
            style={{
              width: 72,
              height: 72,
              margin: "0 auto 16px",
              borderRadius: 22,
              background: "linear-gradient(135deg, #4f46e5 0%, #2563eb 100%)",
              boxShadow: "0 16px 34px rgba(79, 70, 229, 0.26)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Upload size={32} color="#ffffff" />
          </div>
          <div style={{ fontWeight: 800, color: colors.text, fontSize: 32 }}>Import Target Accounts</div>
          <div style={{ color: colors.sub, marginTop: 10, lineHeight: 1.6, fontSize: 15, maxWidth: 760, marginInline: "auto" }}>
            Start with company names or a lightweight workbook, then let Beacon build presentable research briefs with fit, timing, proof points, risks, and outreach guidance.
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
            {["CSV/XLSX upload", "TAL verdicts", "Why now signals", "Outreach guidance"].map((item) => (
              <span
                key={item}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 999,
                  border: `1px solid ${colors.border}`,
                  background: "#ffffff",
                  color: colors.sub,
                  padding: "7px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <Sparkles size={12} color="#4f46e5" />
                {item}
              </span>
            ))}
          </div>
          <label
            style={{
              marginTop: 20,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#4f46e5",
              color: "#fff",
              padding: "10px 16px",
              borderRadius: 10,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <Upload size={14} /> Choose File
            <input
              type="file"
              accept=".csv,.xlsx"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
        </>
      )}
      {error ? (
        <div
          style={{
            marginTop: 12,
            color: colors.red,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <AlertCircle size={14} /> {error}
        </div>
      ) : null}
    </div>
  );
}

function ContactRow({ contact }: { contact: Contact }) {
  const [re, setRe] = useState(false);
  const persona = canonicalPersona(contact.persona, contact.persona_type);

  return (
    <tr>
      <td style={{ padding: "12px 14px", borderBottom: `1px solid ${colors.border}`, color: colors.text, verticalAlign: "top" }}>
        <Link to={`/account-sourcing/contacts/${contact.id}`} style={{ color: colors.text, textDecoration: "none", fontWeight: 700 }}>
          {contact.first_name} {contact.last_name}
        </Link>
      </td>
      <td style={{ padding: "12px 14px", borderBottom: `1px solid ${colors.border}`, color: colors.sub, verticalAlign: "top" }}>{contact.title || "-"}</td>
      <td style={{ padding: "12px 14px", borderBottom: `1px solid ${colors.border}`, verticalAlign: "top" }}>
        <div style={{ display: "inline-flex", gap: 10 }}>
          {contact.email ? <a href={`mailto:${contact.email}`}><Mail size={14} /></a> : null}
          {contact.linkedin_url ? <a href={contact.linkedin_url} target="_blank" rel="noreferrer"><Linkedin size={14} /></a> : null}
          {contact.phone ? <a href={`tel:${contact.phone}`}><Phone size={14} /></a> : null}
        </div>
        {(contact.outreach_lane || contact.sequence_status) ? (
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {contact.outreach_lane ? (
              <span style={{ background: "#eef5ff", color: colors.primary, borderRadius: 999, fontSize: 11, padding: "3px 8px", fontWeight: 700 }}>
                {contact.outreach_lane.replace(/_/g, " ")}
              </span>
            ) : null}
            {contact.sequence_status ? (
              <span style={{ background: "#f3eaff", color: colors.violet, borderRadius: 999, fontSize: 11, padding: "3px 8px", fontWeight: 700 }}>
                {contact.sequence_status.replace(/_/g, " ")}
              </span>
            ) : null}
          </div>
        ) : null}
      </td>
      <td style={{ padding: "12px 14px", borderBottom: `1px solid ${colors.border}`, verticalAlign: "top" }}>
        {persona !== "unknown" ? (
          <span style={{ ...PERSONA_STYLE[persona], borderRadius: 999, fontSize: 11, padding: "4px 9px", fontWeight: 700 }}>
            {PERSONA_LABEL[persona]}
          </span>
        ) : null}
      </td>
      <td style={{ padding: "12px 14px", borderBottom: `1px solid ${colors.border}`, color: colors.faint, fontSize: 12, verticalAlign: "top" }}>
        {ts(contact.enriched_at)}
      </td>
      <td style={{ padding: "12px 14px", borderBottom: `1px solid ${colors.border}`, verticalAlign: "top" }}>
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
            style={{ border: 0, background: "transparent", cursor: "pointer", color: colors.sub }}
            title="Re-enrich"
          >
            {re ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </td>
    </tr>
  );
}

function CompanyCard({ company, onRefresh }: { company: Company; onRefresh: () => void }) {
  const nav = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  const [re, setRe] = useState(false);
  const [push, setPush] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [workflow, setWorkflow] = useState({
    assigned_rep: company.assigned_rep || "",
    assigned_rep_name: company.assigned_rep_name || "",
    assigned_rep_email: company.assigned_rep_email || "",
    outreach_status: company.outreach_status || "",
    disposition: company.disposition || "",
    recommended_outreach_lane: company.recommended_outreach_lane || "",
    rep_feedback: company.rep_feedback || "",
  });

  const loadContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      const data = await accountSourcingApi.getContacts(company.id);
      setContacts(data);
    } finally {
      setLoadingContacts(false);
    }
  }, [company.id]);

  useEffect(() => {
    if (expanded && contacts.length === 0) {
      loadContacts();
    }
  }, [expanded, contacts.length, loadContacts]);

  useEffect(() => {
    setWorkflow({
      assigned_rep: company.assigned_rep || "",
      assigned_rep_name: company.assigned_rep_name || "",
      assigned_rep_email: company.assigned_rep_email || "",
      outreach_status: company.outreach_status || "",
      disposition: company.disposition || "",
      recommended_outreach_lane: company.recommended_outreach_lane || "",
      rep_feedback: company.rep_feedback || "",
    });
  }, [company.assigned_rep, company.assigned_rep_name, company.assigned_rep_email, company.outreach_status, company.disposition, company.recommended_outreach_lane, company.rep_feedback]);

  const tier = company.icp_tier || "cold";
  const signals = company.intent_signals as { hiring?: number; funding?: number; product?: number } | undefined;
  const priority = getAccountPrioritySnapshot(company);
  const icpAnalysis = getIcpAnalysis(company);
  const salesPlay = getSalesPlay(company);
  const cache = (company.enrichment_cache || {}) as Record<string, unknown>;
  const icpEntry = cache.icp_analysis as { data?: { _source?: string; icp_fit_score?: number; intent_score?: number; classification?: string; fit_type?: string } } | undefined;
  const isAiResearched = (icpEntry?.data?._source ?? (icpEntry as Record<string, unknown> | undefined)?._source) === "claude_icp_pipeline";
  const talVerdict = asText(salesPlay?.tal_verdict) || (typeof icpAnalysis?.classification === "string" ? icpAnalysis.classification : undefined);
  const fitType = asText(salesPlay?.fit_type) || (typeof icpAnalysis?.fit_type === "string" ? icpAnalysis.fit_type : undefined);
  const whyNow = asText(salesPlay?.why_now) || company.why_now || undefined;
  const nextMove = asText(salesPlay?.recommended_outreach_strategy) || company.recommended_outreach_lane?.replace(/_/g, " ") || undefined;
  const bestPersona = salesPlay?.best_persona && typeof salesPlay.best_persona === "object" ? salesPlay.best_persona as Record<string, unknown> : undefined;
  const bestPersonaTitle = asText(bestPersona?.title);
  const bestPersonaRelevance = asText(bestPersona?.relevance);
  const proofPoints = Array.isArray(salesPlay?.proof_points) ? (salesPlay.proof_points as unknown[]).map(String).filter(Boolean) : [];
  const riskFlags = Array.isArray(salesPlay?.risk_flags) ? (salesPlay.risk_flags as unknown[]).map(String).filter(Boolean) : [];
  const whyNowItems = toBriefItems(whyNow, 2);
  const nextMoveItems = toBriefItems(nextMove, 3);
  const evidenceLevel = typeof (company.intent_signals as Record<string, unknown> | undefined)?.research_evidence_level === "string"
    ? String((company.intent_signals as Record<string, unknown>).research_evidence_level)
    : undefined;
  const metadataItems = [
    company.domain.endsWith(".unknown") ? `Domain unresolved: ${company.domain}` : company.domain,
    asText(company.industry),
    company.employee_count ? `${company.employee_count.toLocaleString()} employees` : undefined,
    asText(company.funding_stage),
    typeof icpAnalysis?.category === "string" ? asText(icpAnalysis.category) : undefined,
  ].filter(Boolean) as string[];
  const summaryText = clipText(
    asText(company.description) ||
      whyNowItems[0] ||
      proofPoints[0] ||
      bestPersonaRelevance ||
      undefined,
    260,
  );
  const compactMoves = nextMoveItems.slice(0, 2);

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
        rep_feedback: workflow.rep_feedback.trim() || null,
      });
      onRefresh();
    } finally {
      setSavingWorkflow(false);
    }
  };

  return (
    <div style={{ ...cardStyle, overflow: "hidden" }}>
      <div
        style={{
          padding: "24px",
          display: "grid",
          gap: 18,
          background: expanded ? "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)" : "#ffffff",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.8fr) minmax(320px, 0.92fr)",
            gap: 20,
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", minWidth: 0 }}>
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{
                border: `1px solid ${colors.border}`,
                background: "#fff",
                color: colors.sub,
                width: 36,
                height: 36,
                borderRadius: 10,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
                marginTop: 6,
              }}
              aria-label={expanded ? "Collapse company card" : "Expand company card"}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>

            <div style={{ minWidth: 0, display: "grid", gap: 12, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
                <span
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    border: `1px solid ${colors.border}`,
                    background: "#f8fbff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Building2 size={18} color="#71839a" />
                </span>
                <div style={{ minWidth: 0, display: "grid", gap: 8, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <button
                      onClick={() => nav(`/account-sourcing/${company.id}`)}
                      style={{
                        border: 0,
                        background: "transparent",
                        padding: 0,
                        margin: 0,
                        color: colors.text,
                        fontWeight: 900,
                        fontSize: 24,
                        lineHeight: 1.2,
                        cursor: "pointer",
                        textAlign: "left",
                        minWidth: 0,
                      }}
                      title="Open company detail"
                    >
                      {company.name}
                    </button>
                    <button
                      onClick={() => nav(`/account-sourcing/${company.id}`)}
                      style={{
                        border: "1px solid #cfe0fb",
                        background: "#eef5ff",
                        color: colors.primary,
                        borderRadius: 12,
                        padding: "9px 12px",
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        flexShrink: 0,
                      }}
                    >
                      Open account <ExternalLink size={13} />
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ ...ICP_STYLE[tier], borderRadius: 999, fontSize: 12, fontWeight: 800, padding: "6px 10px" }}>
                      {tier.toUpperCase()} ({company.icp_score ?? 0})
                    </span>
                    {talVerdict ? <span style={{ background: "#eef6ff", color: "#24567e", borderRadius: 999, padding: "6px 10px", fontSize: 12, fontWeight: 800 }}>{talVerdict}</span> : null}
                    {fitType ? <span style={{ background: "#fff4df", color: colors.amber, borderRadius: 999, padding: "6px 10px", fontSize: 12, fontWeight: 800 }}>{fitType}</span> : null}
                    <span style={{ ...PRIORITY_STYLE[priority.priorityBand], borderRadius: 999, padding: "6px 10px", fontSize: 12, fontWeight: 800 }}>
                      Priority {priority.priorityBand} ({priority.priorityScore})
                    </span>
                    <span style={{ ...INTEREST_STYLE[priority.interestLevel], borderRadius: 999, padding: "6px 10px", fontSize: 12, fontWeight: 800 }}>
                      Interest {priority.interestLevel}
                    </span>
                    {isAiResearched ? (
                      <span style={{ background: "#f3eaff", color: "#7a2dd9", borderRadius: 999, fontSize: 11, fontWeight: 800, padding: "6px 10px" }}>
                        AI-RESEARCHED
                      </span>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {metadataItems.map((item) => (
                      <span
                        key={item}
                        style={{
                          borderRadius: 999,
                          padding: "8px 12px",
                          background: item.startsWith("Domain unresolved") ? "#fff4df" : "#f4f7fb",
                          border: `1px solid ${item.startsWith("Domain unresolved") ? "#ffe0b2" : colors.border}`,
                          color: item.startsWith("Domain unresolved") ? colors.amber : colors.sub,
                          fontSize: 12,
                          fontWeight: 700,
                          lineHeight: 1.3,
                        }}
                      >
                        {item}
                      </span>
                    ))}
                    {!company.domain.endsWith(".unknown") ? (
                      <a
                        href={`https://${company.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: colors.primary,
                          borderRadius: 999,
                          border: "1px solid #cfe0fb",
                          background: "#eef5ff",
                          padding: "8px 12px",
                          fontSize: 12,
                          fontWeight: 700,
                          textDecoration: "none",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        Visit site <ExternalLink size={12} />
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>

              {summaryText ? (
                <div
                  style={{
                    borderRadius: 16,
                    border: `1px solid ${colors.border}`,
                    background: "#fbfdff",
                    padding: "16px 18px",
                    color: colors.sub,
                    fontSize: 14,
                    lineHeight: 1.65,
                  }}
                >
                  {summaryText}
                </div>
              ) : null}
            </div>
          </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ borderRadius: 16, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
                <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>
                  ENRICHMENT STATUS
                  <div style={{ color: colors.text, fontSize: 15, fontWeight: 800, marginTop: 8 }}>Enriched</div>
                  <div style={{ color: colors.sub, fontSize: 13, marginTop: 4 }}>{ts(company.enriched_at)}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {signals?.hiring ? <span style={{ background: colors.greenSoft, color: colors.green, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 800 }}>Hiring</span> : null}
                  {signals?.funding ? <span style={{ background: colors.primarySoft, color: colors.primary, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 800 }}>Funding</span> : null}
                  {signals?.product ? <span style={{ background: colors.violetSoft, color: colors.violet, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 800 }}>Product</span> : null}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <div style={{ borderRadius: 16, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "16px 18px" }}>
                <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>BEST ENTRY PERSONA</div>
                <div style={{ marginTop: 10, color: colors.text, fontWeight: 900, fontSize: 19, lineHeight: 1.3 }}>
                  {bestPersonaTitle || "Need persona map"}
                </div>
                <div style={{ marginTop: 8, color: colors.sub, fontSize: 13, lineHeight: 1.6 }}>
                  {clipText(bestPersonaRelevance || "Lead with the operator closest to implementation pain.", 140)}
                </div>
              </div>

              <div style={{ borderRadius: 16, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "16px 18px" }}>
                <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>EVIDENCE QUALITY</div>
                <div style={{ marginTop: 10, color: colors.text, fontWeight: 900, fontSize: 19, lineHeight: 1.3 }}>
                  {evidenceLevel ? evidenceLevel.replace(/_/g, " ") : "Generated research"}
                </div>
                <div style={{ marginTop: 8, color: colors.sub, fontSize: 13, lineHeight: 1.6 }}>
                  {proofPoints.length} proof point{proofPoints.length === 1 ? "" : "s"} and {riskFlags.length} risk flag{riskFlags.length === 1 ? "" : "s"}
                </div>
              </div>
            </div>

            <div style={{ borderRadius: 16, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "16px 18px" }}>
              <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>ACTIONS</div>
              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <AssignDropdown
                entityType="company"
                entityId={company.id}
                currentAssignedId={company.assigned_to_id}
                currentAssignedName={company.assigned_to_name || company.assigned_rep_name || company.assigned_rep}
                onAssigned={() => onRefresh()}
                compact
              />
              <button
                onClick={async () => {
                  setRe(true);
                  try {
                    await accountSourcingApi.reEnrichCompany(company.id);
                  } finally {
                    setTimeout(() => {
                      setRe(false);
                      onRefresh();
                    }, 3500);
                  }
                }}
                style={{ border: `1px solid ${colors.border}`, background: "#fff", color: colors.text, borderRadius: 12, padding: "10px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                {re ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Re-enrich
              </button>
              <button
                onClick={async () => {
                  setPush(true);
                  try {
                    await accountSourcingApi.pushToInstantly(company.id, company.instantly_campaign_id || "default");
                  } finally {
                    setTimeout(() => setPush(false), 1800);
                  }
                }}
                style={{ border: "1px solid #cde5ff", background: "#eff7ff", color: "#1f5ecc", borderRadius: 12, padding: "10px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                {push ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Instantly
              </button>
            </div>
          </div>
        </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(320px, 0.9fr)", gap: 14, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 12 }}>
            {(whyNowItems.length > 0 || nextMoveItems.length > 0) ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                {whyNowItems.length > 0 ? (
                  <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#f8fbff", padding: "14px 16px" }}>
                    <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>WHY NOW</div>
                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      {whyNowItems.map((item, idx) => (
                        <div key={`why-${idx}`} style={{ color: colors.sub, fontSize: 13, lineHeight: 1.55 }}>
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {nextMoveItems.length > 0 ? (
                  <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#f8fbff", padding: "14px 16px" }}>
                    <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>NEXT MOVE</div>
                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      {nextMoveItems.map((item, idx) => (
                        <div key={`move-${idx}`} style={{ color: colors.sub, fontSize: 13, lineHeight: 1.55 }}>
                          {idx + 1}. {item}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "14px 16px" }}>
                <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>TAL VERDICT</div>
                <div style={{ marginTop: 8, color: colors.text, fontWeight: 900, fontSize: 24 }}>{talVerdict || "Researching"}</div>
                <div style={{ marginTop: 6, color: colors.sub, fontSize: 13 }}>{fitType || "Fit type pending"}</div>
              </div>
              <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "14px 16px" }}>
                <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>BEST ENTRY PERSONA</div>
                <div style={{ marginTop: 8, color: colors.text, fontWeight: 900, fontSize: 22 }}>{bestPersonaTitle || "Need persona map"}</div>
                <div style={{ marginTop: 6, color: colors.sub, fontSize: 13, lineHeight: 1.45 }}>{bestPersonaRelevance || "Lead with the operator closest to implementation pain."}</div>
              </div>
              {typeof icpAnalysis?.icp_fit_score === "number" ? (
                <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "14px 16px" }}>
                  <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>RESEARCHED ICP</div>
                  <div style={{ marginTop: 8, color: colors.text, fontWeight: 900, fontSize: 24 }}>{String(icpAnalysis.icp_fit_score)}/10</div>
                  <div style={{ marginTop: 6, color: colors.sub, fontSize: 13 }}>{evidenceLevel ? `${evidenceLevel} evidence` : "Generated from deep research"}</div>
                </div>
              ) : null}
              {typeof icpAnalysis?.intent_score === "number" ? (
                <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "14px 16px" }}>
                  <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>RESEARCHED INTENT</div>
                  <div style={{ marginTop: 8, color: colors.text, fontWeight: 900, fontSize: 24 }}>{String(icpAnalysis.intent_score)}/10</div>
                  <div style={{ marginTop: 6, color: colors.sub, fontSize: 13 }}>{proofPoints.length} proof points / {riskFlags.length} risk flags</div>
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "14px 16px" }}>
              <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>OPEN ACCOUNT</div>
              <div style={{ marginTop: 8 }}>
                <Link
                  to={`/account-sourcing/${company.id}`}
                  style={{
                    color: colors.primary,
                    fontWeight: 800,
                    fontSize: 15,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  Open full company detail <ExternalLink size={14} />
                </Link>
              </div>
            </div>
            <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "14px 16px" }}>
              <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>EVIDENCE SNAPSHOT</div>
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                {proofPoints.slice(0, 2).map((item, idx) => (
                  <div key={`proof-${idx}`} style={{ color: colors.sub, fontSize: 13, lineHeight: 1.5 }}>
                    <strong style={{ color: colors.green }}>Proof:</strong> {item}
                  </div>
                ))}
                {riskFlags.slice(0, 2).map((item, idx) => (
                  <div key={`risk-${idx}`} style={{ color: colors.sub, fontSize: 13, lineHeight: 1.5 }}>
                    <strong style={{ color: colors.red }}>Risk:</strong> {item}
                  </div>
                ))}
                {proofPoints.length === 0 && riskFlags.length === 0 ? (
                  <div style={{ color: colors.faint, fontSize: 13 }}>No clear proof points or risks captured yet.</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {expanded ? (
        <div style={{ borderTop: `1px solid ${colors.border}`, padding: "16px 20px 20px", background: "#fbfdff" }}>
          <div style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <div style={{ borderRadius: 12, border: `1px solid ${colors.border}`, background: "#ffffff", padding: "12px 14px" }}>
              <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.3 }}>PRIORITY</div>
              <div style={{ marginTop: 6, color: colors.text, fontWeight: 800, fontSize: 20 }}>{priority.priorityScore}</div>
              <div style={{ marginTop: 4, color: colors.sub, fontSize: 12 }}>{priority.priorityBand} priority account</div>
            </div>
            <div style={{ borderRadius: 12, border: `1px solid ${colors.border}`, background: "#ffffff", padding: "12px 14px" }}>
              <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.3 }}>RESEARCH QUALITY</div>
              <div style={{ marginTop: 6, color: colors.text, fontWeight: 800, fontSize: 20 }}>{evidenceLevel || "pending"}</div>
              <div style={{ marginTop: 4, color: colors.sub, fontSize: 12 }}>
                {proofPoints.length > 0 ? `${proofPoints.length} proof points captured.` : "Evidence is still being assembled."}
              </div>
            </div>
          </div>
          <div style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
            <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#ffffff", padding: "14px 16px" }}>
              <div style={{ color: colors.text, fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Research Brief</div>
              <div style={{ display: "grid", gap: 8 }}>
                {whyNow ? <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.55 }}><strong style={{ color: colors.text }}>Why now:</strong> {whyNow}</div> : null}
                {nextMove ? <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.55 }}><strong style={{ color: colors.text }}>How to engage:</strong> {nextMove}</div> : null}
                {bestPersonaTitle ? <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.55 }}><strong style={{ color: colors.text }}>Start with:</strong> {bestPersonaTitle}{bestPersonaRelevance ? ` — ${bestPersonaRelevance}` : ""}</div> : null}
                {!whyNow && !nextMove && !bestPersonaTitle ? <div style={{ color: colors.faint, fontSize: 13 }}>Research brief will appear after enrichment finishes.</div> : null}
              </div>
            </div>
            <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#ffffff", padding: "14px 16px" }}>
              <div style={{ color: colors.text, fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Evidence and Risks</div>
              <div style={{ display: "grid", gap: 8 }}>
                {proofPoints.slice(0, 2).map((item, idx) => (
                  <div key={`proof-${idx}`} style={{ color: colors.sub, fontSize: 13, lineHeight: 1.55 }}>
                    <strong style={{ color: colors.green }}>Proof:</strong> {item}
                  </div>
                ))}
                {riskFlags.slice(0, 2).map((item, idx) => (
                  <div key={`risk-${idx}`} style={{ color: colors.sub, fontSize: 13, lineHeight: 1.55 }}>
                    <strong style={{ color: colors.red }}>Risk:</strong> {item}
                  </div>
                ))}
                {proofPoints.length === 0 && riskFlags.length === 0 ? <div style={{ color: colors.faint, fontSize: 13 }}>No clear proof points or risks captured yet.</div> : null}
              </div>
            </div>
          </div>
          <div style={{ marginBottom: 16, borderRadius: 14, border: `1px solid ${colors.border}`, background: "#ffffff", padding: "14px 16px", display: "grid", gap: 10 }}>
            <div style={{ color: colors.text, fontSize: 13, fontWeight: 800 }}>Prospecting Workflow</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <input
                value={workflow.assigned_rep_name}
                onChange={(e) => setWorkflow((current) => ({ ...current, assigned_rep_name: e.target.value }))}
                placeholder="Assigned rep name"
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text }}
              />
              <input
                value={workflow.assigned_rep_email}
                onChange={(e) => setWorkflow((current) => ({ ...current, assigned_rep_email: e.target.value }))}
                placeholder="Assigned rep email"
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text }}
              />
              <input
                value={workflow.assigned_rep}
                onChange={(e) => setWorkflow((current) => ({ ...current, assigned_rep: e.target.value }))}
                placeholder="Legacy owner label"
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text }}
              />
              <select
                value={workflow.outreach_status}
                onChange={(e) => setWorkflow((current) => ({ ...current, outreach_status: e.target.value }))}
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text, background: "#fff" }}
              >
                {OUTREACH_STATUS_OPTIONS.map((option) => (
                  <option key={option.value || "blank"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={workflow.disposition}
                onChange={(e) => setWorkflow((current) => ({ ...current, disposition: e.target.value }))}
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text, background: "#fff" }}
              >
                {DISPOSITION_OPTIONS.map((option) => (
                  <option key={option.value || "blank"} value={option.value}>
                    {option.label}
                    </option>
                  ))}
                </select>
              <select
                value={workflow.recommended_outreach_lane}
                onChange={(e) => setWorkflow((current) => ({ ...current, recommended_outreach_lane: e.target.value }))}
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text, background: "#fff" }}
              >
                {OUTREACH_LANE_OPTIONS.map((option) => (
                  <option key={option.value || "blank"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={workflow.rep_feedback}
              onChange={(e) => setWorkflow((current) => ({ ...current, rep_feedback: e.target.value }))}
              placeholder="Rep feedback, objections, account thesis, or why this account should be deprioritized..."
              style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text, minHeight: 84, resize: "vertical" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ color: colors.faint, fontSize: 12 }}>
                {company.last_outreach_at ? `Last outreach logged ${formatDate(company.last_outreach_at)}` : "Save after outreach to keep interest and priority current."}
              </div>
              <button
                onClick={saveWorkflow}
                disabled={savingWorkflow}
                style={{ border: `1px solid ${colors.border}`, background: "#fff", color: colors.text, borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                {savingWorkflow ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Save workflow
              </button>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: colors.faint, letterSpacing: 0.3 }}>CONTACTS ({contacts.length})</div>
            <button onClick={loadContacts} style={{ border: 0, background: "transparent", color: colors.primary, fontWeight: 700, cursor: "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {loadingContacts ? (
            <div style={{ padding: 18, textAlign: "center" }}>
              <Loader2 className="animate-spin" size={20} color={colors.primary} />
            </div>
          ) : contacts.length === 0 ? (
            <div style={{ padding: 16, color: colors.faint, fontSize: 13, textAlign: "center" }}>
              No contacts discovered yet.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr style={{ background: "#f7f9fc" }}>
                    {[
                      "Name",
                      "Title",
                      "Channels",
                      "Persona",
                      "Enriched",
                      "Actions",
                    ].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: colors.faint, fontSize: 11, letterSpacing: 0.4, borderBottom: `1px solid ${colors.border}` }}>
                        {h.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <ContactRow key={c.id} contact={c} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function AccountSourcing() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [batches, setBatches] = useState<SourcingBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [dispositionFilter, setDispositionFilter] = useState("");
  const [laneFilter, setLaneFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportingContacts, setExportingContacts] = useState(false);
  const [resettingScope, setResettingScope] = useState<"" | "account-sourcing" | "workspace">("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, b] = await Promise.all([accountSourcingApi.listCompanies(), accountSourcingApi.listBatches()]);
      setCompanies(c);
      setBatches(b);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runReset = useCallback(async (scope: "account-sourcing" | "workspace") => {
    if (scope === "workspace") {
      const confirmation = window.prompt('Type RESET to clear workspace data (companies, contacts, deals, meetings, demos, sourcing).');
      if (confirmation !== "RESET") return;
    } else {
      const ok = window.confirm("Clear all Account Sourcing imports, sourced companies, related contacts, and batches?");
      if (!ok) return;
    }

    setResettingScope(scope);
    try {
      const result = await accountSourcingApi.resetData(scope);
      await load();
      window.alert(`${scope === "workspace" ? "Workspace" : "Account Sourcing"} cleared.\n${Object.entries(result.summary).map(([key, value]) => `${key}: ${value}`).join("\n")}`);
    } finally {
      setResettingScope("");
    }
  }, [load]);

  const q = search.trim().toLowerCase();
  const ownerOptions = Array.from(
    new Set(
      companies
        .map((company) => company.assigned_rep_email || company.assigned_rep_name || company.assigned_rep || "")
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
  const list = companies
    .filter((c) => {
      const priority = getAccountPrioritySnapshot(c);
      const matchesSearch = !q || (
        c.name.toLowerCase().includes(q)
        || c.domain.toLowerCase().includes(q)
        || (c.industry || "").toLowerCase().includes(q)
        || (c.assigned_rep || "").toLowerCase().includes(q)
        || (c.assigned_rep_email || "").toLowerCase().includes(q)
        || (c.disposition || "").toLowerCase().includes(q)
        || (c.recommended_outreach_lane || "").toLowerCase().includes(q)
      );
      const matchesTier = !tierFilter || (c.icp_tier || "") === tierFilter;
      const matchesPriority = !priorityFilter || priority.priorityBand === priorityFilter;
      const matchesDisposition = !dispositionFilter || (c.disposition || "") === dispositionFilter;
      const matchesLane = !laneFilter || (c.recommended_outreach_lane || "") === laneFilter;
      const ownerValue = c.assigned_rep_email || c.assigned_rep_name || c.assigned_rep || "";
      const matchesOwner = !ownerFilter || ownerValue === ownerFilter;

      return matchesSearch && matchesTier && matchesPriority && matchesDisposition && matchesLane && matchesOwner;
    })
    .slice()
    .sort((a, b) => getAccountPrioritySnapshot(b).priorityScore - getAccountPrioritySnapshot(a).priorityScore);
  const hotCount = companies.filter((c) => c.icp_tier === "hot").length;
  const warmCount = companies.filter((c) => c.icp_tier === "warm").length;
  const highPriorityCount = companies.filter((c) => getAccountPrioritySnapshot(c).priorityBand === "high").length;
  const engagedCount = companies.filter((c) => ["interested", "working"].includes((c.disposition || "").toLowerCase())).length;
  const unresolvedCount = companies.filter((c) => c.domain.endsWith(".unknown")).length;
  const unenrichedCount = companies.filter((c) => !c.enriched_at).length;
  const researchedCount = companies.filter((company) => Boolean(getIcpAnalysis(company))).length;
  const targetVerdictCount = companies.filter((company) => String(getIcpAnalysis(company)?.classification || "").toLowerCase() === "target").length;
  const watchVerdictCount = companies.filter((company) => String(getIcpAnalysis(company)?.classification || "").toLowerCase() === "watch").length;

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <div
          style={{
            ...cardStyle,
            padding: "26px 26px 22px",
            background: "radial-gradient(circle at top right, #eaf2ff 0%, transparent 28%), radial-gradient(circle at left center, #fff2ea 0%, transparent 24%), #ffffff",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 999, padding: "6px 12px", background: "#eef5ff", color: colors.primary, fontSize: 12, fontWeight: 800, letterSpacing: 0.4 }}>
                <Sparkles size={13} />
                GTM ENGINEERING
              </div>
              <h1 style={{ margin: "14px 0 0", color: colors.text, fontSize: 42, letterSpacing: 0.2 }}>Account Sourcing</h1>
              <p style={{ margin: "10px 0 0", color: colors.sub, fontSize: 17, lineHeight: 1.6, maxWidth: 780 }}>
                Start with company names and turn them into presentable account briefs with verdicts, timing, outreach angles, and the right people to contact first.
              </p>
            </div>
            <div style={{ display: "inline-flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => void runReset("account-sourcing")}
                disabled={Boolean(resettingScope)}
                style={{
                  border: "1px solid #f0c2c8",
                  background: "#fff6f7",
                  color: colors.red,
                  borderRadius: 12,
                  padding: "10px 14px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 700,
                  cursor: resettingScope ? "not-allowed" : "pointer",
                  opacity: resettingScope ? 0.7 : 1,
                }}
              >
                {resettingScope === "account-sourcing" ? <Loader2 size={15} className="animate-spin" /> : <AlertCircle size={15} />}
                Clear Account Sourcing
              </button>
              <button
                onClick={() => void runReset("workspace")}
                disabled={Boolean(resettingScope)}
                style={{
                  border: "1px solid #f5d4d8",
                  background: "#fffafb",
                  color: colors.red,
                  borderRadius: 12,
                  padding: "10px 14px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 700,
                  cursor: resettingScope ? "not-allowed" : "pointer",
                  opacity: resettingScope ? 0.7 : 1,
                }}
              >
                {resettingScope === "workspace" ? <Loader2 size={15} className="animate-spin" /> : <AlertCircle size={15} />}
                Clear Workspace
              </button>
              <button
                onClick={async () => {
                  setExportingContacts(true);
                  try {
                    const blob = await accountSourcingApi.exportContactsCsv();
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = `sourced-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  } finally {
                    setExportingContacts(false);
                  }
                }}
                style={{
                  border: `1px solid ${colors.border}`,
                  background: colors.card,
                  color: colors.text,
                  borderRadius: 12,
                  padding: "10px 14px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {exportingContacts ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                Export Contacts
              </button>
              <button
                onClick={async () => {
                  setExporting(true);
                  try {
                    const blob = await accountSourcingApi.exportCsv();
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = `sourced-companies-${new Date().toISOString().slice(0, 10)}.csv`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  } finally {
                    setExporting(false);
                  }
                }}
                style={{
                  border: `1px solid ${colors.border}`,
                  background: colors.card,
                  color: colors.text,
                  borderRadius: 12,
                  padding: "10px 14px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                Export CSV
              </button>
              <button
                onClick={load}
                style={{
                  border: `1px solid ${colors.border}`,
                  background: colors.card,
                  color: colors.text,
                  borderRadius: 12,
                  padding: "10px 14px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <RefreshCw size={15} /> Refresh
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <SummaryCard
            icon={<Building2 size={18} />}
            label="Sourced Accounts"
            value={String(companies.length)}
            hint="Total accounts currently available for enrichment and prospecting."
            tone="neutral"
          />
          <SummaryCard
            icon={<Flame size={18} />}
            label="Hot Accounts"
            value={String(hotCount)}
            hint="Accounts with the strongest ICP fit and highest near-term potential."
            tone="warm"
          />
          <SummaryCard
            icon={<TrendingUp size={18} />}
            label="Warm Accounts"
            value={String(warmCount)}
            hint="Good-fit accounts that still need stronger proof, timing, or persona clarity."
            tone="primary"
          />
          <SummaryCard
            icon={<Target size={18} />}
            label="High Priority"
            value={String(highPriorityCount)}
            hint="Accounts worth the fastest follow-up based on fit, intent, and sales feedback."
            tone="green"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <SummaryCard
            icon={<Users size={18} />}
            label="Engaged Accounts"
            value={String(engagedCount)}
            hint="Accounts where reps have logged active motion or positive interest."
            tone="primary"
          />
          <SummaryCard
            icon={<Target size={18} />}
            label="Research Complete"
            value={String(researchedCount)}
            hint="Accounts with a generated Beacon research brief already available."
            tone="green"
          />
          <SummaryCard
            icon={<Sparkles size={18} />}
            label="Target Verdicts"
            value={String(targetVerdictCount)}
            hint={`${watchVerdictCount} more accounts are currently in Watch.`}
            tone="warm"
          />
          <SummaryCard
            icon={<AlertCircle size={18} />}
            label="Needs Review"
            value={String(unresolvedCount + unenrichedCount)}
            hint={`${unresolvedCount} unresolved domains, ${unenrichedCount} accounts without completed enrichment.`}
            tone="warm"
          />
        </div>

        <UploadPanel onUploaded={() => { load(); }} />

        {/* Enrichment Progress — always visible when companies exist */}
        {companies.length > 0 && (() => {
          const enrichedCt = companies.filter((c) => c.enriched_at).length;
          const icpDoneCt = researchedCount;
          const totalCt = companies.length;
          const totalContacts = companies.reduce((sum, c) => sum + ((c.outreach_plan as Record<string, unknown>)?.contact_count as number || 0), 0);
          const allDone = enrichedCt === totalCt && icpDoneCt === totalCt;
          const pct = totalCt ? Math.round((icpDoneCt / totalCt) * 100) : 0;
          return (
            <div style={{
              ...cardStyle,
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
              background: allDone ? "#f0faf4" : "#fffbf0",
              border: `1px solid ${allDone ? "#c8e8d8" : "#ffe4b0"}`,
            }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  {allDone
                    ? <CheckCircle2 size={16} color={colors.green} />
                    : <Loader2 size={16} className="animate-spin" color={colors.amber} />
                  }
                  <span style={{ fontWeight: 700, fontSize: 13, color: allDone ? colors.green : colors.amber }}>
                    {allDone ? "All Research Complete" : "Research In Progress"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: colors.sub }}>
                  <span>Enriched: <b>{enrichedCt}/{totalCt}</b></span>
                  <span>ICP Analyzed: <b>{icpDoneCt}/{totalCt}</b></span>
                  <span>Contacts: <b>{totalContacts}</b></span>
                  <span>Pending: <b>{totalCt - icpDoneCt}</b></span>
                </div>
                <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: "#e5e7eb", overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    borderRadius: 3,
                    width: `${pct}%`,
                    background: allDone ? colors.green : colors.primary,
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>
              <button
                onClick={load}
                disabled={loading}
                style={{
                  border: `1px solid ${colors.border}`,
                  background: colors.card,
                  color: colors.text,
                  borderRadius: 10,
                  padding: "8px 14px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.7 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Check Status
              </button>
            </div>
          );
        })()}

        {batches.length > 0 ? (
          <div>
            <div style={{ color: colors.faint, fontWeight: 800, letterSpacing: 0.4, marginBottom: 8, fontSize: 13 }}>
              RECENT IMPORTS
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {batches.slice(0, 5).map((b) => (
                <div key={b.id} style={{ ...cardStyle, padding: "8px 12px", borderRadius: 12, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  {b.status === "completed" ? <CheckCircle2 size={13} color={colors.green} /> : <Loader2 size={13} className="animate-spin" color={colors.primary} />}
                  <span style={{ fontWeight: 700, color: colors.text }}>{b.filename}</span>
                  <span style={{ color: colors.faint }}>{b.created_companies} companies</span>
                  <span style={{ color: colors.faint }}>{ts(b.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div style={{ ...cardStyle, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ position: "relative", minWidth: 260 }}>
            <Search size={14} color={colors.faint} style={{ position: "absolute", left: 10, top: 11 }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies..."
              style={{
                width: "100%",
                border: `1px solid ${colors.border}`,
                borderRadius: 10,
                padding: "10px 12px 10px 30px",
                fontSize: 14,
                outline: "none",
              }}
            />
          </div>
          <div style={{ color: colors.sub, fontSize: 14, display: "flex", gap: 20, flexWrap: "wrap" }}>
            <span>{companies.length} companies sourced</span>
            <span>{hotCount} hot</span>
            <span>{warmCount} warm</span>
            <span>{highPriorityCount} high-priority</span>
            <span>{researchedCount} researched</span>
            <span>{targetVerdictCount} target verdicts</span>
          </div>
        </div>

        <div style={{ ...cardStyle, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text, background: "#fff", minWidth: 130 }}
            >
              <option value="">All ICP tiers</option>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="monitor">Monitor</option>
              <option value="cold">Cold</option>
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text, background: "#fff", minWidth: 140 }}
            >
              <option value="">All priorities</option>
              <option value="high">High priority</option>
              <option value="medium">Medium priority</option>
              <option value="low">Low priority</option>
            </select>
            <select
              value={dispositionFilter}
              onChange={(e) => setDispositionFilter(e.target.value)}
              style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text, background: "#fff", minWidth: 150 }}
            >
              <option value="">All dispositions</option>
              {DISPOSITION_OPTIONS.filter((option) => option.value).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              value={laneFilter}
              onChange={(e) => setLaneFilter(e.target.value)}
              style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text, background: "#fff", minWidth: 160 }}
            >
              <option value="">All lanes</option>
              {OUTREACH_LANE_OPTIONS.filter((option) => option.value).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: colors.text, background: "#fff", minWidth: 180 }}
            >
              <option value="">All owners</option>
              {ownerOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: colors.sub, fontSize: 13, fontWeight: 700 }}>{list.length} shown</span>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setTierFilter("");
                setPriorityFilter("");
                setDispositionFilter("");
                setLaneFilter("");
                setOwnerFilter("");
              }}
              style={{
                border: `1px solid ${colors.border}`,
                background: colors.card,
                color: colors.text,
                borderRadius: 10,
                padding: "10px 14px",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Reset filters
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ ...cardStyle, padding: 36, textAlign: "center" }}>
            <Loader2 className="animate-spin" color={colors.primary} />
          </div>
        ) : list.length === 0 ? (
          <div style={{ ...cardStyle, padding: 34, textAlign: "center", color: colors.faint }}>
            <Building2 size={30} style={{ marginBottom: 8 }} />
            {q ? "No companies match your search." : "No companies sourced yet."}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {list.map((c) => (
              <CompanyCard key={c.id} company={c} onRefresh={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
