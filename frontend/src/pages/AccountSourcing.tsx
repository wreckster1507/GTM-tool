import { CSSProperties, ReactNode, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Download,
  Flame,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react";

import { accountSourcingApi } from "../lib/api";
import { getAccountPrioritySnapshot } from "../lib/utils";
import type { AccountSourcingSummary, Company, SourcingBatch } from "../types";

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

const PRIORITY_STYLE: Record<"high" | "medium" | "low", CSSProperties> = {
  high: { background: "#e8f8f0", color: "#1f8f5f" },
  medium: { background: "#fff4df", color: "#b56d00" },
  low: { background: "#eef2f7", color: "#5e6d83" },
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

function CompanyCard({ company }: { company: Company }) {
  const nav = useNavigate();

  const tier = company.icp_tier || "cold";
  const priority = getAccountPrioritySnapshot(company);
  const icpAnalysis = getIcpAnalysis(company);
  const salesPlay = getSalesPlay(company);
  const talVerdict = asText(salesPlay?.tal_verdict) || (typeof icpAnalysis?.classification === "string" ? icpAnalysis.classification : undefined);
  const owner = company.assigned_rep_email || company.assigned_rep_name || company.assigned_rep || "";
  const disposition = company.disposition || "";

  return (
    <div
      onClick={() => nav(`/account-sourcing/${company.id}`)}
      style={{
        ...cardStyle,
        padding: "14px 20px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 16,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fbff"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "#ffffff"; }}
    >
      <Building2 size={18} color="#71839a" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: colors.text, fontWeight: 800, fontSize: 15 }}>{company.name}</div>
        <div style={{ color: colors.faint, fontSize: 12, marginTop: 2 }}>
          {company.domain.endsWith(".unknown") ? "Domain unresolved" : company.domain}
          {company.industry ? ` · ${company.industry}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ ...ICP_STYLE[tier], borderRadius: 999, fontSize: 11, fontWeight: 800, padding: "4px 10px" }}>
          {tier.toUpperCase()}
        </span>
        {talVerdict ? (
          <span style={{ background: "#eef6ff", color: "#24567e", borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 800 }}>
            {talVerdict}
          </span>
        ) : null}
        <span style={{ ...PRIORITY_STYLE[priority.priorityBand], borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 800 }}>
          {priority.priorityBand}
        </span>
        {disposition ? (
          <span style={{ background: "#f4f7fb", color: colors.sub, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 700, border: `1px solid ${colors.border}` }}>
            {disposition}
          </span>
        ) : null}
      </div>
      {owner ? (
        <div style={{ color: colors.sub, fontSize: 12, fontWeight: 600, flexShrink: 0, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {owner}
        </div>
      ) : null}
      <ChevronRight size={16} color={colors.faint} style={{ flexShrink: 0 }} />
    </div>
  );
}

export default function AccountSourcing() {
  const pageSize = 40;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [summary, setSummary] = useState<AccountSourcingSummary | null>(null);
  const [batches, setBatches] = useState<SourcingBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [dispositionFilter, setDispositionFilter] = useState("");
  const [laneFilter, setLaneFilter] = useState("");
  const [page, setPage] = useState(1);
  const [companyTotal, setCompanyTotal] = useState(0);
  const [companyPages, setCompanyPages] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportingContacts, setExportingContacts] = useState(false);
  const [resettingScope, setResettingScope] = useState<"" | "account-sourcing" | "workspace">("");
  const { isAdmin } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [companyPage, companySummary, b] = await Promise.all([
        accountSourcingApi.listCompaniesPaginated({
          skip: (page - 1) * pageSize,
          limit: pageSize,
          q: debouncedSearch || undefined,
          icpTier: tierFilter || undefined,
          disposition: dispositionFilter || undefined,
          recommendedOutreachLane: laneFilter || undefined,
        }),
        accountSourcingApi.summary(),
        accountSourcingApi.listBatches(),
      ]);
      setCompanies(companyPage.items);
      setCompanyTotal(companyPage.total);
      setCompanyPages(companyPage.pages);
      setSummary(companySummary);
      setBatches(b);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, dispositionFilter, laneFilter, page, tierFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, tierFilter, dispositionFilter, laneFilter]);

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

  const hasFilters = !!(search || tierFilter || dispositionFilter || laneFilter);
  const totalCompanies = summary?.total_companies ?? 0;
  const hotCount = summary?.hot_count ?? 0;
  const warmCount = summary?.warm_count ?? 0;
  const highPriorityCount = summary?.high_priority_count ?? 0;
  const engagedCount = summary?.engaged_count ?? 0;
  const unresolvedCount = summary?.unresolved_count ?? 0;
  const unenrichedCount = summary?.unenriched_count ?? 0;
  const researchedCount = summary?.researched_count ?? 0;
  const targetVerdictCount = summary?.target_verdict_count ?? 0;
  const watchVerdictCount = summary?.watch_verdict_count ?? 0;
  const enrichedCount = summary?.enriched_count ?? 0;
  const totalContacts = summary?.total_contacts ?? 0;
  const showingStart = companyTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingEnd = companyTotal === 0 ? 0 : Math.min(page * pageSize, companyTotal);

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
              {isAdmin && (
                <>
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
                </>
              )}
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
            value={String(totalCompanies)}
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
        {totalCompanies > 0 && (() => {
          const enrichedCt = enrichedCount;
          const icpDoneCt = researchedCount;
          const totalCt = totalCompanies;
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

        <div
          style={{
            ...cardStyle,
            padding: "14px 16px",
            display: "grid",
            gap: 12,
            position: "sticky",
            top: 16,
            zIndex: 5,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative", minWidth: 260, flex: 1 }}>
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
              <span>{totalCompanies} companies sourced</span>
              <span>{highPriorityCount} high-priority</span>
              <span>{researchedCount} researched</span>
              <span>{targetVerdictCount} target verdicts</span>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: colors.sub, fontSize: 13, fontWeight: 700 }}>
                {companyTotal === 0 ? "0 shown" : `${showingStart}-${showingEnd} of ${companyTotal}`}
              </span>
              <span style={{ color: colors.faint, fontSize: 12 }}>Page {page} of {Math.max(companyPages, 1)}</span>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setTierFilter("");
                    setDispositionFilter("");
                    setLaneFilter("");
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
              ) : null}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ ...cardStyle, padding: 36, textAlign: "center" }}>
            <Loader2 className="animate-spin" color={colors.primary} />
          </div>
        ) : companies.length === 0 ? (
          <div style={{ ...cardStyle, padding: 34, textAlign: "center", color: colors.faint }}>
            <Building2 size={30} style={{ marginBottom: 8 }} />
            {hasFilters ? "No companies match these filters." : "No companies sourced yet."}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {companies.map((c) => (
              <CompanyCard key={c.id} company={c} />
            ))}
            <div style={{ ...cardStyle, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ color: colors.sub, fontSize: 13 }}>
                {companyTotal === 0 ? "0 shown" : `Showing ${showingStart}-${showingEnd} of ${companyTotal} sourced companies`}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  style={{
                    border: `1px solid ${colors.border}`,
                    background: page <= 1 ? "#f5f7fb" : colors.card,
                    color: page <= 1 ? colors.faint : colors.text,
                    borderRadius: 10,
                    padding: "10px 14px",
                    fontWeight: 700,
                    cursor: page <= 1 ? "not-allowed" : "pointer",
                  }}
                >
                  Previous
                </button>
                <span style={{ color: colors.sub, fontSize: 13, fontWeight: 700, minWidth: 84, textAlign: "center" }}>
                  Page {page} / {Math.max(companyPages, 1)}
                </span>
                <button
                  type="button"
                  disabled={page >= companyPages}
                  onClick={() => setPage((current) => Math.min(companyPages, current + 1))}
                  style={{
                    border: `1px solid ${colors.border}`,
                    background: page >= companyPages ? "#f5f7fb" : colors.card,
                    color: page >= companyPages ? colors.faint : colors.text,
                    borderRadius: 10,
                    padding: "10px 14px",
                    fontWeight: 700,
                    cursor: page >= companyPages ? "not-allowed" : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
