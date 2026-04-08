import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import {
  AlertCircle,
  Brain,
  Building2,
  CheckCircle2,
  ChevronRight,
  Download,
  Flame,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  Users,
  X,
} from "lucide-react";

import { accountSourcingApi } from "../lib/api";
import { getAccountPrioritySnapshot } from "../lib/utils";
import type { AccountSourcingSummary, Company, SourcingBatch } from "../types";
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

function formatBatchStage(stage?: string, status?: string): string {
  const key = (stage || status || "").toLowerCase();
  const labels: Record<string, string> = {
    upload_received: "Upload Received",
    tal_review: "Awaiting TAL Approval",
    queued: "Queued",
    research_running: "Research Running",
    processing: "Research Running",
    pending: "Queued",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown";
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

function parseManualCompanyLines(input: string): Array<{ name: string; domain?: string }> {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line
        .split(/[|,]/)
        .map((part) => part.trim())
        .filter(Boolean);
      const [name, domain] = parts;
      return {
        name: name || "",
        domain: domain || undefined,
      };
    })
    .filter((entry) => entry.name);
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
  tone = "neutral",
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "primary" | "warm" | "green";
  onClick?: () => void;
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
        cursor: onClick ? "pointer" : "default",
      }}
      onClick={onClick}
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

function UploadPanel({
  onUploaded,
  onDownloadTemplate,
}: {
  onUploaded: (batch: SourcingBatch) => void;
  onDownloadTemplate: () => void;
}) {
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
          <div style={{ fontWeight: 800, color: colors.text, fontSize: 32 }}>Migrate Accounts Workbook</div>
          <div style={{ color: colors.sub, marginTop: 10, lineHeight: 1.6, fontSize: 15, maxWidth: 760, marginInline: "auto" }}>
            Use this for account-led spreadsheets like your master ICP or target-account workbook. Beacon will import the companies first without forcing enrichment, then reps can enrich only the accounts they want to work.
          </div>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onDownloadTemplate}
              style={{
                border: `1px solid ${colors.border}`,
                background: "#fff",
                color: colors.text,
                borderRadius: 10,
                padding: "9px 14px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Download Example Template
            </button>
            <span style={{ color: colors.faint, fontSize: 12, alignSelf: "center" }}>
              Best for account-led files with columns like `Accounts`, `Region`, `AE`, `SDR`, `Headquarters`, `Classification`, and `Remarks`
            </span>
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

function CompanyCard({ company, onAssigned }: { company: Company; onAssigned: (userId: string | null, userName: string | null) => void }) {
  const nav = useNavigate();

  const tier = company.icp_tier || "cold";
  const priority = getAccountPrioritySnapshot(company);
  const icpAnalysis = getIcpAnalysis(company);
  const salesPlay = getSalesPlay(company);
  const talVerdict = asText(salesPlay?.tal_verdict) || (typeof icpAnalysis?.classification === "string" ? icpAnalysis.classification : undefined);
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
      {/* AE / SDR assign — stop propagation so clicking doesn't navigate */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        <AssignDropdown
          entityType="company"
          entityId={company.id}
          role="ae"
          currentAssignedId={company.assigned_to_id ?? null}
          currentAssignedName={company.assigned_rep_name || company.assigned_rep || company.assigned_rep_email || null}
          onAssigned={onAssigned}
          compact
          label="AE"
        />
        <AssignDropdown
          entityType="company"
          entityId={company.id}
          role="sdr"
          currentAssignedId={company.sdr_id ?? null}
          currentAssignedName={company.sdr_name || company.sdr_email || null}
          onAssigned={onAssigned}
          compact
          label="SDR"
        />
      </div>
      <ChevronRight size={16} color={colors.faint} style={{ flexShrink: 0 }} />
    </div>
  );
}

export default function AccountSourcing() {
  const pageSize = 40;
  const [searchParams, setSearchParams] = useSearchParams();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [summary, setSummary] = useState<AccountSourcingSummary | null>(null);
  const [batches, setBatches] = useState<SourcingBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("q") ?? "");
  const [tierFilter, setTierFilter] = useState(() => searchParams.get("tier") ?? "");
  const [dispositionFilter, setDispositionFilter] = useState(() => searchParams.get("disp") ?? "");
  const [laneFilter, setLaneFilter] = useState(() => searchParams.get("lane") ?? "");
  const [page, setPage] = useState(() => parseInt(searchParams.get("pg") ?? "1", 10) || 1);
  const [companyTotal, setCompanyTotal] = useState(0);
  const [companyPages, setCompanyPages] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportingContacts, setExportingContacts] = useState(false);
  const [resettingScope, setResettingScope] = useState<"" | "account-sourcing" | "workspace">("");
  const [activeTab, setActiveTab] = useState<"accounts" | "imports">("accounts");
  const [dismissedBatchIds, setDismissedBatchIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem("account-sourcing-dismissed-batches");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [successModal, setSuccessModal] = useState<{ title: string; message: string } | null>(null);
  const [pendingBatchApproval, setPendingBatchApproval] = useState<SourcingBatch | null>(null);
  const [confirmingBatchId, setConfirmingBatchId] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ companiesText: "" });
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [createError, setCreateError] = useState("");
  const [bulkEnriching, setBulkEnriching] = useState(false);
  const [bulkEnrichResult, setBulkEnrichResult] = useState<string | null>(null);
  const [bulkIcpRunning, setBulkIcpRunning] = useState(false);
  const [bulkIcpResult, setBulkIcpResult] = useState<string | null>(null);
  const { isAdmin } = useAuth();

  useEffect(() => {
    try {
      window.localStorage.setItem("account-sourcing-dismissed-batches", JSON.stringify(dismissedBatchIds));
    } catch {
      // ignore local storage issues
    }
  }, [dismissedBatchIds]);

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

  const latestVisibleBatch = useMemo(
    () =>
      batches.find(
        (batch) =>
          !dismissedBatchIds.includes(batch.id) &&
          ["awaiting_confirmation", "pending", "processing", "completed"].includes(batch.status)
      ) ?? null,
    [batches, dismissedBatchIds]
  );

  // Sync filter state to URL so navigating away and back restores the view
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      search.trim() ? next.set("q", search.trim()) : next.delete("q");
      tierFilter ? next.set("tier", tierFilter) : next.delete("tier");
      dispositionFilter ? next.set("disp", dispositionFilter) : next.delete("disp");
      laneFilter ? next.set("lane", laneFilter) : next.delete("lane");
      page > 1 ? next.set("pg", String(page)) : next.delete("pg");
      return next;
    }, { replace: true });
  }, [search, tierFilter, dispositionFilter, laneFilter, page]);

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
  const latestVerdictSummary = (latestVisibleBatch?.verdict_summary || {}) as Record<string, unknown>;
  const etaText =
    latestVisibleBatch?.eta_seconds && latestVisibleBatch.eta_seconds > 0
      ? `${Math.ceil(latestVisibleBatch.eta_seconds / 60)} min remaining`
      : latestVisibleBatch?.status === "completed"
        ? "Finished"
        : "Estimating...";
  const batchInFlight = Boolean(latestVisibleBatch && ["pending", "processing"].includes(latestVisibleBatch.status));
  const latestProgressMessage = latestVisibleBatch
    ? latestVisibleBatch.progress_message ||
      (latestVisibleBatch.total_rows > 0
        ? `Processed ${latestVisibleBatch.processed_rows} of ${latestVisibleBatch.total_rows} accounts`
        : "Research in progress")
    : "";
  const progressPercent = latestVisibleBatch
    ? latestVisibleBatch.status === "completed"
      ? 100
      : latestVisibleBatch.total_rows
        ? Math.min(100, Math.round((latestVisibleBatch.processed_rows / latestVisibleBatch.total_rows) * 100))
        : 0
    : 0;

  useEffect(() => {
    if (!batchInFlight) return;
    const id = window.setInterval(() => {
      void load();
    }, 8000);
    return () => window.clearInterval(id);
  }, [batchInFlight, load]);

  const downloadTemplate = useCallback(() => {
    const template = [
      ["Company Name", "Domain", "Industry", "AE", "SDR", "Classification", "Contact", "Title", "Email", "LinkedIn URL"],
      ["BlackLine", "blackline.com", "Finance automation", "rakesh@beacon.li", "mahesh@beacon.li", "target", "Jane Smith", "Director of Professional Services", "jane@blackline.com", "https://linkedin.com/in/janesmith"],
    ]
      .map((row) => row.join(","))
      .join("\n");
    const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "beacon-account-sourcing-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleBatchUploaded = useCallback((batch: SourcingBatch) => {
    setSuccessModal({
      title: "Upload received",
      message:
        batch.requires_confirmation
          ? "The file was uploaded. Beacon found TAL verdicts that need review before enrichment starts."
          : "The file was uploaded successfully and enrichment has started.",
    });
    if (batch.requires_confirmation) {
      setPendingBatchApproval(batch);
    }
    setDismissedBatchIds((current) => current.filter((id) => id !== batch.id));
    void load();
  }, [load]);

  const handleCreateCompany = useCallback(async () => {
    const entries = parseManualCompanyLines(createForm.companiesText);
    if (!entries.length) {
      setCreateError("Add at least one company name.");
      return;
    }
    setCreatingCompany(true);
    setCreateError("");
    try {
      const createdBatches: SourcingBatch[] = [];
      for (const entry of entries) {
        const batch = await accountSourcingApi.createManualCompany({
          name: entry.name,
          domain: entry.domain,
        });
        createdBatches.push(batch);
      }
      setShowCreateModal(false);
      setCreateForm({ companiesText: "" });
      setSuccessModal({
        title: entries.length === 1 ? "Account added" : "Accounts added",
        message:
          entries.length === 1
            ? "The account was created and enrichment has started."
            : `${entries.length} accounts were created and enrichment has started for each of them.`,
      });
      setDismissedBatchIds((current) =>
        current.filter((id) => !createdBatches.some((batch) => batch.id === id))
      );
      setActiveTab("imports");
      await load();
    } catch (error: unknown) {
      setCreateError(error instanceof Error ? error.message : "Failed to create company");
    } finally {
      setCreatingCompany(false);
    }
  }, [createForm.companiesText, load]);

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
                Start with company names and turn them into presentable account briefs with verdicts, timing, outreach angles, and a clean view of where to aim next.
              </p>
              <div style={{ marginTop: 18, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#f7faff", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "8px" }}>
                {[
                  { id: "accounts", label: "Accounts" },
                  { id: "imports", label: `Recent Imports${batches.length ? ` (${batches.length})` : ""}` },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id as "accounts" | "imports")}
                    style={{
                      border: 0,
                      background: activeTab === tab.id ? "#eef5ff" : "transparent",
                      color: activeTab === tab.id ? colors.primary : colors.sub,
                      borderRadius: 10,
                      padding: "10px 14px",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "inline-flex", gap: 10, flexWrap: "wrap" }}>
              {isAdmin ? (
                <button
                  onClick={() => setShowCreateModal(true)}
                  style={{
                    border: 0,
                    background: "#4f46e5",
                    color: "#fff",
                    borderRadius: 12,
                    padding: "10px 14px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={15} />
                  Add Accounts
                </button>
              ) : null}
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
              {isAdmin && (
                <>
                  <button
                    onClick={async () => {
                      if (!window.confirm("Run ICP research for all sourced accounts? Uses web search + Claude AI — no Apollo or Hunter credits.\n\nThis may take 15-30s per company.")) return;
                      setBulkIcpRunning(true);
                      setBulkIcpResult(null);
                      try {
                        const result = await accountSourcingApi.bulkIcpResearch(false);
                        setBulkIcpResult(`Queued ${result.queued} of ${result.total} accounts for ICP research`);
                      } catch (e) {
                        setBulkIcpResult(e instanceof Error ? e.message : "Failed to queue ICP research");
                      } finally {
                        setBulkIcpRunning(false);
                      }
                    }}
                    disabled={bulkIcpRunning}
                    style={{
                      border: `1px solid #c3dfc0`,
                      background: "#edfaeb",
                      color: "#1a6b2a",
                      borderRadius: 12,
                      padding: "10px 14px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontWeight: 700,
                      cursor: bulkIcpRunning ? "not-allowed" : "pointer",
                      opacity: bulkIcpRunning ? 0.7 : 1,
                    }}
                  >
                    {bulkIcpRunning ? <Loader2 size={15} className="animate-spin" /> : <Brain size={15} />}
                    Run ICP Research
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm("Queue enrichment for all sourced accounts? This may take a while depending on how many companies you have.")) return;
                      setBulkEnriching(true);
                      setBulkEnrichResult(null);
                      try {
                        const result = await accountSourcingApi.bulkEnrichAll(false);
                        setBulkEnrichResult(`Queued ${result.queued} of ${result.total} accounts for enrichment`);
                      } catch (e) {
                        setBulkEnrichResult(e instanceof Error ? e.message : "Failed to queue enrichment");
                      } finally {
                        setBulkEnriching(false);
                      }
                    }}
                    disabled={bulkEnriching}
                    style={{
                      border: `1px solid #c8daf0`,
                      background: "#eaf2ff",
                      color: "#175089",
                      borderRadius: 12,
                      padding: "10px 14px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontWeight: 700,
                      cursor: bulkEnriching ? "not-allowed" : "pointer",
                      opacity: bulkEnriching ? 0.7 : 1,
                    }}
                  >
                    {bulkEnriching ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                    Enrich All Accounts
                  </button>
                </>
              )}
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

        {bulkIcpResult && (
          <div style={{ borderRadius: 12, border: "1px solid #c3dfc0", background: "#edfaeb", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 13, color: "#1a6b2a", fontWeight: 600 }}>{bulkIcpResult}</span>
            <button onClick={() => setBulkIcpResult(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#4a8c5a" }}><X size={14} /></button>
          </div>
        )}
        {bulkEnrichResult && (
          <div style={{ borderRadius: 12, border: "1px solid #c8daf0", background: "#eaf2ff", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 13, color: "#175089", fontWeight: 600 }}>{bulkEnrichResult}</span>
            <button onClick={() => setBulkEnrichResult(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#7a96b0" }}><X size={14} /></button>
          </div>
        )}

        <div
          style={{
            borderRadius: 16,
            border: "1px solid #f5ddaa",
            background: "#fff8e8",
            padding: "12px 16px",
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ color: "#8a5b00", fontSize: 11, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase" }}>
              Prospect sourcing update
            </div>
            <div style={{ color: "#6c5a2f", fontSize: 13, lineHeight: 1.6 }}>
              Beacon is temporarily not getting contacts during company research. Use Prospecting to upload stakeholder CSVs and map them onto sourced accounts once the companies are ready.
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
            onClick={() => setActiveTab("accounts")}
          />
          <SummaryCard
            icon={<Flame size={18} />}
            label="Hot Accounts"
            value={String(hotCount)}
            hint="Accounts with the strongest ICP fit and highest near-term potential."
            tone="warm"
            onClick={() => {
              setActiveTab("accounts");
              setTierFilter("hot");
            }}
          />
          <SummaryCard
            icon={<TrendingUp size={18} />}
            label="Warm Accounts"
            value={String(warmCount)}
            hint="Good-fit accounts that still need stronger proof, timing, or persona clarity."
            tone="primary"
            onClick={() => {
              setActiveTab("accounts");
              setTierFilter("warm");
            }}
          />
          <SummaryCard
            icon={<Target size={18} />}
            label="High Priority"
            value={String(highPriorityCount)}
            hint="Accounts worth the fastest follow-up based on fit, intent, and sales feedback."
            tone="green"
            onClick={() => {
              setActiveTab("accounts");
              setDispositionFilter("working");
            }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <SummaryCard
            icon={<Users size={18} />}
            label="Engaged Accounts"
            value={String(engagedCount)}
            hint="Accounts where reps have logged active motion or positive interest."
            tone="primary"
            onClick={() => {
              setActiveTab("accounts");
              setDispositionFilter("interested");
            }}
          />
          <SummaryCard
            icon={<Target size={18} />}
            label="Research Complete"
            value={String(researchedCount)}
            hint="Accounts with a generated Beacon research brief already available."
            tone="green"
            onClick={() => setActiveTab("imports")}
          />
          <SummaryCard
            icon={<Sparkles size={18} />}
            label="Target Verdicts"
            value={String(targetVerdictCount)}
            hint={`${watchVerdictCount} more accounts are currently in Watch.`}
            tone="warm"
            onClick={() => setActiveTab("imports")}
          />
          <SummaryCard
            icon={<AlertCircle size={18} />}
            label="Needs Review"
            value={String(unresolvedCount + unenrichedCount)}
            hint={`${unresolvedCount} unresolved domains, ${unenrichedCount} accounts without completed enrichment.`}
            tone="warm"
            onClick={() => setActiveTab("imports")}
          />
        </div>

        {isAdmin && activeTab === "accounts" ? (
          <UploadPanel onUploaded={handleBatchUploaded} onDownloadTemplate={downloadTemplate} />
        ) : null}

        {latestVisibleBatch ? (
          <div
            style={{
              ...cardStyle,
              padding: "16px 18px",
              display: "grid",
              gap: 12,
              background:
                latestVisibleBatch.status === "completed"
                  ? "#f0faf4"
                  : latestVisibleBatch.status === "awaiting_confirmation"
                    ? "#fff8ef"
                    : "#fbfdff",
              border:
                latestVisibleBatch.status === "completed"
                  ? "1px solid #c8e8d8"
                  : latestVisibleBatch.status === "awaiting_confirmation"
                    ? "1px solid #ffd8a8"
                    : `1px solid ${colors.border}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "start" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {latestVisibleBatch.status === "completed" ? (
                    <CheckCircle2 size={16} color={colors.green} />
                  ) : latestVisibleBatch.status === "awaiting_confirmation" ? (
                    <AlertCircle size={16} color={colors.amber} />
                  ) : (
                    <Loader2 size={16} className="animate-spin" color={colors.primary} />
                  )}
                  <span style={{ color: colors.text, fontWeight: 800, fontSize: 15 }}>{latestVisibleBatch.filename}</span>
                </div>
                <div style={{ color: colors.sub, fontSize: 13 }}>
                  {latestProgressMessage || "Tracking research progress"}
                  {latestVisibleBatch.created_by_name ? ` • Uploaded by ${latestVisibleBatch.created_by_name}` : ""}
                  {` • ${ts(latestVisibleBatch.created_at)}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {latestVisibleBatch.status === "awaiting_confirmation" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPendingBatchApproval(latestVisibleBatch)}
                      style={{
                        border: "1px solid #ffd29a",
                        background: "#fff2db",
                        color: colors.amber,
                        borderRadius: 10,
                        padding: "8px 12px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Review TAL verdicts
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingBatchApproval(latestVisibleBatch)}
                      style={{
                        border: 0,
                        background: colors.primary,
                        color: "#fff",
                        borderRadius: 10,
                        padding: "8px 12px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Continue enrichment
                    </button>
                  </>
                ) : null}
                {latestVisibleBatch.status === "completed" ? (
                  <button
                    type="button"
                    onClick={() => setDismissedBatchIds((current) => [...current, latestVisibleBatch.id])}
                    style={{
                      border: `1px solid ${colors.border}`,
                      background: "#fff",
                      color: colors.text,
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Close card
                  </button>
                ) : (
                  <button
                    onClick={load}
                    disabled={loading}
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
                      cursor: loading ? "not-allowed" : "pointer",
                      opacity: loading ? 0.7 : 1,
                    }}
                  >
                    {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    Refresh progress
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>PROGRESS</div>
                <div style={{ marginTop: 6, color: colors.text, fontWeight: 800, fontSize: 20 }}>
                  {latestVisibleBatch.processed_rows}/{latestVisibleBatch.total_rows}
                </div>
                <div style={{ marginTop: 4, color: colors.sub, fontSize: 12 }}>Accounts processed</div>
              </div>
              <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>CONTACTS FOUND</div>
                <div style={{ marginTop: 6, color: colors.text, fontWeight: 800, fontSize: 20 }}>
                  {latestVisibleBatch.contacts_found ?? 0}
                </div>
                <div style={{ marginTop: 4, color: colors.sub, fontSize: 12 }}>Relevant stakeholders saved</div>
              </div>
              <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>CURRENT STEP</div>
                <div style={{ marginTop: 6, color: colors.text, fontWeight: 800, fontSize: 16 }}>
                  {formatBatchStage(latestVisibleBatch.current_stage, latestVisibleBatch.status)}
                </div>
                <div style={{ marginTop: 4, color: colors.sub, fontSize: 12 }}>{etaText}</div>
              </div>
              <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>TAL VERDICTS</div>
                <div style={{ marginTop: 6, color: colors.text, fontWeight: 800, fontSize: 18 }}>
                  {String(latestVerdictSummary.target || 0)} target / {String(latestVerdictSummary.watch || 0)} watch
                </div>
                <div style={{ marginTop: 4, color: colors.sub, fontSize: 12 }}>
                  {latestVerdictSummary.message ? String(latestVerdictSummary.message) : "No uploaded verdicts"}
                </div>
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "#e5e7eb", overflow: "hidden" }}>
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  background: latestVisibleBatch.status === "completed" ? colors.green : colors.primary,
                }}
              />
            </div>
          </div>
        ) : null}

        {activeTab === "accounts" ? (
          <>
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
              <CompanyCard key={c.id} company={c} onAssigned={() => load()} />
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
          </>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {batches.length === 0 ? (
              <div style={{ ...cardStyle, padding: 28, textAlign: "center", color: colors.faint }}>
                No imports yet.
              </div>
            ) : (
              batches.map((batch) => (
                <div key={batch.id} style={{ ...cardStyle, padding: "18px 20px", display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {batch.status === "completed" ? <CheckCircle2 size={15} color={colors.green} /> : <Upload size={15} color={colors.primary} />}
                        <span style={{ fontWeight: 800, color: colors.text, fontSize: 16 }}>{batch.filename}</span>
                      </div>
                      <div style={{ color: colors.sub, fontSize: 13 }}>
                        {batch.created_by_name ? `Created by ${batch.created_by_name}` : "Created by Beacon"} • {ts(batch.created_at)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={async () => {
                          const blob = await accountSourcingApi.exportCsv({ batchId: batch.id });
                          const url = URL.createObjectURL(blob);
                          const anchor = document.createElement("a");
                          anchor.href = url;
                          anchor.download = `${batch.filename.replace(/\s+/g, "-").toLowerCase()}-companies.csv`;
                          anchor.click();
                          URL.revokeObjectURL(url);
                        }}
                        style={{ border: `1px solid ${colors.border}`, background: "#fff", color: colors.text, borderRadius: 10, padding: "8px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Download companies
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const blob = await accountSourcingApi.exportContactsCsv({ batchId: batch.id });
                          const url = URL.createObjectURL(blob);
                          const anchor = document.createElement("a");
                          anchor.href = url;
                          anchor.download = `${batch.filename.replace(/\s+/g, "-").toLowerCase()}-contacts.csv`;
                          anchor.click();
                          URL.revokeObjectURL(url);
                        }}
                        style={{ border: `1px solid ${colors.border}`, background: "#fff", color: colors.text, borderRadius: 10, padding: "8px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Download contacts
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                    {[
                      { label: "Status", value: batch.status.replace(/_/g, " "), hint: batch.progress_message || "Activity tracked automatically" },
                      { label: "Accounts", value: `${batch.created_companies}`, hint: `${batch.processed_rows}/${batch.total_rows} processed` },
                      { label: "Contacts", value: `${batch.contacts_found ?? 0}`, hint: "Relevant stakeholders saved" },
                      { label: "Verdicts", value: `${String((batch.verdict_summary || {}).target || 0)} target`, hint: String((batch.verdict_summary || {}).message || "No uploaded verdicts") },
                    ].map((item) => (
                      <div key={`${batch.id}-${item.label}`} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 14px", background: "#fbfdff" }}>
                        <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>{item.label.toUpperCase()}</div>
                        <div style={{ marginTop: 6, color: colors.text, fontSize: 18, fontWeight: 800 }}>{item.value}</div>
                        <div style={{ marginTop: 4, color: colors.sub, fontSize: 12, lineHeight: 1.45 }}>{item.hint}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {successModal ? (
          <>
            <div
              onClick={() => setSuccessModal(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.24)", zIndex: 50 }}
            />
            <div
              style={{
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 460,
                maxWidth: "92vw",
                background: "#fff",
                borderRadius: 18,
                boxShadow: "0 20px 60px rgba(15,23,42,0.18)",
                padding: "24px 24px 20px",
                zIndex: 51,
                display: "grid",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <CheckCircle2 size={18} color={colors.green} />
                  <div style={{ color: colors.text, fontWeight: 800, fontSize: 18 }}>{successModal.title}</div>
                </div>
                <button type="button" onClick={() => setSuccessModal(null)} style={{ border: 0, background: "transparent", cursor: "pointer", color: colors.faint }}>
                  <X size={18} />
                </button>
              </div>
              <div style={{ color: colors.sub, fontSize: 14, lineHeight: 1.6 }}>{successModal.message}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setSuccessModal(null)} style={{ border: 0, background: colors.primary, color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 700, cursor: "pointer" }}>
                  Continue
                </button>
              </div>
            </div>
          </>
        ) : null}

        {pendingBatchApproval ? (
          <>
            <div
              onClick={() => setPendingBatchApproval(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.24)", zIndex: 50 }}
            />
            <div
              style={{
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 520,
                maxWidth: "94vw",
                background: "#fff",
                borderRadius: 18,
                boxShadow: "0 20px 60px rgba(15,23,42,0.18)",
                padding: "24px",
                zIndex: 51,
                display: "grid",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ color: colors.text, fontSize: 18, fontWeight: 800 }}>Review TAL verdicts</div>
                  <div style={{ color: colors.sub, fontSize: 13, marginTop: 4 }}>{pendingBatchApproval.filename}</div>
                </div>
                <button type="button" onClick={() => setPendingBatchApproval(null)} style={{ border: 0, background: "transparent", cursor: "pointer", color: colors.faint }}>
                  <X size={18} />
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                {[
                  { label: "Target", value: String((pendingBatchApproval.verdict_summary || {}).target || 0) },
                  { label: "Watch", value: String((pendingBatchApproval.verdict_summary || {}).watch || 0) },
                  { label: "Non-target", value: String((pendingBatchApproval.verdict_summary || {}).non_target || 0) },
                  { label: "Unknown", value: String((pendingBatchApproval.verdict_summary || {}).unknown || 0) },
                ].map((item) => (
                  <div key={item.label} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 10px", background: "#fbfdff", textAlign: "center" }}>
                    <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>{item.label.toUpperCase()}</div>
                    <div style={{ marginTop: 6, color: colors.text, fontSize: 18, fontWeight: 800 }}>{item.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ color: colors.sub, fontSize: 14, lineHeight: 1.6 }}>
                {String((pendingBatchApproval.verdict_summary || {}).message || "Some imported rows need approval before enrichment starts.")}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={confirmingBatchId === pendingBatchApproval.id}
                  onClick={async () => {
                    setConfirmingBatchId(pendingBatchApproval.id);
                    try {
                      await accountSourcingApi.cancelBatch(pendingBatchApproval.id);
                      setPendingBatchApproval(null);
                      await load();
                    } finally {
                      setConfirmingBatchId("");
                    }
                  }}
                  style={{ border: `1px solid ${colors.border}`, background: "#fff", color: colors.text, borderRadius: 10, padding: "9px 14px", fontWeight: 700, cursor: "pointer" }}
                >
                  Cancel enrichment
                </button>
                <button
                  type="button"
                  disabled={confirmingBatchId === pendingBatchApproval.id}
                  onClick={async () => {
                    setConfirmingBatchId(pendingBatchApproval.id);
                    try {
                      await accountSourcingApi.confirmBatch(pendingBatchApproval.id, true);
                      setPendingBatchApproval(null);
                      setSuccessModal({
                        title: "Enrichment started",
                        message: "Beacon has started enriching the approved import.",
                      });
                      await load();
                    } finally {
                      setConfirmingBatchId("");
                    }
                  }}
                  style={{ border: 0, background: colors.primary, color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 700, cursor: "pointer", minWidth: 160 }}
                >
                  {confirmingBatchId === pendingBatchApproval.id ? "Starting..." : "Continue enrichment"}
                </button>
              </div>
            </div>
          </>
        ) : null}

        {showCreateModal ? (
          <>
            <div onClick={() => setShowCreateModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.24)", zIndex: 50 }} />
            <div
              style={{
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 500,
                maxWidth: "94vw",
                background: "#fff",
                borderRadius: 18,
                boxShadow: "0 20px 60px rgba(15,23,42,0.18)",
                padding: "24px",
                zIndex: 51,
                display: "grid",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ color: colors.text, fontSize: 18, fontWeight: 800 }}>Add accounts manually</div>
                <button type="button" onClick={() => setShowCreateModal(false)} style={{ border: 0, background: "transparent", cursor: "pointer", color: colors.faint }}>
                  <X size={18} />
                </button>
              </div>
              <div style={{ color: colors.sub, fontSize: 14, lineHeight: 1.6 }}>
                Paste one company per line. You can optionally add a website or domain after a comma or pipe. Beacon will log who created each one and when.
              </div>
              <div
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                  background: "#fbfdff",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>FORMAT</div>
                <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.6 }}>
                  One per line.
                  <br />
                  `BlackLine`
                  <br />
                  `Serrala, serrala.com`
                  <br />
                  `Netcore Cloud | netcorecloud.com`
                </div>
              </div>
              <textarea
                value={createForm.companiesText}
                onChange={(e) => setCreateForm({ companiesText: e.target.value })}
                placeholder={"BlackLine\nSerrala, serrala.com\nNetcore Cloud | netcorecloud.com"}
                rows={8}
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: 10,
                  padding: "12px",
                  fontSize: 14,
                  color: colors.text,
                  resize: "vertical",
                  minHeight: 180,
                  lineHeight: 1.6,
                }}
              />
              {createError ? <div style={{ color: colors.red, fontSize: 13, fontWeight: 700 }}>{createError}</div> : null}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button type="button" onClick={() => setShowCreateModal(false)} style={{ border: `1px solid ${colors.border}`, background: "#fff", color: colors.text, borderRadius: 10, padding: "9px 14px", fontWeight: 700, cursor: "pointer" }}>
                  Close
                </button>
                <button type="button" disabled={creatingCompany} onClick={() => void handleCreateCompany()} style={{ border: 0, background: colors.primary, color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 700, cursor: "pointer", minWidth: 140 }}>
                  {creatingCompany ? "Creating..." : "Create & enrich"}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
