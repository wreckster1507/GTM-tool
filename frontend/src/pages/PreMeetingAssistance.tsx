import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Filter,
  Loader2,
  MailCheck,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  User,
  Users,
  Zap,
} from "lucide-react";
import { authApi, companiesApi, dealsApi, meetingsApi } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import type { Company, Deal, Meeting, User as UserType } from "../types";
import { formatDate } from "../lib/utils";

const colors = {
  border: "#d9e1ec",
  text: "#1d2b3c",
  sub: "#55657a",
  faint: "#7f8fa5",
  primary: "#1f6feb",
  primarySoft: "#eef5ff",
  green: "#1f8f5f",
  greenSoft: "#e8f8f0",
  violet: "#7a2dd9",
  violetSoft: "#f3eaff",
  amber: "#b56d00",
  amberSoft: "#fff4df",
  orange: "#b94a20",
  orangeSoft: "#fff2ec",
};

function hoursUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.round(diff / (1000 * 60 * 60));
}

function MeetingIntelCard({
  meeting,
  companyName,
  assigneeName,
  onRunIntel,
  runningIntel,
}: {
  meeting: Meeting;
  companyName?: string;
  assigneeName?: string;
  onRunIntel: (id: string) => void;
  runningIntel: string | null;
}) {
  const hours = hoursUntil(meeting.scheduled_at);
  const hasResearch = !!meeting.research_data;
  const hasIntelSent = !!(meeting as any).intel_email_sent_at;
  const isRunning = runningIntel === meeting.id;

  const urgency =
    hours !== null && hours <= 2
      ? "imminent"
      : hours !== null && hours <= 12
      ? "soon"
      : "upcoming";

  const urgencyStyle = {
    imminent: { bg: "#fff2ec", color: colors.orange, border: "#ffd3be", label: "< 2 hrs" },
    soon: { bg: colors.amberSoft, color: colors.amber, border: "#ffe3b3", label: hours !== null ? `${hours}h away` : "" },
    upcoming: { bg: "#f4f7ff", color: "#4b60cf", border: "#d7dffb", label: hours !== null ? `${hours}h away` : "Upcoming" },
  }[urgency];

  // ── Extract intel snippets from research_data ────────────────────────────
  const rd = (meeting.research_data ?? {}) as Record<string, any>;
  const execBriefing: string | null = rd.executive_briefing ?? null;
  const whyNow: Array<{ title: string; detail: string }> = rd.why_now_signals ?? [];
  const recommendations: string[] = rd.meeting_recommendations ?? [];
  const attendeeIntel = rd.attendee_intelligence ?? {};
  const stakeholders: Array<{ name: string; title?: string; persona?: string }> =
    attendeeIntel.stakeholder_cards ?? [];
  const coverage: number | null = attendeeIntel.committee_coverage?.coverage_score ?? null;
  const risks: string[] = [];
  if (rd.intent_signals?.hiring?.length) risks.push("Active hiring signals");
  if (rd.competitive_landscape?.length) risks.push("Competitive activity detected");
  const topAction = recommendations[0] ?? null;
  // First ~180 chars of executive briefing as teaser
  const briefTeaser = execBriefing
    ? execBriefing.replace(/\*\*/g, "").replace(/##\s*/g, "").split("\n").filter(Boolean)[0]?.slice(0, 200)
    : null;

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${urgency === "imminent" ? "#ffd3be" : colors.border}`,
        borderRadius: 16,
        padding: "18px 20px",
        display: "grid",
        gap: 14,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link
            to={`/meetings/${meeting.id}`}
            style={{ fontSize: 15, fontWeight: 800, color: colors.text, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {meeting.title}
            <ExternalLink size={13} style={{ color: colors.faint, flexShrink: 0 }} />
          </Link>
          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {companyName && (
              <span style={{ fontSize: 12, color: colors.sub, fontWeight: 600 }}>{companyName}</span>
            )}
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "capitalize",
                padding: "2px 8px",
                borderRadius: 999,
                background: "#f0f4fb",
                color: colors.sub,
                border: `1px solid ${colors.border}`,
              }}
            >
              {meeting.meeting_type.replace(/_/g, " ")}
            </span>
            {assigneeName && (
              <span style={{ fontSize: 12, color: colors.faint, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <User size={11} />
                {assigneeName}
              </span>
            )}
          </div>
        </div>

        {/* Timing badge */}
        <div
          style={{
            flexShrink: 0,
            padding: "5px 10px",
            borderRadius: 999,
            background: urgencyStyle.bg,
            color: urgencyStyle.color,
            border: `1px solid ${urgencyStyle.border}`,
            fontSize: 11,
            fontWeight: 800,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Clock3 size={11} />
          {urgencyStyle.label}
        </div>
      </div>

      {/* Scheduled time */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.faint, fontSize: 12 }}>
        <CalendarDays size={13} />
        <span>{formatDate(meeting.scheduled_at)}</span>
      </div>

      {/* Intel status row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {hasResearch ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, background: colors.greenSoft, color: colors.green, border: "1px solid #cfe8d7", fontSize: 12, fontWeight: 700 }}>
            <CheckCircle2 size={13} />
            Intel ready
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, background: colors.amberSoft, color: colors.amber, border: `1px solid #ffe3b3`, fontSize: 12, fontWeight: 700 }}>
            <BrainCircuit size={13} />
            No intel yet
          </span>
        )}
        {hasIntelSent && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, background: colors.primarySoft, color: colors.primary, border: "1px solid #d5e5ff", fontSize: 12, fontWeight: 700 }}>
            <MailCheck size={13} />
            Brief sent
          </span>
        )}
        {meeting.meeting_score != null && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 999, background: colors.violetSoft, color: colors.violet, border: "1px solid #eadbff", fontSize: 12, fontWeight: 700 }}>
            Score {meeting.meeting_score}/100
          </span>
        )}
        {coverage !== null && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 999, background: coverage >= 75 ? colors.greenSoft : colors.amberSoft, color: coverage >= 75 ? colors.green : colors.amber, border: `1px solid ${coverage >= 75 ? "#cfe8d7" : "#ffe3b3"}`, fontSize: 12, fontWeight: 700 }}>
            <Target size={11} />
            {coverage}% coverage
          </span>
        )}
        {risks.length > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 999, background: "#fff5f0", color: colors.orange, border: "1px solid #ffd3be", fontSize: 12, fontWeight: 700 }}>
            <AlertTriangle size={11} />
            {risks[0]}
          </span>
        )}
      </div>

      {/* ── Intel preview panel (only when research_data exists) ── */}
      {hasResearch && (
        <div style={{ display: "grid", gap: 10 }}>

          {/* Executive briefing teaser */}
          {briefTeaser && (
            <div style={{ padding: "10px 14px", borderRadius: 12, background: "#fff8f5", border: "1px solid #ffd5be" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#b05a2a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                <Sparkles size={10} /> Executive Briefing
              </div>
              <p style={{ fontSize: 12.5, color: "#3d5268", lineHeight: 1.55, margin: 0 }}>
                {briefTeaser}{execBriefing && execBriefing.length > 200 ? "…" : ""}
              </p>
            </div>
          )}

          {/* Why-now signals + stakeholders side by side */}
          {(whyNow.length > 0 || stakeholders.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {whyNow.length > 0 && (
                <div style={{ padding: "10px 14px", borderRadius: 12, background: "#f3f8ff", border: "1px solid #d5e5ff" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#24567e", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                    <Zap size={10} /> Why Now ({whyNow.length})
                  </div>
                  <div style={{ display: "grid", gap: 5 }}>
                    {whyNow.slice(0, 2).map((s, i) => (
                      <div key={i}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#24364b" }}>{s.title}</div>
                        <div style={{ fontSize: 11, color: "#546679", lineHeight: 1.4 }}>{s.detail?.slice(0, 80)}{(s.detail?.length ?? 0) > 80 ? "…" : ""}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {stakeholders.length > 0 && (
                <div style={{ padding: "10px 14px", borderRadius: 12, background: "#f5f0ff", border: "1px solid #e0d3ff" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#5a1fa5", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                    <Users size={10} /> Stakeholders ({stakeholders.length})
                  </div>
                  <div style={{ display: "grid", gap: 5 }}>
                    {stakeholders.slice(0, 3).map((s, i) => (
                      <div key={i} style={{ fontSize: 11, color: "#3d2d5e" }}>
                        <span style={{ fontWeight: 700 }}>{s.name}</span>
                        {s.title && <span style={{ color: "#7a6fa5" }}> · {s.title}</span>}
                      </div>
                    ))}
                    {stakeholders.length > 3 && <div style={{ fontSize: 11, color: "#7a6fa5" }}>+{stakeholders.length - 3} more</div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Top recommended action */}
          {topAction && (
            <div style={{ padding: "9px 14px", borderRadius: 12, background: "#f0fdf4", border: "1px solid #bbf7d0", display: "flex", alignItems: "flex-start", gap: 8 }}>
              <TrendingUp size={13} style={{ color: "#15803d", marginTop: 2, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Top Recommendation</div>
                <div style={{ fontSize: 12, color: "#1e4032", lineHeight: 1.45 }}>{topAction}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={isRunning}
          onClick={() => onRunIntel(meeting.id)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: isRunning ? "#f5f8fe" : "#fff",
            color: isRunning ? colors.faint : colors.primary,
            fontSize: 12,
            fontWeight: 700,
            cursor: isRunning ? "wait" : "pointer",
          }}
        >
          {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {isRunning ? "Generating..." : hasResearch ? "Regenerate intel" : "Run intel now"}
        </button>

        <Link
          to={`/meetings/${meeting.id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: "#fff",
            color: colors.sub,
            fontSize: 12,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          <ExternalLink size={13} />
          Open meeting
        </Link>
      </div>
    </div>
  );
}

type StatusFilter = "all" | "scheduled" | "completed";
type IntelFilter = "all" | "has_intel" | "no_intel";

export default function PreMeetingAssistance() {
  const { user, isAdmin } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningIntel, setRunningIntel] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("scheduled");
  const [intelFilter, setIntelFilter] = useState<IntelFilter>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const loadData = async () => {
    setLoading(true);
    try {
      const [ms, cs, ds, us] = await Promise.all([
        meetingsApi.list(0, 300),
        companiesApi.list(),
        dealsApi.list(0, 500),
        isAdmin ? authApi.listAllUsers().catch(() => []) : Promise.resolve([]),
      ]);
      setMeetings(ms);
      setCompanies(cs);
      setDeals(ds);
      setUsers(us);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const companyMap = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies]
  );

  // Map deal_id → assigned_to_id + assigned user name
  const dealAssigneeMap = useMemo(() => {
    const userMap = new Map(users.map((u) => [u.id, u.name]));
    const map = new Map<string, { id: string; name: string }>();
    for (const d of deals) {
      if (d.assigned_to_id) {
        map.set(d.id, {
          id: d.assigned_to_id,
          name: userMap.get(d.assigned_to_id) ?? "Unknown",
        });
      }
    }
    return map;
  }, [deals, users]);

  const handleRunIntel = async (meetingId: string) => {
    setRunningIntel(meetingId);
    try {
      await meetingsApi.runIntelligence(meetingId);
      await loadData();
    } catch {
      // swallow — user can retry
    } finally {
      setRunningIntel(null);
    }
  };

  const filtered = useMemo(() => {
    return meetings.filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (intelFilter === "has_intel" && !m.research_data) return false;
      if (intelFilter === "no_intel" && m.research_data) return false;
      if (typeFilter !== "all" && m.meeting_type !== typeFilter) return false;
      if (assigneeFilter !== "all" && m.deal_id) {
        const assignee = dealAssigneeMap.get(m.deal_id);
        if (!assignee || assignee.id !== assigneeFilter) return false;
      } else if (assigneeFilter !== "all" && !m.deal_id) {
        return false;
      }
      return true;
    });
  }, [meetings, statusFilter, intelFilter, typeFilter, assigneeFilter, dealAssigneeMap]);

  // Upcoming = sorted by scheduled_at ascending, past = descending
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
      const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
      return statusFilter === "completed" ? tb - ta : ta - tb;
    });
  }, [filtered, statusFilter]);

  const summary = useMemo(() => ({
    total: meetings.length,
    upcoming: meetings.filter((m) => m.status === "scheduled").length,
    hasIntel: meetings.filter((m) => m.status === "scheduled" && m.research_data).length,
    noIntel: meetings.filter((m) => m.status === "scheduled" && !m.research_data).length,
  }), [meetings]);

  const meetingTypes = useMemo(
    () => Array.from(new Set(meetings.map((m) => m.meeting_type))).sort(),
    [meetings]
  );

  return (
    <div className="crm-page" style={{ display: "grid", gap: 18 }}>
      {/* Header */}
      <section
        className="crm-panel"
        style={{ padding: 24, display: "grid", gap: 16 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: colors.text, marginBottom: 6 }}>
              Pre-Meeting Assistance
            </h2>
            <p className="crm-muted" style={{ maxWidth: 640, lineHeight: 1.7 }}>
              {isAdmin
                ? "Review upcoming meetings across the team, check intel status, and trigger research before calls. Beacon auto-sends a brief to each assigned rep 12 hours before the meeting."
                : `Your upcoming meetings in one place. Run pre-meeting intel before any call to get account context, stakeholder profiles, and recommended talking points. Beacon sends the brief to you automatically 12 hours before scheduled meetings.`}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 12px",
                borderRadius: 999,
                background: "#f4f7ff",
                color: "#4b60cf",
                border: "1px solid #d7dffb",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <CalendarDays size={13} />
              {summary.upcoming} upcoming
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 12px",
                borderRadius: 999,
                background: colors.greenSoft,
                color: colors.green,
                border: "1px solid #cfe8d7",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <CheckCircle2 size={13} />
              {summary.hasIntel} intel ready
            </span>
            {summary.noIntel > 0 && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 12px",
                  borderRadius: 999,
                  background: colors.amberSoft,
                  color: colors.amber,
                  border: "1px solid #ffe3b3",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <BrainCircuit size={13} />
                {summary.noIntel} need intel
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="crm-panel" style={{ padding: 18, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.text, fontSize: 13, fontWeight: 700 }}>
          <Filter size={14} />
          Filters
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {/* Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{ height: 38, borderRadius: 10, border: `1px solid ${colors.border}`, padding: "0 10px", fontSize: 13, background: "#fff", color: colors.text }}
          >
            <option value="all">All statuses</option>
            <option value="scheduled">Upcoming (scheduled)</option>
            <option value="completed">Completed</option>
          </select>

          {/* Intel status */}
          <select
            value={intelFilter}
            onChange={(e) => setIntelFilter(e.target.value as IntelFilter)}
            style={{ height: 38, borderRadius: 10, border: `1px solid ${colors.border}`, padding: "0 10px", fontSize: 13, background: "#fff", color: colors.text }}
          >
            <option value="all">All intel status</option>
            <option value="has_intel">Intel ready</option>
            <option value="no_intel">No intel yet</option>
          </select>

          {/* Meeting type */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ height: 38, borderRadius: 10, border: `1px solid ${colors.border}`, padding: "0 10px", fontSize: 13, background: "#fff", color: colors.text }}
          >
            <option value="all">All types</option>
            {meetingTypes.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          {/* Assignee (admin only) */}
          {isAdmin && users.length > 0 && (
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              style={{ height: 38, borderRadius: 10, border: `1px solid ${colors.border}`, padding: "0 10px", fontSize: 13, background: "#fff", color: colors.text }}
            >
              <option value="all">All reps</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}

          {(statusFilter !== "scheduled" || intelFilter !== "all" || typeFilter !== "all" || assigneeFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter("scheduled");
                setIntelFilter("all");
                setTypeFilter("all");
                setAssigneeFilter("all");
              }}
              style={{ height: 38, padding: "0 12px", borderRadius: 10, border: `1px solid #ffd0d8`, background: "#fff5f7", color: "#c55656", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <RefreshCw size={11} />
              Reset
            </button>
          )}
        </div>
      </section>

      {/* Meeting cards */}
      {loading ? (
        <div className="crm-panel" style={{ padding: 32, display: "flex", alignItems: "center", gap: 10, color: colors.faint }}>
          <Loader2 size={18} className="animate-spin" />
          <span style={{ fontSize: 14 }}>Loading meetings...</span>
        </div>
      ) : sorted.length === 0 ? (
        <div className="crm-panel" style={{ padding: 40, textAlign: "center" }}>
          <CalendarDays size={36} style={{ color: colors.faint, margin: "0 auto 12px" }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.text, marginBottom: 6 }}>No meetings found</div>
          <div style={{ fontSize: 13, color: colors.faint, maxWidth: 400, margin: "0 auto" }}>
            {meetings.length === 0
              ? "Create a meeting from the Meetings page and link it to a deal. Beacon will generate a pre-meeting intel brief before the call."
              : "Try adjusting your filters — no meetings match the current selection."}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 12, color: colors.faint, fontWeight: 600 }}>
            {sorted.length} meeting{sorted.length !== 1 ? "s" : ""} · {statusFilter === "scheduled" ? "sorted by soonest first" : "sorted by most recent"}
          </div>
          {sorted.map((m) => {
            const assignee = m.deal_id ? dealAssigneeMap.get(m.deal_id) : undefined;
            return (
              <MeetingIntelCard
                key={m.id}
                meeting={m}
                companyName={m.company_id ? companyMap.get(m.company_id) : undefined}
                assigneeName={isAdmin && assignee ? assignee.name : undefined}
                onRunIntel={handleRunIntel}
                runningIntel={runningIntel}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
