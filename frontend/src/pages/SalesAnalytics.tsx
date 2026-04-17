import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarRange,
  Check,
  ChevronDown,
  LoaderCircle,
  Search,
  Sigma,
  TrendingUp,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  analyticsApi,
  authApi,
  type MonthlyUniqueFunnelRow,
  type SalesDashboard,
  type SalesForecastRow,
  type SalesFunnelStep,
  type SalesPipelineOwnerRow,
  type MilestoneDealRow,
  type SalesRepActivityRow,
  type SalesStageBucket,
  type SalesVelocityRow,
} from "../lib/api";
import type { User } from "../types";
import { useAuth } from "../lib/AuthContext";

const WINDOW_OPTIONS = [30, 90, 180] as const;
const GEO_OPTIONS = ["all", "Americas", "India", "APAC", "Rest of World"] as const;
const DEVELOPER_EMAILS = new Set(["sarthak@beacon.li"]);

function isDeveloperUser(user?: Pick<User, "email" | "name"> | null) {
  if (!user) return false;
  const email = (user.email || "").trim().toLowerCase();
  const name = (user.name || "").trim().toLowerCase();
  return DEVELOPER_EMAILS.has(email) || name === "sarthak aitha";
}

function formatShortCurrency(value?: number | null) {
  const amount = Number(value ?? 0);
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}k`;
  return `$${Math.round(amount)}`;
}

function formatSnapshotTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatCurrency(val: number | null | undefined): string {
  if (!val) return "—";
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toLocaleString()}`;
}

function MetricCard({
  label,
  value,
  hint,
  tone,
  icon: Icon,
  deals,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "blue" | "green" | "amber" | "red";
  icon: LucideIcon;
  deals?: MilestoneDealRow[];
}) {
  const [open, setOpen] = useState(false);
  const palette = {
    blue: { bg: "linear-gradient(135deg, #f7faff 0%, #eef4ff 100%)", border: "#d8e4fb", icon: "#4261d6", text: "#29446d" },
    green: { bg: "linear-gradient(135deg, #f7fff9 0%, #ecf9f1 100%)", border: "#cdecd9", icon: "#2b8a5d", text: "#25473a" },
    amber: { bg: "linear-gradient(135deg, #fffdf7 0%, #fff5de 100%)", border: "#efdcb1", icon: "#b7791f", text: "#5d4523" },
    red: { bg: "linear-gradient(135deg, #fff8f8 0%, #fff0f0 100%)", border: "#efcccc", icon: "#cc5d5d", text: "#6d3434" },
  }[tone];

  const hasDeals = deals && deals.length > 0;

  return (
    <div
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 18,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        minHeight: 146,
        boxShadow: "0 12px 32px rgba(23, 43, 77, 0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: palette.text, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
        <button
          type="button"
          onClick={() => hasDeals && setOpen((v) => !v)}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background: open ? palette.icon : "#fff",
            border: `1px solid ${palette.border}`,
            display: "grid",
            placeItems: "center",
            color: open ? "#fff" : palette.icon,
            flexShrink: 0,
            cursor: hasDeals ? "pointer" : "default",
            transition: "background 0.15s, color 0.15s",
          }}
          title={hasDeals ? "View deals" : undefined}
        >
          <Icon size={17} />
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 31, lineHeight: 1, fontWeight: 800, color: "#1d2b3a" }}>{value}</p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "#62748a" }}>{hint}</p>
      </div>
      {open && hasDeals && (
        <div style={{ borderTop: `1px solid ${palette.border}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {deals.map((d, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 700, color: "#1d2b3a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.deal_name || d.company_name || "Unknown deal"}
                </span>
                <span style={{ color: "#62748a" }}>
                  {d.close_date_est ? `Close: ${d.close_date_est}` : `Reached: ${d.reached_at}`}
                </span>
              </div>
              <span style={{ fontWeight: 700, color: palette.icon, flexShrink: 0 }}>
                {formatCurrency(d.deal_value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      className="crm-panel"
      style={{
        padding: 22,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        minHeight: 100,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#203244" }}>{title}</h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "#6d7f93", maxWidth: 700 }}>{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function HighlightsCard({ highlights }: { highlights: string[] }) {
  return (
    <SectionCard
      title="Beacon Readout"
      subtitle="A quick operating narrative built from the live dashboard so managers can see the signal before drilling into charts."
      action={
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 999, background: "#f6f0ff", border: "1px solid #e7d8ff", color: "#6643b5", fontSize: 12, fontWeight: 700 }}>
          <Sigma size={14} />
          Operating summary
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
        {highlights.map((item, index) => (
          <div
            key={`${index}-${item}`}
            style={{
              borderRadius: 16,
              border: "1px solid #ece7fb",
              background: "linear-gradient(180deg, #fff 0%, #fbf9ff 100%)",
              padding: 16,
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
            }}
          >
            <div style={{ width: 28, height: 28, borderRadius: 10, background: "#f3edff", color: "#7556cb", display: "grid", placeItems: "center", flexShrink: 0, marginTop: 2 }}>
              <ArrowUpRight size={14} />
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#2d4055" }}>{item}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function RepActivityTable({ rows }: { rows: SalesRepActivityRow[] }) {
  if (rows.length === 0) {
    return <p className="crm-muted" style={{ margin: 0 }}>No rep activity yet for this time range.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((row, index) => (
        <div
          key={row.key}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(140px, 2fr) repeat(5, minmax(64px, 1fr))",
            gap: 10,
            alignItems: "center",
            padding: "14px 16px",
            borderRadius: 15,
            border: "1px solid #e7edf5",
            background: index === 0 ? "linear-gradient(135deg, #fffdf8 0%, #fff6e9 100%)" : "#fff",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#223446", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.rep_name}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#708195" }}>{row.active_deals} active deals • {formatShortCurrency(row.pipeline_amount)} pipeline</p>
          </div>
          <StatPill label="Calls" value={row.calls} tone="#eef3ff" text="#445fd0" />
          <StatPill label="Emails" value={row.emails} tone="#eefbf2" text="#2f8d5d" />
          <StatPill label="Meetings" value={row.meetings} tone="#fff4ea" text="#c16a18" />
          <StatPill label="Touches" value={row.total} tone="#faf1ff" text="#8052be" />
          <StatPill label="Rank" value={index + 1} tone="#f5f7fb" text="#5a697e" />
        </div>
      ))}
    </div>
  );
}

function StatPill({ label, value, tone, text }: { label: string; value: string | number; tone: string; text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", padding: "10px 8px", borderRadius: 12, background: tone }}>
      <span style={{ fontSize: 16, fontWeight: 800, color: text, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: text, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
    </div>
  );
}

function PipelineStageView({ rows }: { rows: SalesStageBucket[] }) {
  const maxAmount = useMemo(() => Math.max(...rows.map((row) => row.amount), 1), [rows]);

  if (rows.length === 0) {
    return <p className="crm-muted" style={{ margin: 0 }}>No open pipeline to chart yet.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {rows.map((row) => (
        <div key={row.key} style={{ display: "grid", gridTemplateColumns: "minmax(160px, 1fr) minmax(180px, 3fr) auto", gap: 12, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#203244", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.label}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#75869a" }}>{row.deal_count} deals</p>
          </div>
          <div style={{ height: 14, borderRadius: 999, background: "#edf2f8", overflow: "hidden" }}>
            <div style={{ width: `${Math.max((row.amount / maxAmount) * 100, row.amount > 0 ? 8 : 0)}%`, height: "100%", borderRadius: 999, background: row.color }} />
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#203244" }}>{formatShortCurrency(row.amount)}</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#75869a" }}>{formatShortCurrency(row.weighted_amount)} weighted</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PipelineOwnerView({ rows }: { rows: SalesPipelineOwnerRow[] }) {
  if (rows.length === 0) {
    return <p className="crm-muted" style={{ margin: 0 }}>No rep-owned pipeline to chart yet.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {rows.map((row) => (
        <div key={row.key} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) minmax(180px, 3fr) auto", gap: 12, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#213547", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.rep_name}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#76879b" }}>{row.deal_count} deals</p>
          </div>
          <div style={{ height: 16, borderRadius: 999, background: "#eef2f8", overflow: "hidden", display: "flex" }}>
            {row.stages.map((stage) => {
              const width = row.amount > 0 ? `${(stage.amount / row.amount) * 100}%` : "0%";
              return <div key={stage.key} title={`${stage.label}: ${formatShortCurrency(stage.amount)}`} style={{ width, background: stage.color, minWidth: stage.amount > 0 ? 8 : 0 }} />;
            })}
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#203244" }}>{formatShortCurrency(row.amount)}</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#75869a" }}>{formatShortCurrency(row.weighted_amount)} weighted</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function VelocityView({ rows }: { rows: SalesVelocityRow[] }) {
  const maxDays = useMemo(() => Math.max(...rows.map((row) => row.average_days_in_stage), 1), [rows]);

  if (rows.length === 0) {
    return <p className="crm-muted" style={{ margin: 0 }}>No stage velocity data yet.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {rows.map((row) => (
        <div key={row.key} style={{ display: "grid", gridTemplateColumns: "minmax(170px, 1fr) minmax(180px, 3fr) auto", gap: 12, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#203244", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.label}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#76879b" }}>{row.deal_count} deals • {row.stale_deals} stale</p>
          </div>
          <div style={{ height: 12, borderRadius: 999, background: "#edf2f8", overflow: "hidden" }}>
            <div style={{ width: `${Math.max((row.average_days_in_stage / maxDays) * 100, row.average_days_in_stage > 0 ? 8 : 0)}%`, height: "100%", borderRadius: 999, background: row.color }} />
          </div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#203244", textAlign: "right" }}>{row.average_days_in_stage.toFixed(1)}d</p>
        </div>
      ))}
    </div>
  );
}

function ForecastView({ rows }: { rows: SalesForecastRow[] }) {
  const maxWeighted = useMemo(() => Math.max(...rows.map((row) => row.weighted_amount), 1), [rows]);

  if (rows.length === 0) {
    return <p className="crm-muted" style={{ margin: 0 }}>No dated pipeline yet. Add close dates to unlock forecast timing.</p>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(Math.max(rows.length, 1), 6)}, minmax(90px, 1fr))`, gap: 14, alignItems: "end" }}>
      {rows.map((row) => (
        <div key={row.key} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ height: 180, display: "flex", alignItems: "flex-end" }}>
            <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 8 }}>
              <div style={{ height: `${Math.max((row.amount / Math.max(...rows.map((item) => item.amount), 1)) * 140, row.amount > 0 ? 18 : 0)}px`, borderRadius: 14, background: "#dbe7ff" }} />
              <div style={{ height: `${Math.max((row.weighted_amount / maxWeighted) * 140, row.weighted_amount > 0 ? 18 : 0)}px`, borderRadius: 14, background: "#4e6be6" }} />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: "#223547" }}>{row.label}</p>
            <p style={{ margin: 0, fontSize: 11, color: "#6d7f93" }}>{formatShortCurrency(row.amount)} raw</p>
            <p style={{ margin: 0, fontSize: 11, color: "#4e6be6", fontWeight: 700 }}>{formatShortCurrency(row.weighted_amount)} weighted</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function FunnelView({ steps }: { steps: SalesFunnelStep[] }) {
  const maxCount = useMemo(() => Math.max(...steps.map((step) => step.count), 1), [steps]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
      {steps.map((step, index) => (
        <div key={step.key} style={{ borderRadius: 16, border: "1px solid #e7edf6", background: "#fff", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ height: 110, display: "flex", alignItems: "flex-end" }}>
            <div style={{ width: "100%", height: `${Math.max((step.count / maxCount) * 100, step.count > 0 ? 18 : 0)}%`, borderRadius: 16, background: index === steps.length - 1 ? "linear-gradient(180deg, #58c18a 0%, #2f995f 100%)" : "linear-gradient(180deg, #6983ec 0%, #435ed8 100%)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: "#223547", textTransform: "uppercase", letterSpacing: "0.06em" }}>{step.label}</p>
            <p style={{ margin: 0, fontSize: 28, lineHeight: 1, fontWeight: 800, color: "#1e2f41" }}>{step.count}</p>
            <p style={{ margin: 0, fontSize: 12, color: "#718196" }}>
              {step.conversion_from_previous == null ? "Base stage" : `${step.conversion_from_previous}% from previous`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function MonthlyUniqueFunnelView({ rows }: { rows: MonthlyUniqueFunnelRow[] }) {
  const maxCount = useMemo(
    () => Math.max(
      ...rows.flatMap((row) => [row.demo_done, row.poc_agreed, row.poc_wip, row.poc_done, row.closed_won]),
      1,
    ),
    [rows],
  );

  const series = [
    { key: "demo_done" as const, label: "Demo Done", color: "#4e6be6" },
    { key: "poc_agreed" as const, label: "POC Agreed", color: "#7c3aed" },
    { key: "poc_wip" as const, label: "POC WIP", color: "#17a2b8" },
    { key: "poc_done" as const, label: "POC Done", color: "#2fa56b" },
    { key: "closed_won" as const, label: "Closed Won", color: "#d58b2a" },
  ];

  if (rows.length === 0) {
    return <p className="crm-muted" style={{ margin: 0 }}>No milestone history available yet.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 12, color: "#6e8095" }}>
        {series.map((item) => (
          <span key={item.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 860 }}>
          {rows.map((row) => (
            <div key={row.month_key} style={{ display: "grid", gridTemplateColumns: "110px repeat(5, minmax(110px, 1fr))", gap: 12, alignItems: "center" }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#213547" }}>{row.label}</p>
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "#73849a" }}>Unique companies</p>
              </div>
              {series.map((item) => {
                const value = row[item.key];
                return (
                  <div key={item.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#6d7f93" }}>{item.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#213547" }}>{value}</span>
                    </div>
                    <div style={{ height: 10, borderRadius: 999, background: "#edf2f8", overflow: "hidden" }}>
                      <div style={{ width: `${Math.max((value / maxCount) * 100, value > 0 ? 8 : 0)}%`, height: "100%", borderRadius: 999, background: item.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface MultiSelectOption {
  value: string;
  label: string;
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = useMemo(
    () =>
      query.trim()
        ? options.filter((opt) => opt.label.toLowerCase().includes(query.toLowerCase()))
        : options,
    [options, query],
  );

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const displayText =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? placeholder
        : `${selected.length} selected`;

  return (
    <div style={{ display: "grid", gap: 8 }} ref={ref}>
      <label style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7a8ca0" }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => { setOpen((o) => !o); setQuery(""); }}
          style={{
            width: "100%",
            height: 40,
            borderRadius: 12,
            border: selected.length > 0 ? "1px solid #b8cff7" : "1px solid #d9e3ef",
            background: selected.length > 0 ? "#eef4ff" : "#fff",
            color: selected.length > 0 ? "#2948b9" : "#203244",
            fontSize: 13,
            fontWeight: 700,
            padding: "0 36px 0 12px",
            textAlign: "left",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {displayText}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            {selected.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onChange([]); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange([]); } }}
                style={{ display: "flex", alignItems: "center", color: "#5878be", cursor: "pointer" }}
              >
                <X size={13} />
              </span>
            )}
            <ChevronDown size={14} style={{ color: "#7a8ca0", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </div>
        </button>
        {open && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              zIndex: 50,
              background: "#fff",
              border: "1px solid #dde8f4",
              borderRadius: 14,
              boxShadow: "0 8px 28px rgba(20,50,80,0.12)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "8px 10px", borderBottom: "1px solid #edf2f8", display: "flex", alignItems: "center", gap: 8 }}>
              <Search size={13} style={{ color: "#94a8be", flexShrink: 0 }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  fontSize: 13,
                  color: "#203244",
                  background: "transparent",
                }}
              />
            </div>
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {filtered.length === 0 ? (
                <p style={{ margin: 0, padding: "12px 14px", fontSize: 13, color: "#94a8be" }}>No results</p>
              ) : (
                filtered.map((opt) => {
                  const isSelected = selected.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggle(opt.value)}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        border: "none",
                        background: isSelected ? "#f0f5ff" : "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 13,
                        fontWeight: isSelected ? 700 : 500,
                        color: isSelected ? "#2948b9" : "#2e4260",
                      }}
                    >
                      <span style={{
                        width: 18, height: 18, borderRadius: 6, border: isSelected ? "none" : "1.5px solid #c8d8ea",
                        background: isSelected ? "#3f5fd4" : "#fff",
                        display: "grid", placeItems: "center", flexShrink: 0,
                      }}>
                        {isSelected && <Check size={11} style={{ color: "#fff" }} />}
                      </span>
                      {opt.label}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SalesAnalytics() {
  const { user } = useAuth();
  const [windowDays, setWindowDays] = useState<(typeof WINDOW_OPTIONS)[number]>(90);
  const [pipelineView, setPipelineView] = useState<"stage" | "rep">("stage");
  const [teamUsers, setTeamUsers] = useState<User[]>([]);
  const [repFilter, setRepFilter] = useState<string[]>([]);
  const [geographyFilter, setGeographyFilter] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [data, setData] = useState<SalesDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // When a custom date range is set, window buttons are ignored
  const usingCustomRange = !!(fromDate && toDate);
  const hideDeveloper = isDeveloperUser(user);

  const visibleTeamUsers = useMemo(
    () => (hideDeveloper ? teamUsers.filter((teamUser) => !isDeveloperUser(teamUser)) : teamUsers),
    [hideDeveloper, teamUsers],
  );

  const selectedRepNames = useMemo(
    () => repFilter.map((id) => visibleTeamUsers.find((u) => u.id === id)?.name ?? id),
    [repFilter, visibleTeamUsers],
  );

  useEffect(() => {
    authApi
      .listAllUsers()
      .then((users) => {
        setTeamUsers(
          users
            .filter((user) => user.is_active)
            .sort((left, right) => left.name.localeCompare(right.name))
        );
      })
      .catch(() => setTeamUsers([]));
  }, []);

  useEffect(() => {
    if (!hideDeveloper || !user?.id) return;
    setRepFilter((current) => current.filter((id) => id !== user.id));
  }, [hideDeveloper, user?.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    analyticsApi
      .salesDashboard(windowDays, repFilter, geographyFilter, fromDate || undefined, toDate || undefined)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "Failed to load sales analytics");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [windowDays, repFilter, geographyFilter, fromDate, toDate]);

  const metricCards: Array<{
    label: string;
    value: string;
    hint: string;
    tone: "blue" | "green" | "amber" | "red";
    icon: LucideIcon;
    deals?: MilestoneDealRow[];
  }> = data ? [
    {
      label: "Open Pipeline",
      value: formatShortCurrency(data.summary.pipeline_amount),
      hint: `${data.summary.active_deals} active deals currently in play`,
      tone: "blue" as const,
      icon: TrendingUp,
    },
    {
      label: "Weighted Pipeline",
      value: formatShortCurrency(data.summary.weighted_pipeline_amount),
      hint: "Stage-weighted estimate for a more realistic forecast baseline",
      tone: "green" as const,
      icon: BarChart3,
    },
    {
      label: "Forecast Window",
      value: formatShortCurrency(data.summary.forecast_amount),
      hint: `Pipeline scheduled to land inside the next ${data.window_days} days`,
      tone: "amber" as const,
      icon: CalendarRange,
    },
    {
      label: "Average Deal Size",
      value: formatShortCurrency(data.summary.average_deal_size),
      hint: "Average value across active open deals",
      tone: "blue" as const,
      icon: Trophy,
    },
    {
      label: "Overdue Close Dates",
      value: String(data.summary.overdue_close_count),
      hint: "Deals with close dates already in the past",
      tone: data.summary.overdue_close_count > 0 ? "red" : "green" as const,
      icon: AlertTriangle,
    },
    {
      label: "Stale Deals",
      value: String(data.summary.stale_deal_count),
      hint: "Deals sitting in the same stage for 30 days or more",
      tone: data.summary.stale_deal_count > 0 ? "amber" : "green" as const,
      icon: Sigma,
    },
    {
      label: "Demo Done",
      value: String(data.summary.demo_done_count),
      hint: "Unique companies that reached Demo Done for the first time in this window",
      tone: "blue" as const,
      icon: Check,
      deals: (data.summary.milestone_deals ?? []).filter((d) => d.milestone_key === "demo_done"),
    },
    {
      label: "POC Agreed",
      value: String(data.summary.poc_agreed_count),
      hint: "Unique companies that agreed to a POC for the first time in this window",
      tone: "blue" as const,
      icon: ArrowUpRight,
      deals: (data.summary.milestone_deals ?? []).filter((d) => d.milestone_key === "poc_agreed"),
    },
    {
      label: "POC Done",
      value: String(data.summary.poc_done_count),
      hint: "Unique companies that completed a POC for the first time in this window",
      tone: "green" as const,
      icon: Check,
      deals: (data.summary.milestone_deals ?? []).filter((d) => d.milestone_key === "poc_done"),
    },
    {
      label: "Closed Won",
      value: String(data.summary.closed_won_count),
      hint: `${formatShortCurrency(data.summary.closed_won_value)} in won deal value in this window`,
      tone: data.summary.closed_won_count > 0 ? "green" : "blue" as const,
      icon: Trophy,
      deals: (data.summary.milestone_deals ?? []).filter((d) => d.milestone_key === "closed_won"),
    },
    {
      label: "Won Value",
      value: formatShortCurrency(data.summary.closed_won_value),
      hint: `${data.summary.closed_won_count} deals closed won in this window`,
      tone: data.summary.closed_won_value > 0 ? "green" : "blue" as const,
      icon: TrendingUp,
      deals: (data.summary.milestone_deals ?? []).filter((d) => d.milestone_key === "closed_won"),
    },
  ] : [];

  const visibleRepActivity = useMemo(
    () => (!hideDeveloper ? data?.rep_activity ?? [] : (data?.rep_activity ?? []).filter((row) => row.user_id !== user?.id && row.rep_name.toLowerCase() !== "sarthak aitha")),
    [data?.rep_activity, hideDeveloper, user?.id],
  );

  const visiblePipelineByOwner = useMemo(
    () => (!hideDeveloper ? data?.pipeline_by_owner ?? [] : (data?.pipeline_by_owner ?? []).filter((row) => row.user_id !== user?.id && row.rep_name.toLowerCase() !== "sarthak aitha")),
    [data?.pipeline_by_owner, hideDeveloper, user?.id],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "6px 2px 18px" }}>
      <section
        className="crm-panel"
        style={{
          padding: 24,
          background: "radial-gradient(circle at top left, rgba(255, 107, 53, 0.14), transparent 30%), radial-gradient(circle at top right, rgba(76, 107, 230, 0.12), transparent 26%), linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)",
          display: "grid",
          gap: 18,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(300px, 0.8fr)", gap: 18, alignItems: "stretch" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 900 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "#687b92" }}>Revenue Intelligence</p>
            <h2 style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", color: "#1f3144" }}>Sales Analytics Dashboard</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.75, color: "#66788d" }}>
              A manager-friendly read on rep activity, pipeline composition, deal aging, forecast timing, and funnel health. The structure follows the best CRM pattern: summary first, diagnosis second, drilldown last.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 999, background: "#fff3ec", border: "1px solid #ffd5c3", color: "#b85024", fontSize: 12, fontWeight: 800 }}>
                <TrendingUp size={14} />
                Forecast and hygiene in one view
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 999, background: "#eef4ff", border: "1px solid #d7e2fb", color: "#3555c4", fontSize: 12, fontWeight: 800 }}>
                <BarChart3 size={14} />
                Built from live Beacon CRM data
              </span>
            </div>
          </div>
          <div style={{ borderRadius: 22, border: "1px solid #e1e8f2", background: "rgba(255,255,255,0.82)", padding: 18, display: "grid", gap: 14, boxShadow: "0 14px 32px rgba(18,44,70,0.06)" }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6f8195" }}>Snapshot</p>
              <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.7, color: "#5d7288" }}>
                Compare short-term and longer-window signals without leaving the dashboard.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {WINDOW_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setWindowDays(value); setFromDate(""); setToDate(""); }}
                  style={{
                    height: 38,
                    padding: "0 14px",
                    borderRadius: 999,
                    border: !usingCustomRange && value === windowDays ? "1px solid #ffbeab" : "1px solid #d9e3ef",
                    background: !usingCustomRange && value === windowDays ? "#fff1ea" : "#fff",
                    color: !usingCustomRange && value === windowDays ? "#b85024" : "#506378",
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {value}d
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 12, border: usingCustomRange ? "1.5px solid #a5b4fc" : "1px solid #d9e3ef", background: usingCustomRange ? "#eef2ff" : "#fff" }}>
                <CalendarRange size={13} style={{ color: usingCustomRange ? "#4f46e5" : "#94a3b8", flexShrink: 0 }} />
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  style={{ border: "none", background: "transparent", fontSize: 12, fontWeight: 600, color: "#374151", outline: "none", width: 120 }}
                />
                <span style={{ fontSize: 11, color: "#94a3b8" }}>→</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  style={{ border: "none", background: "transparent", fontSize: 12, fontWeight: 600, color: "#374151", outline: "none", width: 120 }}
                />
                {usingCustomRange && (
                  <button type="button" onClick={() => { setFromDate(""); setToDate(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#6366f1", fontSize: 11, fontWeight: 700, padding: 0, lineHeight: 1 }}>✕</button>
                )}
              </div>
            </div>
            <MultiSelectDropdown
              label="Rep filter"
              options={visibleTeamUsers.map((u) => ({ value: u.id, label: u.name }))}
              selected={repFilter}
              onChange={setRepFilter}
              placeholder="All reps"
            />
            <MultiSelectDropdown
              label="Geography"
              options={GEO_OPTIONS.filter((o) => o !== "all").map((o) => ({ value: o, label: o }))}
              selected={geographyFilter}
              onChange={setGeographyFilter}
              placeholder="All geographies"
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              <div style={{ borderRadius: 16, border: "1px solid #e6edf6", background: "#f8fbff", padding: 14 }}>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7a8ca0" }}>Window</p>
                <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 800, color: "#203244" }}>{windowDays}d</p>
              </div>
              <div style={{ borderRadius: 16, border: "1px solid #e6edf6", background: "#f8fbff", padding: 14 }}>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7a8ca0" }}>Updated</p>
                <p style={{ margin: "8px 0 0", fontSize: 14, fontWeight: 800, color: "#203244", lineHeight: 1.4 }}>
                  {loading ? "Refreshing..." : formatSnapshotTime(data?.generated_at) || "Live"}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 999, background: "#f7f9fc", border: "1px solid #e3ebf4", color: "#5e7086", fontSize: 12, fontWeight: 700 }}>
            <CalendarRange size={14} />
            Window: last {windowDays} days
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 999, background: repFilter.length > 0 ? "#eef4ff" : "#f7f9fc", border: repFilter.length > 0 ? "1px solid #d7e2fb" : "1px solid #e3ebf4", color: repFilter.length > 0 ? "#3555c4" : "#5e7086", fontSize: 12, fontWeight: 700 }}>
            <BarChart3 size={14} />
            Scope: {selectedRepNames.length === 0 ? "All reps" : selectedRepNames.length === 1 ? selectedRepNames[0] : `${selectedRepNames.length} reps`}
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 999, background: geographyFilter.length > 0 ? "#eefbf6" : "#f7f9fc", border: geographyFilter.length > 0 ? "1px solid #cdebdc" : "1px solid #e3ebf4", color: geographyFilter.length > 0 ? "#157347" : "#5e7086", fontSize: 12, fontWeight: 700 }}>
            <CalendarRange size={14} />
            Geography: {geographyFilter.length === 0 ? "All" : geographyFilter.length === 1 ? geographyFilter[0] : `${geographyFilter.length} regions`}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "#74869c" }}>
            {loading ? "Refreshing dashboard..." : `Snapshot updated ${formatSnapshotTime(data?.generated_at)}`}
          </p>
        </div>
      </section>

      {error && (
        <div className="crm-panel" style={{ padding: 18, border: "1px solid #f0d2d2", background: "#fff7f7", color: "#b45454" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="crm-panel" style={{ padding: "46px 20px", display: "grid", placeItems: "center", color: "#6f8095", gap: 10 }}>
          <LoaderCircle size={22} className="spin" />
          <span>Loading sales analytics...</span>
        </div>
      ) : !data ? null : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            {metricCards.map((card) => (
              <MetricCard key={card.label} {...card} />
            ))}
          </div>

          <HighlightsCard highlights={data.highlights} />

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(320px, 1fr)", gap: 18 }}>
            <SectionCard
              title="Rep Activity Leaderboard"
              subtitle="Calls, emails, and meetings aggregated by rep, alongside the amount of live pipeline they currently own."
            >
              <RepActivityTable rows={visibleRepActivity} />
            </SectionCard>

            <SectionCard
              title="Quota Attainment"
              subtitle="This spot is reserved for target-vs-actual reporting once team or rep quotas are configured in Beacon."
            >
              <div style={{ borderRadius: 18, border: "1px dashed #d9e2ef", background: "linear-gradient(180deg, #fbfcfe 0%, #f7f9fc 100%)", padding: 20, minHeight: 220, display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 }}>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1f3246" }}>{data.quota.title}</p>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "#6f8095" }}>{data.quota.message}</p>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "fit-content", padding: "9px 12px", borderRadius: 999, background: "#eef4ff", color: "#4561d5", border: "1px solid #dbe4fb", fontSize: 12, fontWeight: 700 }}>
                  <TrendingUp size={14} />
                  Add quota model in next phase
                </div>
              </div>
            </SectionCard>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 18 }}>
            <SectionCard
              title="Pipeline by Stage"
              subtitle="Use stage totals to inspect composition, or switch to rep view to see how each owner&apos;s pipeline is distributed across stages."
              action={
                <div style={{ display: "inline-flex", borderRadius: 999, border: "1px solid #dde6f0", background: "#f8fafc", padding: 4 }}>
                  {[
                    { key: "stage", label: "By stage" },
                    { key: "rep", label: "By rep" },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setPipelineView(option.key as "stage" | "rep")}
                      style={{
                        height: 34,
                        padding: "0 12px",
                        borderRadius: 999,
                        border: "none",
                        background: pipelineView === option.key ? "#fff" : "transparent",
                        color: pipelineView === option.key ? "#2948b9" : "#5d6f84",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        boxShadow: pipelineView === option.key ? "0 1px 6px rgba(32, 53, 84, 0.08)" : "none",
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            >
              {pipelineView === "stage" ? <PipelineStageView rows={data.pipeline_by_stage} /> : <PipelineOwnerView rows={visiblePipelineByOwner} />}
            </SectionCard>

            <SectionCard
              title="Deal Velocity / Aging"
              subtitle="Average time each stage holds deals, plus how many are already stale enough to deserve a pipeline review."
            >
              <VelocityView rows={data.velocity_by_stage} />
            </SectionCard>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)", gap: 18 }}>
            <SectionCard
              title="Forecast View"
              subtitle="Raw versus weighted pipeline by expected close month so the team can separate ambition from statistically healthier forecast coverage."
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#6e8095" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 999, background: "#dbe7ff" }} /> Raw</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 999, background: "#4e6be6" }} /> Weighted</span>
              </div>
              <ForecastView rows={data.forecast_by_month} />
            </SectionCard>

            <SectionCard
              title="Conversion Funnel"
              subtitle="A volume-based funnel for the current reporting window: lead creation, meetings, proposal-stage deals, and recent closed won outcomes."
            >
              <FunnelView steps={data.conversion_funnel} />
            </SectionCard>
          </div>

          <SectionCard
            title="Monthly Unique Funnel Counts"
            subtitle="Each company is counted once per milestone, based on the first time it reaches Demo Done, POC WIP, POC Done, or Closed Won. Repeats and reschedules do not inflate the count."
          >
            <MonthlyUniqueFunnelView rows={data.monthly_unique_funnel} />
          </SectionCard>
        </>
      )}
    </div>
  );
}
