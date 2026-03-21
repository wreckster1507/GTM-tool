import { CSSProperties, ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a .csv file");
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
            Start with a CSV, then let Beacon score fit, widen stakeholder coverage, and surface the best next people to prospect.
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
            {["CSV upload", "Committee coverage", "Intent signals", "Prospecting priorities"].map((item) => (
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
              accept=".csv"
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

function BatchBar({ batch }: { batch: SourcingBatch }) {
  const pct = batch.total_rows ? Math.round((batch.processed_rows / batch.total_rows) * 100) : 0;
  return (
    <div style={{ ...cardStyle, padding: "16px 18px", background: "linear-gradient(180deg, #ffffff 0%, #f9fbff 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: colors.text, fontWeight: 700 }}>
          {batch.status === "completed" ? (
            <CheckCircle2 size={16} color={colors.green} />
          ) : (
            <Loader2 size={16} color={colors.primary} className="animate-spin" />
          )}
          {batch.filename}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            style={{
              borderRadius: 999,
              padding: "4px 8px",
              background: batch.status === "completed" ? colors.greenSoft : colors.primarySoft,
              color: batch.status === "completed" ? colors.green : colors.primary,
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            {batch.status.toUpperCase()}
          </span>
          <div style={{ color: colors.faint, fontSize: 13 }}>
            {batch.processed_rows}/{batch.total_rows} enriched
          </div>
        </div>
      </div>
      <div style={{ height: 8, background: "#edf2f7", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: colors.primary }} />
      </div>
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", color: colors.faint, fontSize: 12 }}>
        <span>{pct}% complete</span>
        <span>{batch.created_companies} created</span>
      </div>
    </div>
  );
}

function ContactRow({ contact }: { contact: Contact }) {
  const [re, setRe] = useState(false);
  const persona = canonicalPersona(contact.persona, contact.persona_type);

  return (
    <tr>
      <td style={{ padding: "12px 14px", borderBottom: `1px solid ${colors.border}`, color: colors.text, verticalAlign: "top" }}>
        {contact.first_name} {contact.last_name}
      </td>
      <td style={{ padding: "12px 14px", borderBottom: `1px solid ${colors.border}`, color: colors.sub, verticalAlign: "top" }}>{contact.title || "-"}</td>
      <td style={{ padding: "12px 14px", borderBottom: `1px solid ${colors.border}`, verticalAlign: "top" }}>
        <div style={{ display: "inline-flex", gap: 10 }}>
          {contact.email ? <a href={`mailto:${contact.email}`}><Mail size={14} /></a> : null}
          {contact.linkedin_url ? <a href={contact.linkedin_url} target="_blank" rel="noreferrer"><Linkedin size={14} /></a> : null}
          {contact.phone ? <a href={`tel:${contact.phone}`}><Phone size={14} /></a> : null}
        </div>
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
  const [expanded, setExpanded] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  const [re, setRe] = useState(false);
  const [push, setPush] = useState(false);

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

  const tier = company.icp_tier || "cold";
  const signals = company.intent_signals as { hiring?: number; funding?: number; product?: number } | undefined;
  const cache = (company.enrichment_cache || {}) as Record<string, unknown>;
  const committeeEntry = cache.committee_coverage as { data?: { coverage_score?: number; missing_roles?: unknown[] } } | undefined;
  const committee = (committeeEntry?.data ?? committeeEntry) as { coverage_score?: number; missing_roles?: unknown[] } | undefined;
  const missingRoleCount = Array.isArray(committee?.missing_roles) ? committee!.missing_roles.length : 0;
  const coverageScore = typeof committee?.coverage_score === "number" ? committee.coverage_score : undefined;

  return (
    <div style={{ ...cardStyle, overflow: "hidden" }}>
      <div
        style={{
          padding: "18px 20px",
          display: "grid",
          gridTemplateColumns: "auto minmax(0,1fr) auto",
          columnGap: 12,
          rowGap: 10,
          cursor: "pointer",
          background: expanded ? "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)" : "#ffffff",
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div style={{ color: colors.faint, paddingTop: 2 }}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Building2 size={16} color="#8b98ad" />
            <Link to={`/account-sourcing/${company.id}`} onClick={(e) => e.stopPropagation()} style={{ color: colors.text, fontWeight: 800, fontSize: 18, textDecoration: "none" }}>
              {company.name}
            </Link>
            <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              <ExternalLink size={12} color="#8b98ad" />
            </a>
            <span style={{ ...ICP_STYLE[tier], borderRadius: 999, fontSize: 11, fontWeight: 800, padding: "3px 8px" }}>
              {tier.toUpperCase()} ({company.icp_score ?? 0})
            </span>
          </div>

          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 12, color: colors.sub, fontSize: 14 }}>
            <span>{company.domain}</span>
            {company.industry ? <span>{company.industry}</span> : null}
            {company.employee_count ? <span>{company.employee_count.toLocaleString()} employees</span> : null}
            {company.funding_stage ? <span>{company.funding_stage}</span> : null}
          </div>

          {company.description ? (
            <p style={{ marginTop: 10, color: colors.sub, lineHeight: 1.6, fontSize: 15, marginBottom: 0 }}>
              {company.description}
            </p>
          ) : null}

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div style={{ borderRadius: 12, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "10px 12px" }}>
              <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>PIPELINE READINESS</div>
              <div style={{ marginTop: 6, color: colors.text, fontWeight: 800, fontSize: 18 }}>{coverageScore ?? 0}%</div>
              <div style={{ marginTop: 4, color: colors.sub, fontSize: 12 }}>Committee coverage</div>
            </div>
            <div style={{ borderRadius: 12, border: `1px solid ${colors.border}`, background: "#fbfdff", padding: "10px 12px" }}>
              <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>NEXT GAPS</div>
              <div style={{ marginTop: 6, color: colors.text, fontWeight: 800, fontSize: 18 }}>{missingRoleCount}</div>
              <div style={{ marginTop: 4, color: colors.sub, fontSize: 12 }}>Roles still missing</div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8, justifyItems: "end", alignContent: "start" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ color: colors.faint, fontSize: 12, textAlign: "right" }}>
            Enriched
            <div style={{ color: colors.sub, fontWeight: 700, marginTop: 2 }}>{ts(company.enriched_at)}</div>
          </div>

          <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {signals?.hiring ? <span style={{ background: colors.greenSoft, color: colors.green, borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 700 }}>Hiring</span> : null}
            {signals?.funding ? <span style={{ background: colors.primarySoft, color: colors.primary, borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 700 }}>Funding</span> : null}
            {signals?.product ? <span style={{ background: colors.violetSoft, color: colors.violet, borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 700 }}>Product</span> : null}
            {typeof committee?.coverage_score === "number" ? (
              <span style={{ background: "#eef6ff", color: "#24567e", borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 700 }}>
                Committee {committee.coverage_score}%
              </span>
            ) : null}
            {missingRoleCount > 0 ? (
              <span style={{ background: colors.redSoft, color: colors.red, borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 700 }}>
                {missingRoleCount} gaps
              </span>
            ) : null}
          </div>

          <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
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
              style={{ border: `1px solid ${colors.border}`, background: "#fff", color: colors.text, borderRadius: 10, padding: "7px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
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
              style={{ border: `1px solid #cde5ff`, background: "#eff7ff", color: "#1f5ecc", borderRadius: 10, padding: "7px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {push ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Instantly
            </button>
          </div>
        </div>
      </div>

      {expanded ? (
        <div style={{ borderTop: `1px solid ${colors.border}`, padding: "16px 20px 20px", background: "#fbfdff" }}>
          {typeof coverageScore === "number" && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6, color: colors.sub, fontSize: 12, fontWeight: 700 }}>
                <span>Committee coverage</span>
                <span>{coverageScore}%</span>
              </div>
              <div style={{ height: 8, background: "#e9eef5", borderRadius: 999, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${coverageScore}%`,
                    height: "100%",
                    background: coverageScore >= 75 ? "#10b981" : coverageScore >= 50 ? "#2563eb" : "#f59e0b",
                  }}
                />
              </div>
            </div>
          )}
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
  const [activeBatch, setActiveBatch] = useState<SourcingBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [checkingBatch, setCheckingBatch] = useState(false);

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

  const checkActiveBatchStatus = useCallback(async () => {
    if (!activeBatch) return;
    setCheckingBatch(true);
    try {
      const updated = await accountSourcingApi.batchStatus(activeBatch.id);
      setActiveBatch(updated);
      if (updated.status === "completed" || updated.status === "failed") {
        await load();
      }
    } finally {
      setCheckingBatch(false);
    }
  }, [activeBatch, load]);

  const q = search.trim().toLowerCase();
  const list = companies.filter((c) => {
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.domain.toLowerCase().includes(q) || (c.industry || "").toLowerCase().includes(q);
  });
  const hotCount = companies.filter((c) => c.icp_tier === "hot").length;
  const warmCount = companies.filter((c) => c.icp_tier === "warm").length;
  const committeeReadyCount = companies.filter((company) => {
    const cache = (company.enrichment_cache || {}) as Record<string, unknown>;
    const committeeEntry = cache.committee_coverage as { data?: { coverage_score?: number } } | undefined;
    const committee = (committeeEntry?.data ?? committeeEntry) as { coverage_score?: number } | undefined;
    return (committee?.coverage_score ?? 0) >= 75;
  }).length;

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
                Import target accounts, score fit, widen stakeholder coverage, and prepare cleaner handoffs into prospecting.
              </p>
            </div>
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
            hint="Good-fit accounts that still need deeper signal or committee coverage."
            tone="primary"
          />
          <SummaryCard
            icon={<Target size={18} />}
            label="Committee Ready"
            value={String(committeeReadyCount)}
            hint="Accounts with 75%+ buying-committee coverage already mapped."
            tone="green"
          />
        </div>

        <UploadPanel onUploaded={(b) => { setActiveBatch(b); load(); }} />
        {activeBatch && activeBatch.status !== "completed" ? (
          <div style={{ display: "grid", gap: 8 }}>
            <BatchBar batch={activeBatch} />
            <div>
              <button
                onClick={checkActiveBatchStatus}
                disabled={checkingBatch}
                style={{
                  border: `1px solid ${colors.border}`,
                  background: colors.card,
                  color: colors.text,
                  borderRadius: 10,
                  padding: "8px 12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: checkingBatch ? "not-allowed" : "pointer",
                  opacity: checkingBatch ? 0.7 : 1,
                }}
              >
                {checkingBatch ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Check Batch Status
              </button>
            </div>
          </div>
        ) : null}

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
            <span>{committeeReadyCount} committee-ready</span>
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
