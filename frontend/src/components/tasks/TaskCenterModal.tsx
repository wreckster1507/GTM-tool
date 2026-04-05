import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, MessageSquare, Plus, Sparkles, Trash2, X } from "lucide-react";

import { authApi, tasksApi } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import type { TaskItem, User as UserType } from "../../types";
import { formatDate } from "../../lib/utils";

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

const ROLE_LABEL: Record<"admin" | "ae" | "sdr", string> = {
  admin: "Admin",
  ae: "Account Executive",
  sdr: "SDR",
};

function TaskCard({
  task,
  commentDraft,
  onCommentDraftChange,
  onAddComment,
  onComplete,
  onDismiss,
  onAccept,
  onDelete,
  canDelete,
}: {
  task: TaskItem;
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onAddComment: () => void;
  onComplete: () => void;
  onDismiss: () => void;
  onAccept: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const priorityStyle = PRIORITY_STYLE[task.priority as keyof typeof PRIORITY_STYLE] ?? PRIORITY_STYLE.normal;
  const typeStyle = TYPE_STYLE[task.task_type];
  const isOpen = task.status === "open";
  const ownerText = task.assigned_role
    ? `${ROLE_LABEL[task.assigned_role]}${task.assigned_to_name ? ` · ${task.assigned_to_name}` : ""}`
    : task.assigned_to_name || "Unassigned";

  return (
    <div style={{ border: `1px solid ${colors.border}`, background: "#fff", borderRadius: 16, padding: "14px 16px", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "start" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ borderRadius: 999, padding: "4px 9px", background: typeStyle.bg, border: `1px solid ${typeStyle.border}`, color: typeStyle.color, fontSize: 11, fontWeight: 800 }}>
              {task.task_type === "system" ? "System" : "Manual"}
            </span>
            <span style={{ borderRadius: 999, padding: "4px 9px", background: priorityStyle.bg, border: `1px solid ${priorityStyle.border}`, color: priorityStyle.color, fontSize: 11, fontWeight: 800 }}>
              {task.priority}
            </span>
            <span style={{ borderRadius: 999, padding: "4px 9px", background: task.status === "completed" ? colors.greenSoft : task.status === "dismissed" ? "#eef2f7" : "#f8fbff", border: `1px solid ${task.status === "completed" ? "#cdeedc" : colors.border}`, color: task.status === "completed" ? colors.green : colors.sub, fontSize: 11, fontWeight: 800 }}>
              {task.status}
            </span>
          </div>
          <div style={{ color: colors.text, fontWeight: 800, fontSize: 15 }}>{task.title}</div>
          {task.description ? (
            <div style={{ color: colors.sub, fontSize: 13.5, lineHeight: 1.6 }}>{task.description}</div>
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 4, justifyItems: "end", color: colors.faint, fontSize: 12 }}>
          <div>{formatDate(task.created_at)}</div>
          {task.due_at ? <div>Due {formatDate(task.due_at)}</div> : null}
          <div>{ownerText}</div>
          <div>{task.created_by_name ? `Created by ${task.created_by_name}` : task.source || "Beacon"}</div>
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
            <button type="button" onClick={onDismiss} style={{ borderRadius: 8, border: `1px solid ${colors.border}`, background: "#fff", color: colors.sub, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              Dismiss
            </button>
            <button type="button" onClick={onAccept} style={{ borderRadius: 8, border: `1px solid ${colors.primary}`, background: colors.primary, color: "#fff", padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {task.recommended_action ? "Accept" : "Mark reviewed"}
            </button>
          </div>
        </div>
      ) : null}

      {task.task_type === "manual" && isOpen ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={onDismiss} style={{ borderRadius: 8, border: `1px solid ${colors.border}`, background: "#fff", color: colors.sub, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Dismiss
          </button>
          <button type="button" onClick={onComplete} style={{ borderRadius: 8, border: `1px solid ${colors.green}`, background: colors.green, color: "#fff", padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Complete
          </button>
        </div>
      ) : null}

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
            <button type="button" onClick={onAddComment} disabled={!commentDraft.trim()} style={{ borderRadius: 8, border: "none", background: commentDraft.trim() ? colors.primary : "#e8eef5", color: commentDraft.trim() ? "#fff" : "#94a3b8", padding: "7px 10px", fontSize: 12, fontWeight: 700, cursor: commentDraft.trim() ? "pointer" : "default" }}>
              Add comment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TaskCenterModal({
  isOpen,
  onClose,
  entityType,
  entityId,
  entityLabel,
  onChanged,
  mode = "modal",
}: {
  isOpen?: boolean;
  onClose?: () => void;
  entityType: "company" | "contact" | "deal";
  entityId: string;
  entityLabel: string;
  onChanged?: () => void;
  mode?: "modal" | "inline";
}) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [dueAt, setDueAt] = useState("");
  const [assignedRole, setAssignedRole] = useState<"admin" | "ae" | "sdr">(entityType === "deal" ? "ae" : "sdr");
  const [assignedToId, setAssignedToId] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<UserType[]>([]);
  const isVisible = mode === "inline" ? true : Boolean(isOpen);

  const load = async () => {
    if (!isVisible) return;
    setLoading(true);
    try {
      const rows = await tasksApi.list(entityType, entityId, true);
      setTasks(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isVisible) {
      void load();
      authApi.listAllUsers().then(setUsers).catch(() => setUsers([]));
    }
  }, [isVisible, entityType, entityId]);

  useEffect(() => {
    setAssignedRole(entityType === "deal" ? "ae" : "sdr");
    setAssignedToId("");
  }, [entityType, entityId]);

  const openSystemTasks = useMemo(
    () => tasks.filter((task) => task.status === "open" && task.task_type === "system"),
    [tasks],
  );
  const openManualTasks = useMemo(
    () => tasks.filter((task) => task.status === "open" && task.task_type === "manual"),
    [tasks],
  );
  const historyTasks = useMemo(() => tasks.filter((task) => task.status !== "open"), [tasks]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setDueAt("");
    setAssignedRole(entityType === "deal" ? "ae" : "sdr");
    setAssignedToId("");
    setShowCreate(false);
  };

  const assigneeOptions = useMemo(
    () => users.filter((user) => user.role === assignedRole),
    [users, assignedRole],
  );

  const createTask = async () => {
    if (!title.trim()) return;
    await tasksApi.create({
      entity_type: entityType,
      entity_id: entityId,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      due_at: dueAt || undefined,
      assigned_role: assignedRole,
      assigned_to_id: assignedToId || undefined,
    });
    resetForm();
    onChanged?.();
    await load();
  };

  const patchTask = async (taskId: string, data: Parameters<typeof tasksApi.update>[1]) => {
    await tasksApi.update(taskId, data);
    onChanged?.();
    await load();
  };

  const addComment = async (taskId: string) => {
    const body = (commentDrafts[taskId] || "").trim();
    if (!body) return;
    await tasksApi.addComment(taskId, body);
    setCommentDrafts((current) => ({ ...current, [taskId]: "" }));
    onChanged?.();
    await load();
  };

  const acceptTask = async (taskId: string) => {
    await tasksApi.accept(taskId);
    onChanged?.();
    await load();
  };

  const deleteTask = async (task: TaskItem) => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    await tasksApi.remove(task.id);
    onChanged?.();
    await load();
  };

  if (!isVisible) return null;

  const content = (
    <div
      style={{
        overflowY: "auto",
        padding: mode === "inline" ? 0 : 20,
        background: mode === "inline" ? "transparent" : "#fbfdff",
        display: "grid",
        gap: 14,
      }}
    >
      <div style={{ display: "grid", gap: 12 }}>
        <div
          style={{
            border: `1px solid ${colors.border}`,
            background: "#fff",
            borderRadius: 16,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ color: colors.text, fontWeight: 800, fontSize: 15 }}>Task framework</div>
            <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.55 }}>
              Manual tasks keep human follow-ups visible. System tasks are Beacon recommendations created from synced signals and record state.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ borderRadius: 999, padding: "5px 10px", background: colors.violetSoft, color: colors.violet, border: "1px solid #eadbff", fontSize: 12, fontWeight: 800 }}>
              {openSystemTasks.length} recommendations
            </span>
            <span style={{ borderRadius: 999, padding: "5px 10px", background: colors.primarySoft, color: colors.primary, border: "1px solid #d5e5ff", fontSize: 12, fontWeight: 800 }}>
              {openManualTasks.length} manual
            </span>
            <span style={{ borderRadius: 999, padding: "5px 10px", background: "#f4f7fb", color: colors.sub, border: `1px solid ${colors.border}`, fontSize: 12, fontWeight: 800 }}>
              {historyTasks.length} history
            </span>
          </div>
        </div>

        {showCreate ? (
          <div style={{ border: `1px solid ${colors.border}`, background: "#fff", borderRadius: 16, padding: "14px 16px", display: "grid", gap: 10 }}>
            <div style={{ color: colors.text, fontWeight: 800 }}>Add manual task</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={{ height: 42, borderRadius: 12, border: `1px solid ${colors.border}`, padding: "0 12px", fontSize: 13, outline: "none" }} />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description or context" style={{ minHeight: 84, borderRadius: 12, border: `1px solid ${colors.border}`, padding: "10px 12px", fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <select value={priority} onChange={(e) => setPriority(e.target.value as "low" | "medium" | "high")} style={{ height: 42, borderRadius: 12, border: `1px solid ${colors.border}`, padding: "0 12px", fontSize: 13, background: "#fff", outline: "none" }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={{ height: 42, borderRadius: 12, border: `1px solid ${colors.border}`, padding: "0 12px", fontSize: 13, outline: "none" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <select value={assignedRole} onChange={(e) => { setAssignedRole(e.target.value as "admin" | "ae" | "sdr"); setAssignedToId(""); }} style={{ height: 42, borderRadius: 12, border: `1px solid ${colors.border}`, padding: "0 12px", fontSize: 13, background: "#fff", outline: "none" }}>
                {Object.entries(ROLE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} style={{ height: 42, borderRadius: 12, border: `1px solid ${colors.border}`, padding: "0 12px", fontSize: 13, background: "#fff", outline: "none" }}>
                <option value="">Any {ROLE_LABEL[assignedRole]}</option>
                {assigneeOptions.map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </div>
            <div style={{ color: colors.faint, fontSize: 12, lineHeight: 1.5 }}>
              Tie the task to the role first so it stays relevant even if the assignee changes later. Pick a person only when one specific teammate owns it right now.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={resetForm} style={{ borderRadius: 10, border: `1px solid ${colors.border}`, background: "#fff", color: colors.sub, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button" onClick={createTask} disabled={!title.trim()} style={{ borderRadius: 10, border: "none", background: title.trim() ? colors.primary : "#e8eef5", color: title.trim() ? "#fff" : "#94a3b8", padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: title.trim() ? "pointer" : "default" }}>
                Save task
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div style={{ color: colors.faint, padding: "8px 4px" }}>Loading tasks…</div>
        ) : (
          <>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: colors.text, fontWeight: 800 }}>
                <Sparkles size={14} color={colors.violet} />
                <span>Beacon Recommendations</span>
              </div>
              {openSystemTasks.length === 0 ? (
                <div style={{ border: `1px dashed ${colors.border}`, borderRadius: 16, background: "#fff", padding: "22px 18px", color: colors.faint }}>
                  No active recommendations yet. When synced email, call, outreach, or record-state signals imply a next-best action, Beacon will surface it here.
                </div>
              ) : (
                openSystemTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    commentDraft={commentDrafts[task.id] || ""}
                    onCommentDraftChange={(value) => setCommentDrafts((current) => ({ ...current, [task.id]: value }))}
                    onAddComment={() => addComment(task.id)}
                    onComplete={() => patchTask(task.id, { status: "completed" })}
                    onDismiss={() => patchTask(task.id, { status: "dismissed" })}
                    onAccept={() => acceptTask(task.id)}
                    onDelete={() => deleteTask(task)}
                    canDelete={Boolean(user && (user.role === "admin" || user.id === task.created_by_id))}
                  />
                ))
              )}
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: colors.text, fontWeight: 800 }}>
                <MessageSquare size={14} color={colors.primary} />
                <span>Manual Tasks</span>
              </div>
              {openManualTasks.length === 0 ? (
                <div style={{ border: `1px dashed ${colors.border}`, borderRadius: 16, background: "#fff", padding: "22px 18px", color: colors.faint }}>
                  No open manual tasks. Add lightweight follow-ups here when the team wants to track work that Beacon cannot automate yet.
                </div>
              ) : (
                openManualTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    commentDraft={commentDrafts[task.id] || ""}
                    onCommentDraftChange={(value) => setCommentDrafts((current) => ({ ...current, [task.id]: value }))}
                    onAddComment={() => addComment(task.id)}
                    onComplete={() => patchTask(task.id, { status: "completed" })}
                    onDismiss={() => patchTask(task.id, { status: "dismissed" })}
                    onAccept={() => acceptTask(task.id)}
                    onDelete={() => deleteTask(task)}
                    canDelete={Boolean(user && (user.role === "admin" || user.id === task.created_by_id))}
                  />
                ))
              )}
            </div>

            {historyTasks.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: colors.text, fontWeight: 800, marginTop: 4 }}>
                  <Clock3 size={14} color={colors.faint} />
                  <span>History</span>
                </div>
                {historyTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    commentDraft={commentDrafts[task.id] || ""}
                    onCommentDraftChange={(value) => setCommentDrafts((current) => ({ ...current, [task.id]: value }))}
                    onAddComment={() => addComment(task.id)}
                    onComplete={() => patchTask(task.id, { status: "completed" })}
                    onDismiss={() => patchTask(task.id, { status: "dismissed" })}
                    onAccept={() => acceptTask(task.id)}
                    onDelete={() => deleteTask(task)}
                    canDelete={Boolean(user && (user.role === "admin" || user.id === task.created_by_id))}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  if (mode === "inline") {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: colors.text, fontWeight: 800 }}>
              <CheckCircle2 size={16} color={colors.primary} />
              <span>Tasks</span>
            </div>
            <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.55 }}>
              Track manual follow-ups and review system-recommended actions for {entityLabel}.
            </div>
          </div>
          <button type="button" onClick={() => setShowCreate((current) => !current)} style={{ borderRadius: 10, border: `1px solid ${colors.primary}`, background: colors.primary, color: "#fff", padding: "9px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}>
            <Plus size={14} /> Manual task
          </button>
        </div>
        {content}
      </div>
    );
  }

  return (
    <>
      <div onClick={() => onClose?.()} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.36)", backdropFilter: "blur(3px)", zIndex: 1400 }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 1401, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: "min(920px, 100%)", maxHeight: "84vh", display: "grid", gridTemplateRows: "auto minmax(0,1fr)", overflow: "hidden", background: "#fff", borderRadius: 20, border: `1px solid ${colors.border}`, boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", padding: "20px 22px 16px", borderBottom: `1px solid ${colors.border}` }}>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: colors.text, fontWeight: 800 }}>
                <CheckCircle2 size={16} color={colors.primary} />
                <span>Tasks</span>
              </div>
              <div style={{ color: colors.sub, fontSize: 13, lineHeight: 1.55 }}>
                Track manual follow-ups and review system-recommended actions for {entityLabel}.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" onClick={() => setShowCreate((current) => !current)} style={{ borderRadius: 10, border: `1px solid ${colors.primary}`, background: colors.primary, color: "#fff", padding: "9px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}>
                <Plus size={14} /> Manual task
              </button>
              <button type="button" onClick={() => onClose?.()} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${colors.border}`, background: "#fff", color: colors.sub, display: "grid", placeItems: "center", cursor: "pointer" }}>
                <X size={16} />
              </button>
            </div>
          </div>
          {content}
        </div>
      </div>
    </>
  );
}
