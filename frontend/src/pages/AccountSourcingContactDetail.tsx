import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";

import { accountSourcingApi, companiesApi, contactsApi } from "../lib/api";
import { avatarColor, formatDate, getAccountPrioritySnapshot, getInitials } from "../lib/utils";
import type { Company, Contact } from "../types";

const colors = {
  bg: "#f4f7fb",
  card: "#ffffff",
  border: "#d9e1ec",
  text: "#1d2b3c",
  sub: "#55657a",
  faint: "#7f8fa5",
  primary: "#1f6feb",
  primarySoft: "#eef5ff",
  green: "#1f8f5f",
  greenSoft: "#e8f8f0",
  amber: "#b56d00",
  amberSoft: "#fff4df",
  violet: "#7a2dd9",
  violetSoft: "#f3eaff",
};

const pageStyle: CSSProperties = {
  background: "radial-gradient(circle at top right, rgba(31,111,235,0.12), transparent 28%), radial-gradient(circle at left center, rgba(181,109,0,0.10), transparent 22%), #f4f7fb",
  minHeight: "100%",
  padding: "30px 26px 40px",
};

const wrapStyle: CSSProperties = {
  maxWidth: 1420,
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

const heroCardStyle: CSSProperties = {
  ...cardStyle,
  padding: "24px 24px 22px",
  background: "linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(239,245,255,0.96) 58%, rgba(255,247,235,0.95) 100%)",
  borderColor: "#d7e3f3",
  boxShadow: "0 16px 40px rgba(31, 69, 120, 0.10)",
};

const OUTREACH_LANE_OPTIONS = [
  { value: "", label: "Auto / Unset" },
  { value: "warm_intro", label: "Warm Intro" },
  { value: "event_follow_up", label: "Event Follow-up" },
  { value: "cold_operator", label: "Cold Operator" },
  { value: "cold_strategic", label: "Cold Strategic" },
];

const SEQUENCE_STATUS_OPTIONS = [
  { value: "", label: "Unset" },
  { value: "research_needed", label: "Research Needed" },
  { value: "ready", label: "Ready" },
  { value: "queued_instantly", label: "Queued in Instantly" },
  { value: "sent", label: "Sent" },
  { value: "replied", label: "Replied" },
  { value: "meeting_booked", label: "Meeting Booked" },
  { value: "closed", label: "Closed" },
];

const INSTANTLY_STATUS_OPTIONS = [
  { value: "", label: "Unset" },
  { value: "missing_email", label: "Missing Email" },
  { value: "ready", label: "Ready" },
  { value: "pushed", label: "Pushed" },
  { value: "paused", label: "Paused" },
];

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function prettify(value?: string | null) {
  if (!value) return "Not set";
  return value.replace(/_/g, " ");
}

function toneForLane(value?: string | null): "primary" | "warm" | "violet" | "green" {
  if (value === "warm_intro") return "warm";
  if (value === "event_follow_up") return "violet";
  if (value === "cold_strategic") return "green";
  return "primary";
}

function toneForStatus(value?: string | null): "primary" | "warm" | "violet" | "green" {
  if (value === "meeting_booked" || value === "replied" || value === "pushed") return "green";
  if (value === "research_needed" || value === "missing_email") return "warm";
  if (value === "queued_instantly" || value === "sent") return "violet";
  return "primary";
}

function sequencePlan(contact?: Contact | null): Record<string, unknown> {
  const data = contact?.enrichment_data;
  if (!data || typeof data !== "object") return {};
  const plan = (data as Record<string, unknown>).sequence_plan;
  return plan && typeof plan === "object" ? (plan as Record<string, unknown>) : {};
}

function uploadedRow(contact?: Contact | null): Record<string, unknown> {
  const data = contact?.enrichment_data;
  if (!data || typeof data !== "object") return {};
  const row = (data as Record<string, unknown>).raw_row;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

function companyUploadedRow(company?: Company | null): Record<string, unknown> {
  const block = company?.enrichment_sources?.import;
  if (!block || typeof block !== "object") return {};
  const row = (block as Record<string, unknown>).raw_row;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

function importedAnalyst(company?: Company | null): Record<string, unknown> {
  const block = company?.enrichment_sources?.import;
  if (!block || typeof block !== "object") return {};
  const analyst = (block as Record<string, unknown>).analyst;
  return analyst && typeof analyst === "object" ? (analyst as Record<string, unknown>) : {};
}

function MetricCard({ label, value, hint, tone = "primary" }: {
  label: string;
  value: string;
  hint: string;
  tone?: "primary" | "green" | "warm" | "violet";
}) {
  const toneStyle = {
    primary: { bg: colors.primarySoft, border: "#cfe0fb", accent: colors.primary },
    green: { bg: colors.greenSoft, border: "#cdeedc", accent: colors.green },
    warm: { bg: colors.amberSoft, border: "#ffe0b2", accent: colors.amber },
    violet: { bg: colors.violetSoft, border: "#e2d2fb", accent: colors.violet },
  }[tone];

  return (
    <div style={{ border: `1px solid ${toneStyle.border}`, background: `linear-gradient(180deg, ${toneStyle.bg} 0%, #ffffff 100%)`, borderRadius: 16, padding: "14px 16px", boxShadow: "0 10px 24px rgba(17,34,68,0.04)" }}>
      <div style={{ color: colors.faint, fontWeight: 800, fontSize: 11, letterSpacing: 0.45 }}>{label.toUpperCase()}</div>
      <div style={{ marginTop: 8, color: toneStyle.accent, fontWeight: 800, fontSize: 24 }}>{value}</div>
      <div style={{ marginTop: 6, color: colors.sub, fontSize: 13, lineHeight: 1.45 }}>{hint}</div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div style={{ ...cardStyle, padding: "18px 20px", background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: colors.text, fontWeight: 800, marginBottom: 14 }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, display: "grid", placeItems: "center", background: colors.primarySoft, color: colors.primary }}>
          {icon}
        </span>
        <span>{title}</span>
      </div>
      <div style={{ display: "grid", gap: 10 }}>{children}</div>
    </div>
  );
}

function Chip({
  label,
  tone = "primary",
}: {
  label: string;
  tone?: "primary" | "warm" | "violet" | "green" | "neutral";
}) {
  const style = {
    primary: { bg: colors.primarySoft, color: colors.primary, border: "#d5e5ff" },
    warm: { bg: colors.amberSoft, color: colors.amber, border: "#ffe3b3" },
    violet: { bg: colors.violetSoft, color: colors.violet, border: "#eadbff" },
    green: { bg: colors.greenSoft, color: colors.green, border: "#caecd8" },
    neutral: { bg: "#f5f8fc", color: colors.sub, border: colors.border },
  }[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "6px 10px",
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: 0.15,
      }}
    >
      {label}
    </span>
  );
}

function KV({ label, value }: { label: string; value?: ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px minmax(0,1fr)", gap: 10, alignItems: "start" }}>
      <div style={{ color: colors.faint, fontWeight: 700, fontSize: 12, letterSpacing: 0.3 }}>{label.toUpperCase()}</div>
      <div style={{ color: colors.sub, lineHeight: 1.6 }}>{value}</div>
    </div>
  );
}

function ListCard({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, background: "linear-gradient(180deg, #fbfdff 0%, #ffffff 100%)", borderRadius: 16, padding: "14px 16px" }}>
      <div style={{ color: colors.text, fontWeight: 800, fontSize: 13, marginBottom: 10 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ color: colors.faint, fontSize: 13 }}>{empty}</div>
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

function SequenceStepCard({
  index,
  step,
}: {
  index: number;
  step: Record<string, unknown>;
}) {
  const channel = String(step.channel || "email");
  const channelTone = channel.includes("connector")
    ? { bg: colors.amberSoft, border: "#ffe3b3", text: colors.amber }
    : channel === "email"
      ? { bg: colors.primarySoft, border: "#d5e5ff", text: colors.primary }
      : { bg: colors.violetSoft, border: "#eadbff", text: colors.violet };

  return (
    <div style={{ border: `1px solid ${channelTone.border}`, background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)", borderRadius: 16, padding: "16px 16px 14px", boxShadow: "0 8px 22px rgba(17,34,68,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ width: 28, height: 28, borderRadius: 10, background: channelTone.bg, color: channelTone.text, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 900 }}>
            {index + 1}
          </span>
          <div style={{ color: colors.text, fontWeight: 800 }}>
            Day {String(step.day_offset ?? 0)} · {channel.replace(/_/g, " ")}
          </div>
        </div>
        <Chip label={`Step ${index + 1}`} tone={channel.includes("connector") ? "warm" : "primary"} />
      </div>
      <div style={{ marginTop: 10, color: colors.sub, lineHeight: 1.65, fontSize: 13.5 }}>
        <strong style={{ color: colors.text }}>Objective:</strong> {String(step.objective || "No objective")}
      </div>
      {step.angle ? (
        <div style={{ marginTop: 6, color: colors.sub, lineHeight: 1.65, fontSize: 13.5 }}>
          <strong style={{ color: colors.text }}>Angle:</strong> {String(step.angle)}
        </div>
      ) : null}
      {step.cta ? (
        <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 12, background: channelTone.bg, color: colors.text, fontSize: 13.5, lineHeight: 1.55 }}>
          <strong>CTA:</strong> {String(step.cta)}
        </div>
      ) : null}
    </div>
  );
}

export default function AccountSourcingContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [contact, setContact] = useState<Contact | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reEnriching, setReEnriching] = useState(false);
  const [workflow, setWorkflow] = useState({
    assigned_rep_email: "",
    outreach_lane: "",
    sequence_status: "",
    instantly_status: "",
    instantly_campaign_id: "",
    conversation_starter: "",
    personalization_notes: "",
    talking_points: "",
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      let loadedContact: Contact;
      try {
        loadedContact = await accountSourcingApi.getContact(id);
      } catch {
        loadedContact = await contactsApi.get(id);
      }

      setContact(loadedContact);

      if (loadedContact.company_id) {
        try {
          const loadedCompany = await accountSourcingApi.getCompany(loadedContact.company_id);
          setCompany(loadedCompany);
        } catch {
          const loadedCompany = await companiesApi.get(loadedContact.company_id);
          setCompany(loadedCompany);
        }
      } else {
        setCompany(null);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setWorkflow({
      assigned_rep_email: contact?.assigned_rep_email || "",
      outreach_lane: contact?.outreach_lane || "",
      sequence_status: contact?.sequence_status || "",
      instantly_status: contact?.instantly_status || "",
      instantly_campaign_id: contact?.instantly_campaign_id || "",
      conversation_starter: contact?.conversation_starter || "",
      personalization_notes: contact?.personalization_notes || "",
      talking_points: Array.isArray(contact?.talking_points) ? contact!.talking_points.join("\n") : "",
    });
  }, [
    contact?.assigned_rep_email,
    contact?.outreach_lane,
    contact?.sequence_status,
    contact?.instantly_status,
    contact?.instantly_campaign_id,
    contact?.conversation_starter,
    contact?.personalization_notes,
    contact?.talking_points,
  ]);

  const plan = useMemo(() => sequencePlan(contact), [contact]);
  const rawRow = useMemo(() => uploadedRow(contact), [contact]);
  const fallbackRawRow = useMemo(() => companyUploadedRow(company), [company]);
  const analyst = useMemo(() => importedAnalyst(company), [company]);
  const priority = company ? getAccountPrioritySnapshot(company) : null;
  const companyProfile = company?.prospecting_profile && typeof company.prospecting_profile === "object"
    ? (company.prospecting_profile as Record<string, unknown>)
    : {};
  const warmPath = contact?.warm_intro_path && typeof contact.warm_intro_path === "object"
    ? (contact.warm_intro_path as Record<string, unknown>)
    : {};
  const companyWarmPaths = Array.isArray(companyProfile.warm_paths)
    ? (companyProfile.warm_paths as Array<Record<string, unknown>>)
    : [];
  const displayWarmPath = Object.keys(warmPath).length > 0 ? warmPath : (companyWarmPaths[0] || {});
  const displayRawRow = Object.keys(rawRow).length > 0 ? rawRow : fallbackRawRow;
  const planSteps = Array.isArray(plan.steps) ? (plan.steps as Array<Record<string, unknown>>) : [];
  const planHooks = asList(plan.personalization_hooks);
  const companyPlan = company?.outreach_plan && typeof company.outreach_plan === "object"
    ? (company.outreach_plan as Record<string, unknown>)
    : {};
  const companyCache = company?.enrichment_cache && typeof company.enrichment_cache === "object"
    ? (company.enrichment_cache as Record<string, unknown>)
    : {};
  const aiEntry = companyCache.ai_summary && typeof companyCache.ai_summary === "object"
    ? ((companyCache.ai_summary as Record<string, unknown>).data ?? companyCache.ai_summary)
    : {};
  const aiSummary = aiEntry && typeof aiEntry === "object" ? (aiEntry as Record<string, unknown>) : {};

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ ...wrapStyle, ...cardStyle, padding: 28, textAlign: "center" }}>
          <Loader2 className="animate-spin" color={colors.primary} />
        </div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div style={pageStyle}>
        <div style={{ ...wrapStyle, ...cardStyle, padding: 28, textAlign: "center", color: colors.faint }}>
          Prospect not found.
        </div>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      await accountSourcingApi.updateContact(contact.id, {
        assigned_rep_email: workflow.assigned_rep_email.trim() || null,
        outreach_lane: workflow.outreach_lane || null,
        sequence_status: workflow.sequence_status || null,
        instantly_status: workflow.instantly_status || null,
        instantly_campaign_id: workflow.instantly_campaign_id.trim() || null,
        conversation_starter: workflow.conversation_starter.trim() || null,
        personalization_notes: workflow.personalization_notes.trim() || null,
        talking_points: workflow.talking_points
          .split(/\n+/)
          .map((item) => item.trim())
          .filter(Boolean),
      });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const fullName = `${contact.first_name} ${contact.last_name}`.trim();

  return (
    <div style={pageStyle}>
      <div style={wrapStyle}>
        <div style={heroCardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", padding: 0, color: colors.primary, display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, cursor: "pointer", fontSize: "inherit" }}>
                  <ArrowLeft size={15} /> Back
                </button>
                {company ? (
                  <Link to={`/account-sourcing/${company.id}`} style={{ color: colors.sub, textDecoration: "none", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Building2 size={13} /> {company.name}
                  </Link>
                ) : null}
              </div>

              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-[22px] text-[22px] font-extrabold ${avatarColor(fullName || "Prospect")}`}>
                  {getInitials(fullName || "Prospect")}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h1 style={{ margin: 0, color: colors.text, fontSize: 38, letterSpacing: 0.2, lineHeight: 1.05 }}>{fullName || "Unnamed prospect"}</h1>
                  <div style={{ marginTop: 10, color: colors.sub, fontSize: 17, lineHeight: 1.6, maxWidth: 840 }}>
                    {contact.title || "No title yet"} {company ? `at ${company.name}` : ""}. This view combines uploaded prospecting context, company research, and the saved prospect-level outreach sequence.
                  </div>
                  <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Chip label={prettify(contact.outreach_lane || company?.recommended_outreach_lane)} tone={toneForLane(contact.outreach_lane || company?.recommended_outreach_lane)} />
                    <Chip label={prettify(contact.sequence_status)} tone={toneForStatus(contact.sequence_status)} />
                    <Chip label={contact.email ? "Email ready" : "Missing email"} tone={contact.email ? "green" : "warm"} />
                    <Chip label={contact.warm_intro_strength ? `Warm path ${contact.warm_intro_strength}/5` : Object.keys(displayWarmPath).length > 0 ? "Account warm path" : "Direct motion"} tone={Object.keys(displayWarmPath).length > 0 ? "warm" : "neutral"} />
                  </div>
                  <div style={{ marginTop: 16, display: "flex", gap: 14, flexWrap: "wrap", color: colors.sub, fontSize: 13.5 }}>
                    {company ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Building2 size={14} />{company.name}</span> : null}
                    {contact.email ? <a href={`mailto:${contact.email}`} style={{ color: colors.sub, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}><Mail size={14} />{contact.email}</a> : null}
                    {contact.phone ? <a href={`tel:${contact.phone}`} style={{ color: colors.sub, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}><Phone size={14} />{contact.phone}</a> : null}
                    {contact.linkedin_url ? <a href={contact.linkedin_url} target="_blank" rel="noreferrer" style={{ color: colors.sub, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}><Globe size={14} />LinkedIn</a> : null}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "inline-flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={async () => {
                setReEnriching(true);
                try {
                  await accountSourcingApi.reEnrichContact(contact.id);
                } finally {
                  setTimeout(() => setReEnriching(false), 2500);
                }
              }}
              style={{ border: `1px solid ${colors.border}`, background: "#fff", color: colors.text, borderRadius: 12, padding: "10px 14px", display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, cursor: "pointer" }}
            >
              {reEnriching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Re-enrich
            </button>
            <button
              onClick={save}
              disabled={saving}
              style={{ border: `1px solid ${colors.border}`, background: colors.primary, color: "#fff", borderRadius: 12, padding: "10px 14px", display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, cursor: "pointer" }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Save prospect workflow
            </button>
          </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <MetricCard
            label="Outreach Lane"
            value={prettify(contact.outreach_lane || company?.recommended_outreach_lane)}
            hint="The lane drives the sequence family and how warm or direct the motion should be."
            tone={toneForLane(contact.outreach_lane || company?.recommended_outreach_lane)}
          />
          <MetricCard
            label="Sequence"
            value={prettify(contact.sequence_status)}
            hint={asText(plan.sequence_family) || "Prospect-level sequence plan is stored with this contact."}
            tone={toneForStatus(contact.sequence_status)}
          />
          <MetricCard
            label="Warm Path"
            value={contact.warm_intro_strength ? `Strength ${contact.warm_intro_strength}` : Object.keys(displayWarmPath).length > 0 ? "Account path" : "Direct"}
            hint={asText(displayWarmPath.connection_path) || "No warm path saved, so this prospect is likely a direct lane."}
            tone="warm"
          />
          <MetricCard
            label="Account Priority"
            value={priority ? `${priority.priorityBand} / ${priority.priorityScore}` : "Unknown"}
            hint={priority ? `Interest ${priority.interestLevel}; committee ${priority.committeeScore}; leverage ${priority.outreachLeverage}.` : "Account priority becomes available once the parent company is loaded."}
            tone="green"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.55fr) minmax(320px, 1fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 14 }}>
            <Section title="Prospect Workflow" icon={<UserRound size={15} color={colors.primary} />}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <input
                  value={workflow.assigned_rep_email}
                  onChange={(e) => setWorkflow((current) => ({ ...current, assigned_rep_email: e.target.value }))}
                  placeholder="Assigned rep email"
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text }}
                />
                <select
                  value={workflow.outreach_lane}
                  onChange={(e) => setWorkflow((current) => ({ ...current, outreach_lane: e.target.value }))}
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text, background: "#fff" }}
                >
                  {OUTREACH_LANE_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select
                  value={workflow.sequence_status}
                  onChange={(e) => setWorkflow((current) => ({ ...current, sequence_status: e.target.value }))}
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text, background: "#fff" }}
                >
                  {SEQUENCE_STATUS_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select
                  value={workflow.instantly_status}
                  onChange={(e) => setWorkflow((current) => ({ ...current, instantly_status: e.target.value }))}
                  style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text, background: "#fff" }}
                >
                  {INSTANTLY_STATUS_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <input
                value={workflow.instantly_campaign_id}
                onChange={(e) => setWorkflow((current) => ({ ...current, instantly_campaign_id: e.target.value }))}
                placeholder="Instantly campaign ID"
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 13, color: colors.text }}
              />
              <textarea
                value={workflow.conversation_starter}
                onChange={(e) => setWorkflow((current) => ({ ...current, conversation_starter: e.target.value }))}
                placeholder="Conversation starter"
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "12px 14px", fontSize: 13, color: colors.text, minHeight: 76, resize: "vertical" }}
              />
              <textarea
                value={workflow.personalization_notes}
                onChange={(e) => setWorkflow((current) => ({ ...current, personalization_notes: e.target.value }))}
                placeholder="Personalization notes and why-now context"
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "12px 14px", fontSize: 13, color: colors.text, minHeight: 88, resize: "vertical" }}
              />
              <textarea
                value={workflow.talking_points}
                onChange={(e) => setWorkflow((current) => ({ ...current, talking_points: e.target.value }))}
                placeholder="Talking points, one per line"
                style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "12px 14px", fontSize: 13, color: colors.text, minHeight: 96, resize: "vertical" }}
              />
            </Section>

            <Section title="Sales Playbook" icon={<Send size={15} color={colors.primary} />}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                <ListCard title="Hooks To Use" items={planHooks} empty="No personalization hooks saved yet." />
                <ListCard
                  title="Conversation Starter"
                  items={asText(contact.conversation_starter) ? [contact.conversation_starter as string] : asText(companyProfile.conversation_starter) ? [String(companyProfile.conversation_starter)] : []}
                  empty="No conversation starter available."
                />
                <ListCard
                  title="Talking Points"
                  items={Array.isArray(contact.talking_points) ? contact.talking_points.map((item) => String(item)) : asList(aiSummary.talking_points)}
                  empty="No talking points available."
                />
                <ListCard
                  title="Pain Points"
                  items={asList(aiSummary.pain_points)}
                  empty="No AI pain points available yet."
                />
                <ListCard
                  title="Prospecting Priorities"
                  items={Array.isArray(companyProfile.priorities) ? companyProfile.priorities.map((item) => String(item)) : []}
                  empty="No priorities available yet."
                />
              </div>
              {planSteps.length === 0 ? (
                <div style={{ color: colors.faint }}>No prospect sequence plan has been generated yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {planSteps.map((step, idx) => (
                    <SequenceStepCard key={`step-${idx}`} index={idx} step={step} />
                  ))}
                </div>
              )}
            </Section>

            <Section title="Uploaded Prospect Intelligence" icon={<Sparkles size={15} color={colors.primary} />}>
              {Object.keys(displayRawRow).length === 0 ? (
                <div style={{ color: colors.faint }}>No uploaded raw row was captured for this prospect.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {Object.entries(displayRawRow).map(([key, value]) => (
                    <div key={key} style={{ display: "grid", gridTemplateColumns: "220px minmax(0,1fr)", gap: 10, borderRadius: 14, border: `1px solid ${colors.border}`, background: "linear-gradient(180deg, #fbfdff 0%, #ffffff 100%)", padding: "11px 13px" }}>
                      <div style={{ color: colors.faint, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.35 }}>{key}</div>
                      <div style={{ color: colors.sub, fontSize: 13.5, lineHeight: 1.55 }}>{String(value)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>

          <div style={{ display: "grid", gap: 14 }}>
            <Section title="Prospect Snapshot" icon={<UserRound size={15} color={colors.primary} />}>
              <KV label="Name" value={fullName} />
              <KV label="Title" value={contact.title} />
              <KV label="Email" value={contact.email ? <a href={`mailto:${contact.email}`} style={{ color: colors.primary }}>{contact.email}</a> : undefined} />
              <KV label="Phone" value={contact.phone ? <a href={`tel:${contact.phone}`} style={{ color: colors.primary }}>{contact.phone}</a> : undefined} />
              <KV label="LinkedIn" value={contact.linkedin_url ? <a href={contact.linkedin_url} target="_blank" rel="noreferrer" style={{ color: colors.primary, display: "inline-flex", alignItems: "center", gap: 6 }}>Profile <ExternalLink size={12} /></a> : undefined} />
              <KV label="Assigned Rep" value={contact.assigned_rep_email || company?.assigned_rep_email} />
              <KV label="Persona" value={contact.persona_type || contact.persona} />
              <KV label="Enriched" value={formatDate(contact.enriched_at)} />
              <KV label="Updated" value={formatDate(contact.updated_at)} />
              <div style={{ marginTop: 8, display: "flex", gap: 10 }}>
                {contact.email ? <a href={`mailto:${contact.email}`} style={{ color: colors.primary }}><Mail size={15} /></a> : null}
                {contact.phone ? <a href={`tel:${contact.phone}`} style={{ color: colors.primary }}><Phone size={15} /></a> : null}
                {contact.linkedin_url ? <a href={contact.linkedin_url} target="_blank" rel="noreferrer" style={{ color: colors.primary }}><Globe size={15} /></a> : null}
              </div>
            </Section>

            <Section title="Warm Intro Path" icon={<Users size={15} color={colors.primary} />}>
              <KV label="Strength" value={contact.warm_intro_strength ? `Strength ${contact.warm_intro_strength}` : Object.keys(displayWarmPath).length > 0 ? "Inherited from account" : undefined} />
              <KV label="Connector" value={asText(displayWarmPath.name)} />
              <KV label="Path" value={asText(displayWarmPath.connection_path)} />
              <KV label="Why It Works" value={asText(displayWarmPath.why_it_works)} />
              {companyWarmPaths.length > 1 ? (
                <ListCard
                  title="Additional Paths"
                  items={companyWarmPaths.slice(1).map((item) => `${String(item.name || "Connector")}: ${String(item.connection_path || item.why_it_works || "")}`.trim())}
                  empty="No additional paths."
                />
              ) : null}
            </Section>

            <Section title="Company Context" icon={<Building2 size={15} color={colors.primary} />}>
              {company ? (
                <>
                  <KV label="Company" value={<Link to={`/account-sourcing/${company.id}`} style={{ color: colors.primary, textDecoration: "none" }}>{company.name}</Link>} />
                  <KV label="Domain" value={company.domain} />
                  <KV label="Account Thesis" value={company.account_thesis} />
                  <KV label="Why Now" value={company.why_now} />
                  <KV label="Beacon Angle" value={company.beacon_angle} />
                  <KV label="Recommended Strategy" value={asText(companyProfile.recommended_outreach_strategy)} />
                  <KV label="Next Best Action" value={asText(companyPlan.next_best_action)} />
                  <KV label="Uploaded Fit Type" value={asText(analyst.fit_type)} />
                </>
              ) : (
                <div style={{ color: colors.faint }}>This prospect is not attached to a sourced company.</div>
              )}
            </Section>

          </div>
        </div>
      </div>
    </div>
  );
}
