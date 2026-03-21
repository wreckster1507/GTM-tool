import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

import { accountSourcingApi } from "../lib/api";
import type { Company, Contact } from "../types";
import { formatDate } from "../lib/utils";

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
  return typeof e?.fetched_at === "string" ? e.fetched_at : undefined;
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
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function ParagraphBlock({ text, tone = "default" }: { text?: string; tone?: "default" | "soft" }) {
  if (!text) return <div style={{ color: colors.faint }}>No insight available yet.</div>;

  const bg = tone === "soft" ? "#f8fbff" : "#ffffff";
  const border = tone === "soft" ? colors.border : "#e6edf5";

  return (
    <div style={{ border: `1px solid ${border}`, background: bg, borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ display: "grid", gap: 10 }}>
        {text
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line, idx) => (
            <p key={idx} style={{ margin: 0, color: colors.sub, lineHeight: 1.75, fontSize: 14.5 }}>
              {line}
            </p>
          ))}
      </div>
    </div>
  );
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

function ContactItem({ contact }: { contact: Contact }) {
  const [re, setRe] = useState(false);

  const persona = canonicalPersona(contact.persona, contact.persona_type);

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 14px", background: "#fbfdff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: colors.text, fontWeight: 800, fontSize: 15 }}>
            {contact.first_name} {contact.last_name}
          </div>
          <div style={{ color: colors.sub, marginTop: 3 }}>{contact.title || "No title"}</div>
          <div style={{ color: colors.faint, marginTop: 4, fontSize: 13 }}>
            {contact.email || "No email"}
          </div>
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
            {contact.phone ? <a href={`tel:${contact.phone}`}><Phone size={14} /></a> : null}
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
  const [push, setPush] = useState(false);

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

  useEffect(() => {
    load();
  }, [load]);

  const cache = useMemo(() => (company?.enrichment_cache || {}) as Record<string, unknown>, [company]);
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
  const recommendedApproach = asText(ai?.recommended_approach);
  const painPoints = asList(ai?.pain_points);
  const talkingPoints = asList(ai?.talking_points);
  const competitors = asList(ai?.competitive_landscape);
  const techSignals = asList(ai?.tech_stack_signals);
  const websiteText = asText(web?.text);

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
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", color: colors.sub, fontSize: 14 }}>
                <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" style={{ color: colors.primary, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Globe size={13} /> {company.domain} <ExternalLink size={11} />
                </a>
                {company.industry ? <span>{company.industry}</span> : null}
                {company.funding_stage ? <span>{company.funding_stage}</span> : null}
                {company.employee_count ? <span>{company.employee_count.toLocaleString()} employees</span> : null}
              </div>

              <p style={{ marginTop: 14, marginBottom: 0, color: colors.sub, lineHeight: 1.75, fontSize: 15, maxWidth: 920 }}>
                {companySummary || "This account is in sourcing. Use the sections below to quickly decide fit, identify missing stakeholders, and shape the next prospecting move."}
              </p>
            </div>

            <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
              <button
                onClick={async () => {
                  setRe(true);
                  try {
                    await accountSourcingApi.reEnrichCompany(company.id);
                  } finally {
                    setTimeout(() => {
                      setRe(false);
                      load();
                    }, 4000);
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
                    await accountSourcingApi.pushToInstantly(company.id);
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
            label="Contacts"
            value={String(contacts.length)}
            hint="Discovered stakeholders available for prospecting and meeting prep."
            tone="neutral"
          />
          <MetricCard
            label="Committee Coverage"
            value={`${committeeScore}%`}
            hint="How much of the core buying group is already mapped."
            tone={committeeScore >= 75 ? "green" : "primary"}
          />
          <MetricCard
            label="Open Gaps"
            value={String(missingRoles.length)}
            hint="Roles still worth finding before pushing a multi-threaded motion."
            tone={missingRoles.length === 0 ? "green" : "warm"}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.45fr) minmax(320px, 0.95fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 14 }}>
            <Section title="Account Thesis" icon={<Target size={15} color={colors.primary} />}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <div style={{ border: `1px solid ${colors.border}`, background: "#fbfdff", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ color: colors.faint, fontWeight: 800, fontSize: 11, letterSpacing: 0.4 }}>FIT CONFIDENCE</div>
                  <div style={{ marginTop: 8, color: colors.primary, fontWeight: 800, fontSize: 24 }}>
                    {typeof ai?.confidence === "number" ? `${ai.confidence}%` : "N/A"}
                  </div>
                </div>
                <div style={{ border: `1px solid ${colors.border}`, background: "#fbfdff", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ color: colors.faint, fontWeight: 800, fontSize: 11, letterSpacing: 0.4 }}>BUYING SIGNALS</div>
                  <div style={{ marginTop: 8, color: colors.amber, fontWeight: 800, fontSize: 24 }}>{painPoints.length + talkingPoints.length}</div>
                </div>
                <div style={{ border: `1px solid ${colors.border}`, background: "#fbfdff", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ color: colors.faint, fontWeight: 800, fontSize: 11, letterSpacing: 0.4 }}>MISSING ROLES</div>
                  <div style={{ marginTop: 8, color: missingRoles.length === 0 ? colors.green : colors.amber, fontWeight: 800, fontSize: 24 }}>{missingRoles.length}</div>
                </div>
              </div>

              <div>
                <div style={{ color: colors.text, fontWeight: 800, marginBottom: 8 }}>Why this account fits Beacon</div>
                <ParagraphBlock text={fitReasoning} tone="soft" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                <ListCard title="Intent Summary" items={intentSummary ? [intentSummary] : []} empty="No intent summary available." />
                <ListCard title="Recommended Approach" items={recommendedApproach ? [recommendedApproach] : []} empty="No recommended approach generated yet." />
              </div>
            </Section>

            <Section title="Prospecting Guidance" icon={<MessageSquare size={15} color={colors.primary} />}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                <ListCard title="Pain Points" items={painPoints} empty="No pain points captured." />
                <ListCard title="Talking Points" items={talkingPoints} empty="No talking points captured." />
                <ListCard title="Competitors" items={competitors} empty="No competitive landscape captured." />
                <ListCard title="Tech Signals" items={techSignals} empty="No tech signals captured." />
              </div>
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
              {contacts.length === 0 ? (
                <div style={{ color: colors.faint }}>No contacts discovered yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {contacts.map((c) => <ContactItem key={c.id} contact={c} />)}
                </div>
              )}
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
            <Section title="Company Snapshot" icon={<Building2 size={15} color={colors.primary} />}>
              <KV label="Name" value={company.name} />
              <KV label="Domain" value={company.domain} />
              <KV label="Industry" value={company.industry} />
              <KV label="Funding" value={company.funding_stage} />
              <KV label="Employees" value={company.employee_count ? company.employee_count.toLocaleString() : undefined} />
              <KV label="ICP Score" value={company.icp_score ? `${company.icp_score}/100` : undefined} />
            </Section>

            <Section title="Committee Readiness" icon={<Users size={15} color={colors.primary} />}>
              {committee ? (
                <>
                  <div style={{ marginBottom: 6, border: `1px solid ${colors.border}`, background: "#fbfdff", borderRadius: 14, padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8, color: colors.sub, fontSize: 12, fontWeight: 700 }}>
                      <span>Committee coverage</span>
                      <span>{committeeScore}%</span>
                    </div>
                    <div style={{ height: 8, background: "#e9eef5", borderRadius: 999, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${committeeScore}%`,
                          height: "100%",
                          background: committeeScore >= 75 ? "#10b981" : committeeScore >= 50 ? "#2563eb" : "#f59e0b",
                        }}
                      />
                    </div>
                  </div>
                  {Array.isArray(committee.covered_roles) && (committee.covered_roles as Array<{ label?: string }>).length > 0 ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ color: colors.faint, fontWeight: 700, fontSize: 12, letterSpacing: 0.3 }}>COVERED ROLES</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {(committee.covered_roles as Array<{ label?: string }>)
                          .map((item) => item.label)
                          .filter(Boolean)
                          .map((label) => (
                            <span key={label} style={{ borderRadius: 999, padding: "6px 10px", background: "#eefcf5", color: colors.green, fontSize: 12, fontWeight: 700 }}>
                              {label}
                            </span>
                          ))}
                      </div>
                    </div>
                  ) : null}
                  {missingRoles.length > 0 && (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ color: colors.faint, fontWeight: 700, fontSize: 12, letterSpacing: 0.3 }}>MISSING ROLES</div>
                      {missingRoles.map((item, idx) => (
                        <div key={`${item.label}-${idx}`} style={{ border: `1px solid #ffe0b2`, borderRadius: 10, padding: "10px 12px", background: "#fff9f0" }}>
                          <div style={{ color: colors.text, fontWeight: 700 }}>{item.label}</div>
                          {item.why ? <div style={{ color: colors.sub, fontSize: 13, marginTop: 4 }}>{item.why}</div> : null}
                        </div>
                      ))}
                    </div>
                  )}
                  {bestContacts.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ color: colors.faint, fontWeight: 700, fontSize: 12, letterSpacing: 0.3, marginBottom: 8 }}>
                        BEST CONTACTS
                      </div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {bestContacts.map((item, idx) => (
                          <div key={`${item.name}-${idx}`} style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: "10px 12px", background: "#fbfdff" }}>
                            <div style={{ color: colors.text, fontWeight: 700 }}>{item.name}</div>
                            <div style={{ color: colors.sub, fontSize: 13, marginTop: 2 }}>{item.title || item.label || "Stakeholder"}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
                  ) : (
                <div style={{ color: colors.faint }}>Committee coverage will appear after enrichment finishes.</div>
              )}
            </Section>

            <Section title="Data Freshness" icon={<TrendingUp size={15} color={colors.primary} />}>
              {[
                ["Website Scrape", cacheTs(cache, "web_scrape")],
                ["Intent Signals", cacheTs(cache, "intent_signals")],
                ["Apollo Company", cacheTs(cache, "apollo_company")],
                ["Apollo Contacts", cacheTs(cache, "apollo_contacts")],
                ["Committee Coverage", cacheTs(cache, "committee_coverage")],
                ["AI Summary", cacheTs(cache, "ai_summary")],
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
