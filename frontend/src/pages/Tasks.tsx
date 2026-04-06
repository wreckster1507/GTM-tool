import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, ExternalLink, Filter, MessageSquare, Sparkles, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { tasksApi } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { formatDate } from "../lib/utils";
import type { TaskWorkspaceItem } from "../types";

const colors = {
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
  red: "#b42336",
  redSoft: "#ffecef",
};

const PRIORITY_STYLE = {
  urgent: { bg: colors.redSoft, border: "#ffb8c2", color: colors.red },
  high: { bg: colors.redSoft, border: "#ffd0d8", color: colors.red },
  medium: { bg: colors.amberSoft, border: "#ffe3b3", color: colors.amber },
  normal: { bg: "#eef2f7", border: colors.border, color: colors.sub },
  low: { bg: "#eef2f7", border: colors.border, color: colors.sub },
} as const;

const TYPE_STYLE = {
  manual: { bg: colors.primarySoft, border: "#d5e5ff", color: colors.primary },
  system: { bg: colors.violetSoft, border: "#eadbff", color: colors.violet },
} as const;

function parseMeetingPayload(payload?: Record<string, unknown>) {
  const meetingTitle = typeof payload?.meeting_title === "string" ? payload.meeting_title.trim() : "";
  const meetingSummary = typeof payload?.meeting_summary === "string" ? payload.meeting_summary.trim() : "";
  const followUpEmailDraft = typeof payload?.follow_up_email_draft === "string" ? payload.follow_up_email_draft.trim() : "";
  const actionItems = Array.isArray(payload?.action_items)
    ? payload.action_items.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  return {
    meetingTitle,
    meetingSummary,
    followUpEmailDraft,
    actionItems,
    hasMeetingContent: Boolean(meetingTitle || meetingSummary || followUpEmailDraft || actionItems.length),
  };
}

function MeetingFollowUpBlock({ task }: { task: TaskWorkspaceItem }) {
  const [copied, setCopied] = useState(false);
  const { meetingTitle, meetingSummary, followUpEmailDraft, actionItems, hasMeetingContent } = parseMeetingPayload(task.action_payload);

  if (!hasMeetingContent) return null;

  const copyDraft = async () => {
    if (!followUpEmailDraft) return;
    try {
      await navigator.clipboard.writeText(followUpEmailDraft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {meetingSummary ? (
        <div style={{ borderRadius: 14, border: "1px solid #ffd7b0", background: "#fff7ef", padding: "14px 15px", display: "grid", gap: 8 }}>
          <div style={{ color: colors.amber, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>MEETING SUMMARY</div>
          {meetingTitle ? <div style={{ color: colors.text, fontSize: 13, fontWeight: 700 }}>{meetingTitle}</div> : null}
          <div style={{ color: colors.text, fontSize: 13.5, lineHeight: 1.7 }}>{meetingSummary}</div>
        </div>
      ) : null}

      {actionItems.length > 0 ? (
        <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#fcfdff", padding: "14px 15px", display: "grid", gap: 10 }}>
          <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>ACTION ITEMS</div>
          <div style={{ display: "grid", gap: 8 }}>
            {actionItems.map((item) => (
              <div key={item} style={{ color: colors.sub, fontSize: 13.5, lineHeight: 1.6, padding: "8px 10px", borderRadius: 10, background: "#fff", border: `1px solid ${colors.border}` }}>
                {item}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {followUpEmailDraft ? (
        <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: "#fff", padding: "14px 15px", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>FOLLOW-UP EMAIL DRAFT</div>
            <button
              type="button"
              onClick={() => void copyDraft()}
              className="crm-button soft"
              style={{ background: copied ? colors.greenSoft : "#fff", color: copied ? colors.green : colors.sub, borderColor: copied ? "#cdeedc" : colors.border }}
            >
              {copied ? "Copied" : "Copy draft"}
            </button>
          </div>
          <div style={{ whiteSpace: "pre-wrap", color: colors.text, fontSize: 13.5, lineHeight: 1.75, padding: "12px 13px", borderRadius: 12, background: "#fbfdff", border: `1px solid ${colors.border}` }}>
            {followUpEmailDraft}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type TaskStatusFilter = "open" | "completed" | "dismissed" | "all";
type TaskTypeFilter = "all" | "manual" | "system";
type EntityFilter = "all" | "company" | "contact" | "deal";

function TaskWorkspaceCard({
  task,
  commentDraft,
  onCommentDraftChange,
  onAddComment,
  onAccept,
  onComplete,
  onDismiss,
  onDelete,
  canDelete,
}: {
  task: TaskWorkspaceItem;
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onAddComment: () => void;
  onAccept: () => void;
  onComplete: () => void;
  onDismiss: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const priorityStyle = PRIORITY_STYLE[task.priority as keyof typeof PRIORITY_STYLE] ?? PRIORITY_STYLE.normal;
  const typeStyle = TYPE_STYLE[task.task_type];
  const isOpen = task.status === "open";

  return (
    <div className="crm-panel" style={{ padding: 18, borderRadius: 16, boxShadow: "none", display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "start" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ borderRadius: 999, padding: "4px 9px", background: typeStyle.bg, border: `1px solid ${typeStyle.border}`, color: typeStyle.color, fontSize: 11, fontWeight: 800 }}>
              {task.task_type === "system" ? "System" : "Manual"}
            </span>
            <span style={{ borderRadius: 999, padding: "4px 9px", background: priorityStyle.bg, border: `1px solid ${priorityStyle.border}`, color: priorityStyle.color, fontSize: 11, fontWeight: 800 }}>
              {task.priority}
            </span>
            <span style={{ borderRadius: 999, padding: "4px 9px", background: task.status === "completed" ? colors.greenSoft : task.status === "dismissed" ? "#eef2f7" : "#f8fbff", border: `1px solid ${task.status === "completed" ? "#cdeedc" : colors.border}`, color: task.status === "completed" ? colors.green : colors.sub, fontSize: 11, fontWeight: 800 }}>
              {task.status}
            </span>
            <span className="crm-chip" style={{ background: "#f7f8fc", color: colors.sub, borderColor: colors.border }}>
              {task.entity_type}
            </span>
          </div>
          <div style={{ fontWeight: 800, fontSize: 16, color: colors.text }}>{task.title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Link to={task.entity_link} style={{ color: colors.primary, fontWeight: 700, fontSize: 14, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {task.entity_name}
              <ExternalLink size={14} />
            </Link>
            {task.entity_subtitle ? <span style={{ color: colors.faint, fontSize: 13 }}>{task.entity_subtitle}</span> : null}
          </div>
          {task.description ? <div style={{ color: colors.sub, fontSize: 13.5, lineHeight: 1.6 }}>{task.description}</div> : null}
        </div>
        <div style={{ display: "grid", gap: 4, justifyItems: "end", color: colors.faint, fontSize: 12 }}>
          <div>{formatDate(task.updated_at)}</div>
          {task.due_at ? <div>Due {formatDate(task.due_at)}</div> : null}
          <div>{task.assigned_to_name || "Unassigned"}</div>
          <div>{task.created_by_name ? `Created by ${task.created_by_name}` : (task.source || "Beacon")}</div>
          {canDelete ? (
            <button
              type="button"
              onClick={onDelete}
              style={{ marginTop: 4, borderRadius: 8, border: `1px solid #ffd0d8`, background: "#fff5f7", color: colors.red, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Trash2 size={13} />
              Delete
            </button>
          ) : null}
        </div>
      </div>

      {task.task_type === "system" && isOpen ? (
        <div style={{ borderRadius: 12, background: "#fbf7ff", border: "1px solid #eadbff", padding: "10px 12px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ color: colors.violet, fontSize: 12.5, fontWeight: 700 }}>
            {task.recommended_action
              ? "Beacon can handle this automatically if you accept the recommendation."
              : "Beacon flagged this recommendation for the team. Mark it reviewed once you've handled it."}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={onDismiss} className="crm-button soft">Dismiss</button>
            <button type="button" onClick={onAccept} className="crm-button primary">
              {task.recommended_action ? "Accept" : "Mark reviewed"}
            </button>
          </div>
        </div>
      ) : null}

      {task.task_type === "manual" && isOpen ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={onDismiss} className="crm-button soft">Dismiss</button>
          <button type="button" onClick={onComplete} className="crm-button primary" style={{ background: colors.green, borderColor: colors.green }}>
            Complete
          </button>
        </div>
      ) : null}

      <MeetingFollowUpBlock task={task} />

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: colors.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.3 }}>COMMENTS</div>
        {task.comments.length === 0 ? (
          <div style={{ color: colors.faint, fontSize: 12.5 }}>No comments yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {task.comments.map((comment) => (
              <div key={comment.id} style={{ borderRadius: 12, background: "#fbfdff", border: `1px solid ${colors.border}`, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ color: colors.text, fontSize: 12.5, fontWeight: 700 }}>{comment.created_by_name || "Beacon"}</div>
                  <div style={{ color: colors.faint, fontSize: 11 }}>{formatDate(comment.created_at)}</div>
                </div>
                <div style={{ color: colors.sub, fontSize: 12.5, lineHeight: 1.55, marginTop: 6 }}>{comment.body}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gap: 6 }}>
          <textarea
            value={commentDraft}
            onChange={(e) => onCommentDraftChange(e.target.value)}
            placeholder="Add a quick comment or update..."
            style={{ width: "100%", minHeight: 68, borderRadius: 12, border: `1px solid ${colors.border}`, padding: "10px 12px", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={onAddComment} disabled={!commentDraft.trim()} className="crm-button soft">
              Add comment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<TaskWorkspaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("open");
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilter>("all");
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const rows = await tasksApi.workspace({
        includeClosed: true,
        taskType: typeFilter === "all" ? undefined : typeFilter,
        entityType: entityFilter === "all" ? undefined : entityFilter,
      });
      setTasks(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [typeFilter, entityFilter]);

  const visibleTasks = useMemo(() => {
    if (statusFilter === "all") return tasks;
    return tasks.filter((task) => task.status === statusFilter);
  }, [tasks, statusFilter]);

  const summary = useMemo(() => ({
    open: tasks.filter((task) => task.status === "open").length,
    system: tasks.filter((task) => task.status === "open" && task.task_type === "system").length,
    manual: tasks.filter((task) => task.status === "open" && task.task_type === "manual").length,
    completed: tasks.filter((task) => task.status === "completed").length,
  }), [tasks]);

  const patchTask = async (taskId: string, data: Parameters<typeof tasksApi.update>[1]) => {
    await tasksApi.update(taskId, data);
    await load();
  };

  const acceptTask = async (taskId: string) => {
    await tasksApi.accept(taskId);
    await load();
  };

  const addComment = async (taskId: string) => {
    const body = (commentDrafts[taskId] || "").trim();
    if (!body) return;
    await tasksApi.addComment(taskId, body);
    setCommentDrafts((current) => ({ ...current, [taskId]: "" }));
    await load();
  };

  const deleteTask = async (task: TaskWorkspaceItem) => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    await tasksApi.remove(task.id);
    await load();
  };

  return (
    <div className="crm-page" style={{ display: "grid", gap: 18 }}>
      <section className="crm-panel" style={{ padding: 24, display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: colors.text, marginBottom: 8 }}>Tasks</h2>
            <p className="crm-muted" style={{ maxWidth: 760, lineHeight: 1.7 }}>
              {user?.role === "admin"
                ? "The full workspace task queue in one place. Beacon recommendations stay alongside manual follow-ups so you can review what the team should tackle next."
                : `Everything assigned to ${user?.name || "you"} in one place. Beacon recommendations stay alongside manual follow-ups so reps can triage work quickly and then jump into the right company, prospect, or deal.`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span className="crm-chip" style={{ background: colors.violetSoft, color: colors.violet, borderColor: "#eadbff" }}>
              <Sparkles size={14} />
              {summary.system} recommendations
            </span>
            <span className="crm-chip" style={{ background: colors.primarySoft, color: colors.primary, borderColor: "#d5e5ff" }}>
              <MessageSquare size={14} />
              {summary.manual} manual
            </span>
            <span className="crm-chip" style={{ background: "#eef7f1", color: colors.green, borderColor: "#cfe8d7" }}>
              <CheckCircle2 size={14} />
              {summary.completed} completed
            </span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          {[
            { label: "Open now", value: summary.open, tone: colors.primarySoft, color: colors.primary },
            { label: "Beacon recommendations", value: summary.system, tone: colors.violetSoft, color: colors.violet },
            { label: "Manual follow-ups", value: summary.manual, tone: "#eef7f1", color: colors.green },
            { label: "Completed", value: summary.completed, tone: "#f6f7fb", color: colors.sub },
          ].map((item) => (
            <div key={item.label} style={{ border: `1px solid ${colors.border}`, borderRadius: 16, padding: "16px 18px", background: "#fff" }}>
              <div style={{ color: colors.faint, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8 }}>{item.label}</div>
              <div style={{ color: item.color, fontWeight: 800, fontSize: 28 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="crm-panel" style={{ padding: 20, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: colors.text, fontWeight: 800 }}>
          <Filter size={15} />
          <span>Filters</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 220px))", gap: 12 }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatusFilter)} style={{ height: 44, borderRadius: 12, border: `1px solid ${colors.border}`, padding: "0 12px", fontSize: 13, background: "#fff" }}>
            <option value="open">Open only</option>
            <option value="completed">Completed</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All statuses</option>
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TaskTypeFilter)} style={{ height: 44, borderRadius: 12, border: `1px solid ${colors.border}`, padding: "0 12px", fontSize: 13, background: "#fff" }}>
            <option value="all">All task types</option>
            <option value="system">System recommendations</option>
            <option value="manual">Manual tasks</option>
          </select>
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value as EntityFilter)} style={{ height: 44, borderRadius: 12, border: `1px solid ${colors.border}`, padding: "0 12px", fontSize: 13, background: "#fff" }}>
            <option value="all">All record types</option>
            <option value="deal">Deals</option>
            <option value="contact">Prospects</option>
            <option value="company">Companies</option>
          </select>
        </div>
      </section>

      <section style={{ display: "grid", gap: 14 }}>
        {loading ? (
          <div className="crm-panel" style={{ padding: 24, color: colors.faint }}>Loading tasks…</div>
        ) : visibleTasks.length === 0 ? (
          <div className="crm-panel" style={{ padding: 28, color: colors.faint, display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 800, color: colors.text }}>No tasks match these filters</div>
            <div>When Beacon recommends something or a teammate assigns you a manual follow-up, it will appear here.</div>
          </div>
        ) : (
          visibleTasks.map((task) => (
            <TaskWorkspaceCard
              key={task.id}
              task={task}
              commentDraft={commentDrafts[task.id] || ""}
              onCommentDraftChange={(value) => setCommentDrafts((current) => ({ ...current, [task.id]: value }))}
              onAddComment={() => addComment(task.id)}
              onAccept={() => acceptTask(task.id)}
              onComplete={() => patchTask(task.id, { status: "completed" })}
              onDismiss={() => patchTask(task.id, { status: "dismissed" })}
              onDelete={() => deleteTask(task)}
              canDelete={Boolean(user && (user.role === "admin" || user.id === task.created_by_id))}
            />
          ))
        )}
      </section>
    </div>
  );
}
