import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BookOpen,
  BriefcaseBusiness,
  CalendarCheck2,
  CheckCircle2,
  ChartColumnBig,
  Compass,
  KanbanSquare,
  Radar,
  Search,
  Swords,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  workspaceApi,
  type WorkspaceAlert,
  type WorkspaceSummary,
} from "../lib/api";

type Stage = {
  label: string;
  to: string;
  hint: string;
  statLabel: string;
  getValue: (m: WorkspaceSummary) => number;
  icon: LucideIcon;
};

const STAGES: Stage[] = [
  {
    label: "Pipeline",
    to: "/pipeline",
    hint: "Track and prioritize all opportunities in flight.",
    statLabel: "open deals",
    getValue: (m) => m.open_deals,
    icon: KanbanSquare,
  },
  {
    label: "Account Sourcing",
    to: "/account-sourcing",
    hint: "Build and qualify your target account list.",
    statLabel: "accounts",
    getValue: (m) => m.total_companies,
    icon: Search,
  },
  {
    label: "Prospecting",
    to: "/prospecting",
    hint: "Find decision-makers and activate outreach.",
    statLabel: "contacts",
    getValue: (m) => m.total_contacts,
    icon: Radar,
  },
  {
    label: "Pre-Meeting Assistance",
    to: "/pre-meeting-assistance",
    hint: "Prepare pre-briefs and contextual account intelligence.",
    statLabel: "scheduled meetings",
    getValue: (m) => m.scheduled_meetings,
    icon: Compass,
  },
  {
    label: "Custom-Demo Assistance",
    to: "/custom-demo-assistance",
    hint: "Tailor demo strategy to the account and buying committee.",
    statLabel: "scheduled meetings",
    getValue: (m) => m.scheduled_meetings,
    icon: BriefcaseBusiness,
  },
  {
    label: "Live-Meeting Assistance",
    to: "/live-meeting-assistance",
    hint: "Access battle-tested responses in real time.",
    statLabel: "battlecard flow",
    getValue: () => 1,
    icon: Swords,
  },
  {
    label: "Knowledge Base",
    to: "/knowledge-base",
    hint: "Upload ROI templates, case studies, and sales resources that power AI across all modules.",
    statLabel: "resources",
    getValue: () => 1,
    icon: BookOpen,
  },
  {
    label: "CRM- Insights and Alerts",
    to: "/crm-insights-alerts",
    hint: "Spot performance trends, risks, and momentum changes.",
    statLabel: "alerts center",
    getValue: () => 1,
    icon: ChartColumnBig,
  },
];

const SEVERITY_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  high: { bg: "#fff5f5", text: "#c0392b", border: "#f5c6c6" },
  medium: { bg: "#fffbf0", text: "#8a6a1a", border: "#f0d9a8" },
  low: { bg: "#f4f8ff", text: "#2c5fa8", border: "#c5d9f5" },
};

const ALERT_TYPE_LABEL: Record<string, string> = {
  stale_deal: "Stale Deal",
  at_risk: "At Risk",
  missing_close_date: "Missing Close Date",
  deal_no_next_step: "Next Step Missing",
  no_contacts: "No Contacts",
  no_pre_brief: "No Pre-Brief",
  no_next_steps: "No Next Steps",
  hot_prospect: "Hot Prospect",
  cooling_sequence: "Cooling Sequence",
  research_blocker: "Research Blocker",
};

const styles: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    padding: "8px 2px 18px",
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #e2eaf3",
    borderRadius: 16,
    boxShadow: "0 8px 28px rgba(18, 44, 70, 0.06)",
  },
  headerPanel: {
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  title: {
    margin: 0,
    fontSize: 30,
    fontWeight: 800,
    color: "#25384d",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    margin: 0,
    color: "#607589",
    fontSize: 14,
    lineHeight: 1.6,
    maxWidth: 840,
  },
  progressTrack: {
    marginTop: 2,
    height: 10,
    borderRadius: 999,
    background: "#edf2f8",
    overflow: "hidden",
  },
  cardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: 16,
  },
  stageCard: {
    ...{
      background: "#ffffff",
      border: "1px solid #e2eaf3",
      borderRadius: 16,
      boxShadow: "0 8px 28px rgba(18, 44, 70, 0.06)",
    },
    padding: 20,
    textDecoration: "none",
    color: "inherit",
    display: "block",
  },
  stageHeading: {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    color: "#2c4258",
  },
  stageHint: {
    margin: "8px 0 0",
    fontSize: 13,
    lineHeight: 1.55,
    color: "#6f8296",
  },
  alertsHeader: {
    padding: "14px 20px",
    borderBottom: "1px solid #e3eaf3",
    background: "#f9fbfe",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  footerTip: {
    ...{
      background: "#ffffff",
      border: "1px solid #e2eaf3",
      borderRadius: 16,
      boxShadow: "0 8px 28px rgba(18, 44, 70, 0.06)",
    },
    padding: "16px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  },
  primaryAction: {
    background: "#ff6b35",
    border: "1px solid #ff6b35",
    color: "white",
    borderRadius: 10,
    textDecoration: "none",
    fontWeight: 700,
    padding: "9px 14px",
    fontSize: 13,
  },
};

export default function SalesWorkspace() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [alerts, setAlerts] = useState<WorkspaceAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  useEffect(() => {
    workspaceApi
      .summary()
      .then(setSummary)
      .finally(() => setLoading(false));

    workspaceApi
      .alerts()
      .then(setAlerts)
      .finally(() => setAlertsLoading(false));
  }, []);

  const stageProgress = useMemo(() => {
    if (!summary) return 0;
    const active = STAGES.filter((s) => s.getValue(summary) > 0).length;
    return Math.round((active / STAGES.length) * 100);
  }, [summary]);

  const visibleAlerts = showAllAlerts ? alerts : alerts.slice(0, 4);

  return (
    <div style={styles.page}>
      <div style={{ ...styles.panel, ...styles.headerPanel }}>
        <p style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: "#6a7c8f", fontWeight: 700 }}>
          Execution Flow
        </p>
        <h2 style={styles.title}>Sales Workspace</h2>
        <p style={styles.subtitle}>
          One command center for the full GTM cycle from pipeline visibility to meeting execution and CRM-driven alerts.
        </p>
        <div style={styles.progressTrack}>
          <div
            style={{
              height: "100%",
              background: "#ff6b35",
              width: `${stageProgress}%`,
              transition: "width 300ms ease",
            }}
          />
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "#6a7c8f" }}>Workflow coverage: {stageProgress}%</p>
      </div>

      {loading ? (
        <div style={{ ...styles.panel, padding: "36px 20px", textAlign: "center", color: "#7a8ea4", fontSize: 14 }}>
          Loading workspace telemetry...
        </div>
      ) : (
        <div style={styles.cardsGrid}>
          {STAGES.map((stage) => {
            const Icon = stage.icon;
            const value = summary ? stage.getValue(summary) : 0;
            const isActive = value > 0;

            return (
              <Link key={stage.label} to={stage.to} style={styles.stageCard}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <p style={styles.stageHeading}>{stage.label}</p>
                    <p style={styles.stageHint}>{stage.hint}</p>
                  </div>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: "#f5f8fc",
                      border: "1px solid #e4ebf3",
                      display: "grid",
                      placeItems: "center",
                      color: "#3a536d",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={17} />
                  </div>
                </div>
                <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p style={{ margin: 0, fontSize: 12, color: "#74889c" }}>{stage.statLabel}</p>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#2a3f54" }}>{value}</p>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontWeight: 700,
                    color: isActive ? "#ff6b35" : "#96a7ba",
                  }}
                >
                  {isActive ? (
                    <>
                      <CheckCircle2 size={12} /> Active
                    </>
                  ) : (
                    <>
                      <XCircle size={12} /> Needs setup
                    </>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div style={{ ...styles.panel, overflow: "hidden" }}>
        <div style={styles.alertsHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={15} style={{ color: "#c0392b" }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#2b3f55" }}>CRM Alerts</h3>
            {!alertsLoading && alerts.length > 0 && (
              <span
                style={{
                  marginLeft: 4,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  background: "#fff5f5",
                  border: "1px solid #f5c6c6",
                  color: "#c0392b",
                }}
              >
                {alerts.length}
              </span>
            )}
          </div>
          <Link to="/crm-insights-alerts" style={{ fontSize: 12, color: "#ff6b35", fontWeight: 700, textDecoration: "none" }}>
            View all
          </Link>
        </div>

        {alertsLoading ? (
          <div style={{ padding: "30px 20px", textAlign: "center", fontSize: 13, color: "#96a7ba" }}>Scanning for issues...</div>
        ) : alerts.length === 0 ? (
          <div style={{ padding: "30px 20px", textAlign: "center" }}>
            <CheckCircle2 size={24} style={{ color: "#27ae60", margin: "0 auto 8px" }} />
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#2b3f55" }}>No alerts, workspace is healthy</p>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#96a7ba" }}>All deals, accounts, and meetings are on track.</p>
          </div>
        ) : (
          <>
            <div style={{ borderTop: "1px solid #edf2f8" }}>
              {visibleAlerts.map((alert) => {
                const sev = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.low;
                const typeLabel = ALERT_TYPE_LABEL[alert.type] ?? alert.type;
                const content = (
                  <div
                    key={alert.id}
                    style={{
                      padding: "14px 20px",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      background: sev.bg,
                      borderBottom: "1px solid #edf2f8",
                    }}
                  >
                    <AlertTriangle size={15} style={{ color: sev.text, marginTop: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.07em",
                            padding: "2px 8px",
                            borderRadius: 999,
                            border: `1px solid ${sev.border}`,
                            background: "white",
                            color: sev.text,
                          }}
                        >
                          {typeLabel}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#2b3f55" }}>{alert.title}</span>
                      </div>
                      <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6a7c8f", lineHeight: 1.55 }}>{alert.description}</p>
                    </div>
                    {alert.link && <span style={{ fontSize: 12, fontWeight: 700, color: sev.text, flexShrink: 0 }}>Fix</span>}
                  </div>
                );

                return alert.link ? (
                  <Link key={alert.id} to={alert.link} style={{ display: "block", textDecoration: "none" }}>
                    {content}
                  </Link>
                ) : (
                  <div key={alert.id}>{content}</div>
                );
              })}
            </div>
            {alerts.length > 4 && (
              <div style={{ padding: "10px 20px", borderTop: "1px solid #edf2f8", background: "#f9fbfe", textAlign: "center" }}>
                <button
                  onClick={() => setShowAllAlerts((v) => !v)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#ff6b35",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {showAllAlerts ? "Show fewer" : `Show ${alerts.length - 4} more alerts`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div style={styles.footerTip}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#2b4056" }}>
          <CalendarCheck2 size={16} />
          <p style={{ margin: 0, fontSize: 13 }}>
            Tip: Start from account sourcing before triggering outreach and meeting workflows.
          </p>
        </div>
        <Link to="/pipeline" style={styles.primaryAction}>
          Open Pipeline
        </Link>
      </div>
    </div>
  );
}
