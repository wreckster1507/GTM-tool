import { useEffect, useState, type CSSProperties } from "react";
import {
  Search, Plus, X, ChevronDown, Building2, CalendarDays,
  Users, Target, DollarSign, Flag, Clock3, UserCircle2,
} from "lucide-react";
import { dealsApi, companiesApi, authApi, contactsApi } from "../lib/api";
import type { Company, Deal, User } from "../types";
import { avatarColor, formatCurrency, formatDate, getInitials } from "../lib/utils";
import DealDetailDrawer from "../components/deal/DealDetailDrawer";

// ── Stage definitions ───────────────────────────────────────────────────────

const DEAL_STAGES = [
  { id: "open", label: "Open", group: "active" },
  { id: "demo_scheduled", label: "Demo Scheduled", group: "active" },
  { id: "demo_done", label: "Demo Done", group: "active" },
  { id: "qualified_lead", label: "Qualified Lead", group: "active" },
  { id: "poc_agreed", label: "POC Agreed", group: "active" },
  { id: "poc_wip", label: "POC WIP", group: "active" },
  { id: "poc_done", label: "POC Done", group: "active" },
  { id: "commercial_negotiation", label: "Negotiation", group: "active" },
  { id: "closed_won", label: "Closed Won", group: "closed" },
  { id: "closed_lost", label: "Closed Lost", group: "closed" },
  { id: "not_a_fit", label: "Not a Fit", group: "closed" },
  { id: "on_hold", label: "On Hold", group: "closed" },
  { id: "nurture", label: "Nurture", group: "closed" },
  { id: "churned", label: "Churned", group: "closed" },
];

const PROSPECT_STAGES = [
  { id: "todo", label: "Todo", group: "active" },
  { id: "in_progress", label: "In Progress", group: "active" },
  { id: "converted", label: "Converted", group: "closed" },
  { id: "blocked", label: "Blocked", group: "closed" },
  { id: "not_a_fit", label: "Not a Fit", group: "closed" },
];

type PipelineTab = "deal" | "prospect";

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#dc2626",
  high: "#f59e0b",
  normal: "#94a3b8",
  low: "#cbd5e1",
};

const STAGE_COLOR: Record<string, string> = {
  open: "#3b82f6", demo_scheduled: "#6366f1", demo_done: "#8b5cf6",
  qualified_lead: "#2563eb", poc_agreed: "#0ea5e9", poc_wip: "#06b6d4",
  poc_done: "#14b8a6", commercial_negotiation: "#f59e0b",
  closed_won: "#22c55e", closed_lost: "#94a3b8", not_a_fit: "#9ca3af",
  on_hold: "#a78bfa", nurture: "#67e8f9", churned: "#ef4444",
  todo: "#3b82f6", in_progress: "#8b5cf6", converted: "#22c55e", blocked: "#ef4444",
};

// ── Select with custom ChevronDown ──────────────────────────────────────────

function StyledSelect({ value, onChange, children, active }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode; active?: boolean;
}) {
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: "none", height: 34, borderRadius: 10,
          border: active ? "1.5px solid #b8d0f0" : "1px solid #dbe6f2",
          background: active ? "#f0f6ff" : "#fff",
          padding: "0 30px 0 12px", fontSize: 13, fontWeight: 500,
          color: "#2d4258", cursor: "pointer", outline: "none",
        }}
      >
        {children}
      </select>
      <ChevronDown size={13} style={{
        position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
        pointerEvents: "none", color: "#7a96b0",
      }} />
    </div>
  );
}

// ── Deal Card ───────────────────────────────────────────────────────────────

function DealCard({ deal, onClick }: { deal: Deal; onClick: () => void }) {
  const isOverdue = deal.close_date_est && new Date(deal.close_date_est) < new Date();

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%", textAlign: "left", cursor: "pointer",
        borderRadius: 16, border: "1px solid #e8eef5", background: "#ffffff",
        boxShadow: "0 2px 8px rgba(17,34,68,0.04)",
        padding: 16, display: "flex", flexDirection: "column", gap: 10,
        transition: "all 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 6px 20px rgba(17,34,68,0.08)";
        e.currentTarget.style.borderColor = "#c8d6e8";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(17,34,68,0.04)";
        e.currentTarget.style.borderColor = "#e8eef5";
      }}
    >
      {/* Top: name + priority dot */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 5,
          background: PRIORITY_COLOR[deal.priority] ?? "#94a3b8",
        }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: "#1f2d3d", lineHeight: 1.35, flex: 1 }}>
          {deal.name}
        </span>
      </div>

      {/* Company */}
      {deal.company_name && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#5e738b" }}>
          <Building2 size={12} />
          <span>{deal.company_name}</span>
        </div>
      )}

      {/* Amount */}
      <div style={{ fontSize: 16, fontWeight: 700, color: deal.value ? "#1f2a37" : "#b4c3d4", fontVariantNumeric: "tabular-nums" }}>
        {formatCurrency(deal.value)}
      </div>

      {/* Next step */}
      {deal.next_step && (
        <div style={{ fontSize: 11, color: "#2563eb", fontWeight: 500, lineHeight: 1.3 }}>
          → {deal.next_step}
        </div>
      )}

      {/* Department + tags */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {deal.department && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
            background: "#f0f4f8", color: "#4d6178", border: "1px solid #e2eaf2",
          }}>
            {deal.department}
          </span>
        )}
        {(deal.tags ?? []).slice(0, 3).map((tag) => (
          <span key={tag} style={{
            fontSize: 11, padding: "2px 8px", borderRadius: 6,
            background: "#f8f0ff", color: "#6b46a0", border: "1px solid #e8d8f8",
          }}>
            {tag}
          </span>
        ))}
        {(deal.tags ?? []).length > 3 && (
          <span style={{ fontSize: 11, color: "#94a3b8" }}>+{deal.tags.length - 3}</span>
        )}
      </div>

      {/* Bottom row: assignee + date + contacts */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: 8, borderTop: "1px solid #f0f4f8", marginTop: 2,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {deal.assigned_rep_name ? (
            <div className={`flex items-center justify-center rounded-full text-[9px] font-bold ${avatarColor(deal.assigned_rep_name)}`}
              style={{ width: 22, height: 22 }}>
              {getInitials(deal.assigned_rep_name)}
            </div>
          ) : (
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#e8eef5" }} />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#7a8ca1" }}>
            <Clock3 size={11} />
            <span>{deal.days_in_stage ?? 0}d</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {deal.close_date_est && (
            <span style={{ fontSize: 11, color: isOverdue ? "#dc2626" : "#7a8ca1", fontWeight: isOverdue ? 600 : 400 }}>
              {formatDate(deal.close_date_est)}
            </span>
          )}
          {(deal.contact_count ?? 0) > 0 && (
            <span style={{ fontSize: 11, color: "#5e738b", display: "flex", alignItems: "center", gap: 3 }}>
              <UserCircle2 size={11} />{deal.contact_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Column ──────────────────────────────────────────────────────────────────

function Column({ stageId, label, deals, group, onCardClick, onNewDeal }: {
  stageId: string; label: string; deals: Deal[]; group: string;
  onCardClick: (deal: Deal) => void; onNewDeal: (stage: string) => void;
}) {
  const total = deals.reduce((s, d) => s + (d.value ?? 0), 0);
  const isClosed = group === "closed";

  return (
    <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column" }}>
      {/* Column header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12, padding: "0 4px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: STAGE_COLOR[stageId] ?? "#94a3b8",
          }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: isClosed ? "#7a8ca1" : "#2d4258" }}>
            {label}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
            background: "#ecf1f7", color: "#48607b",
          }}>
            {deals.length}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {total > 0 && (
            <span style={{ fontSize: 11, color: "#7a8ca1", fontVariantNumeric: "tabular-nums" }}>
              {formatCurrency(total)}
            </span>
          )}
          <button
            onClick={() => onNewDeal(stageId)}
            style={{
              width: 24, height: 24, borderRadius: 8, border: "1px solid #dbe6f2",
              background: "#fff", cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center", color: "#7a96b0",
              transition: "all 0.15s ease",
            }}
            title={`New deal in ${label}`}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Cards container */}
      <div style={{
        flex: 1, minHeight: 200, borderRadius: 16,
        padding: 10, display: "flex", flexDirection: "column", gap: 10,
        background: isClosed ? "#f4f6f9" : "#f9fbfe",
        border: "1px solid #e8eef5",
        overflowY: "auto",
        opacity: isClosed ? 0.85 : 1,
      }}>
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} onClick={() => onCardClick(deal)} />
        ))}
        {deals.length === 0 && (
          <div style={{
            display: "flex", height: 80, alignItems: "center", justifyContent: "center",
            borderRadius: 12, border: "2px dashed #dbe6f2",
          }}>
            <span style={{ fontSize: 12, color: "#96a7ba" }}>No deals</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create Deal Modal ───────────────────────────────────────────────────────

function CreateDealModal({ pipelineType, defaultStage, companies, users, onClose, onCreated }: {
  pipelineType: string; defaultStage: string; companies: Company[]; users: User[];
  onClose: () => void; onCreated: (deal: Deal) => void;
}) {
  const [form, setForm] = useState({
    name: "", company_id: "", value: "", stage: defaultStage,
    close_date_est: "", priority: "normal", assigned_to_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const stages = pipelineType === "deal" ? DEAL_STAGES : PROSPECT_STAGES;

  const handleCreate = async () => {
    if (!form.name.trim()) { setError("Deal name is required"); return; }
    setSaving(true); setError("");
    try {
      const deal = await dealsApi.create({
        name: form.name.trim(),
        pipeline_type: pipelineType,
        stage: form.stage,
        company_id: form.company_id || undefined,
        value: form.value ? Number(form.value) : undefined,
        close_date_est: form.close_date_est || undefined,
        priority: form.priority,
        assigned_to_id: form.assigned_to_id || undefined,
      } as Partial<Deal>);
      onCreated(deal);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally { setSaving(false); }
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 40 }} onClick={onClose} />
      <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{
          width: "100%", maxWidth: 480, borderRadius: 20, background: "#fff",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)", padding: 28,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1f2d3d" }}>
              New {pipelineType === "deal" ? "Deal" : "Prospect"}
            </h3>
            <button onClick={onClose} style={{ color: "#7a8ea4", cursor: "pointer", background: "none", border: "none" }}>
              <X size={18} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              style={{ height: 42, borderRadius: 12, border: "1px solid #d7e2ee", padding: "0 14px", fontSize: 14 }}
              placeholder={pipelineType === "deal" ? "Deal name" : "Prospect name"}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <select
              style={{ height: 42, borderRadius: 12, border: "1px solid #d7e2ee", padding: "0 14px", fontSize: 14, background: "#fff" }}
              value={form.company_id}
              onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
            >
              <option value="">Select company (optional)</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <input
                type="number"
                style={{ height: 42, borderRadius: 12, border: "1px solid #d7e2ee", padding: "0 14px", fontSize: 14 }}
                placeholder="Value"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              />
              <select
                style={{ height: 42, borderRadius: 12, border: "1px solid #d7e2ee", padding: "0 14px", fontSize: 14, background: "#fff" }}
                value={form.stage}
                onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
              >
                {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <select
                style={{ height: 42, borderRadius: 12, border: "1px solid #d7e2ee", padding: "0 14px", fontSize: 14, background: "#fff" }}
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              >
                <option value="normal">Normal priority</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="low">Low</option>
              </select>
              <select
                style={{ height: 42, borderRadius: 12, border: "1px solid #d7e2ee", padding: "0 14px", fontSize: 14, background: "#fff" }}
                value={form.assigned_to_id}
                onChange={(e) => setForm((f) => ({ ...f, assigned_to_id: e.target.value }))}
              >
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CalendarDays size={14} style={{ color: "#7a96b0" }} />
              <input
                type="date"
                style={{ flex: 1, height: 42, borderRadius: 12, border: "1px solid #d7e2ee", padding: "0 14px", fontSize: 13, color: "#2d4258" }}
                value={form.close_date_est}
                onChange={(e) => setForm((f) => ({ ...f, close_date_est: e.target.value }))}
              />
            </div>
          </div>

          {error && <p style={{ fontSize: 12, color: "#b94a24", fontWeight: 600, marginTop: 12 }}>{error}</p>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button className="crm-button soft" onClick={onClose}>Cancel</button>
            <button className="crm-button primary" onClick={handleCreate} disabled={saving}>
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Convert to Deal Modal (Prospects) ───────────────────────────────────────

function ConvertToDealModal({ deal, onClose, onConverted }: {
  deal: Deal; onClose: () => void; onConverted: (newDeal: Deal) => void;
}) {
  const [form, setForm] = useState({
    name: `${deal.company_name ?? deal.name}`,
    stage: "demo_scheduled",
    value: "",
  });
  const [saving, setSaving] = useState(false);

  const handleConvert = async () => {
    setSaving(true);
    try {
      const newDeal = await dealsApi.create({
        name: form.name.trim() || deal.name,
        pipeline_type: "deal",
        stage: form.stage,
        company_id: deal.company_id,
        value: form.value ? Number(form.value) : undefined,
        assigned_to_id: deal.assigned_to_id,
      } as Partial<Deal>);
      // Move prospect to converted
      await dealsApi.moveStage(deal.id, "converted");
      onConverted(newDeal);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 40 }} onClick={onClose} />
      <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 420, borderRadius: 20, background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", padding: 28 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1f2d3d", marginBottom: 16 }}>Convert to Deal</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              style={{ height: 42, borderRadius: 12, border: "1px solid #d7e2ee", padding: "0 14px", fontSize: 14 }}
              placeholder="Deal name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <select
              style={{ height: 42, borderRadius: 12, border: "1px solid #d7e2ee", padding: "0 14px", fontSize: 14, background: "#fff" }}
              value={form.stage}
              onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
            >
              {DEAL_STAGES.filter((s) => s.group === "active").map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <input
              type="number"
              style={{ height: 42, borderRadius: 12, border: "1px solid #d7e2ee", padding: "0 14px", fontSize: 14 }}
              placeholder="Amount (optional)"
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button className="crm-button soft" onClick={onClose}>Cancel</button>
            <button className="crm-button primary" onClick={handleConvert} disabled={saving}>
              {saving ? "Converting..." : "Convert"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main Pipeline Page ──────────────────────────────────────────────────────

export default function Pipeline() {
  const [tab, setTab] = useState<PipelineTab>("deal");
  const [board, setBoard] = useState<Record<string, Deal[]>>({});
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [stageGroup, setStageGroup] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");

  // Modals / drawers
  const [createStage, setCreateStage] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [convertDeal, setConvertDeal] = useState<Deal | null>(null);

  const loadBoard = async () => {
    setLoading(true);
    try {
      const [b, cs, us] = await Promise.all([
        dealsApi.board(tab),
        companiesApi.list(),
        authApi.listUsers().catch(() => []),
      ]);
      setBoard(b);
      setCompanies(cs);
      setUsers(us);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBoard(); }, [tab]);

  const stages = tab === "deal" ? DEAL_STAGES : PROSPECT_STAGES;

  // Apply filters
  const filteredBoard: Record<string, Deal[]> = {};
  for (const stage of stages) {
    let deals = board[stage.id] ?? [];

    if (search) {
      const q = search.toLowerCase();
      deals = deals.filter((d) =>
        d.name.toLowerCase().includes(q) ||
        (d.company_name ?? "").toLowerCase().includes(q)
      );
    }
    if (stageGroup !== "all") {
      if (stageGroup !== stage.group) continue;
    }
    if (priorityFilter !== "all") {
      deals = deals.filter((d) => d.priority === priorityFilter);
    }
    if (assigneeFilter !== "all") {
      if (assigneeFilter === "unassigned") {
        deals = deals.filter((d) => !d.assigned_to_id);
      } else {
        deals = deals.filter((d) => d.assigned_to_id === assigneeFilter);
      }
    }
    filteredBoard[stage.id] = deals;
  }

  const allDeals = Object.values(board).flat();
  const activeDeals = allDeals.filter((d) => {
    const s = stages.find((st) => st.id === d.stage);
    return s?.group === "active";
  });
  const totalValue = activeDeals.reduce((s, d) => s + (d.value ?? 0), 0);

  const handleDealUpdated = (updated: Deal) => {
    setBoard((prev) => {
      const next = { ...prev };
      // Remove from old position
      for (const key of Object.keys(next)) {
        next[key] = next[key].filter((d) => d.id !== updated.id);
      }
      // Add to new stage
      if (!next[updated.stage]) next[updated.stage] = [];
      next[updated.stage].push(updated);
      return next;
    });
    setSelectedDeal(updated);
  };

  const handleDealCreated = (deal: Deal) => {
    setBoard((prev) => ({
      ...prev,
      [deal.stage]: [...(prev[deal.stage] ?? []), deal],
    }));
  };

  const hasActiveFilters = search || stageGroup !== "all" || priorityFilter !== "all" || assigneeFilter !== "all";

  return (
    <>
      <div className="crm-page pipeline-page" style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>

        {/* ── Tab cards ──────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 12 }}>
          {/* Deals tab */}
          <button
            type="button"
            onClick={() => { setTab("deal"); setStageGroup("all"); setPriorityFilter("all"); setAssigneeFilter("all"); setSearch(""); }}
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 14,
              padding: "16px 20px", borderRadius: 16, cursor: "pointer",
              border: tab === "deal" ? "1.5px solid #b8d0f0" : "1.5px solid #e8eef5",
              background: tab === "deal"
                ? "linear-gradient(135deg, #f0f6ff 0%, #e8f0fb 100%)"
                : "#fff",
              boxShadow: tab === "deal"
                ? "0 4px 16px rgba(23,80,137,0.08)"
                : "0 2px 8px rgba(17,34,68,0.04)",
              transition: "all 0.15s ease",
              textAlign: "left",
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: tab === "deal" ? "#175089" : "#eaf2ff",
              color: tab === "deal" ? "#fff" : "#175089",
            }}>
              <DollarSign size={17} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#0f2744" }}>Deals</span>
                <span style={{
                  fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 999,
                  background: tab === "deal" ? "#175089" : "#e8f0fb",
                  color: tab === "deal" ? "#fff" : "#175089",
                }}>{allDeals.length}</span>
              </div>
              <div style={{ fontSize: 12, color: "#7a96b0", marginTop: 2 }}>
                Full sales pipeline with stages and tracking
              </div>
            </div>
          </button>

          {/* Prospects tab */}
          <button
            type="button"
            onClick={() => { setTab("prospect"); setStageGroup("all"); setPriorityFilter("all"); setAssigneeFilter("all"); setSearch(""); }}
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 14,
              padding: "16px 20px", borderRadius: 16, cursor: "pointer",
              border: tab === "prospect" ? "1.5px solid #b2e0dc" : "1.5px solid #e8eef5",
              background: tab === "prospect"
                ? "linear-gradient(135deg, #f0faf9 0%, #e6f5f4 100%)"
                : "#fff",
              boxShadow: tab === "prospect"
                ? "0 4px 16px rgba(23,123,117,0.08)"
                : "0 2px 8px rgba(17,34,68,0.04)",
              transition: "all 0.15s ease",
              textAlign: "left",
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: tab === "prospect" ? "#177b75" : "#e7f7f5",
              color: tab === "prospect" ? "#fff" : "#177b75",
            }}>
              <Target size={17} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#0f2744" }}>Prospects</span>
                <span style={{
                  fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 999,
                  background: tab === "prospect" ? "#177b75" : "#e7f7f5",
                  color: tab === "prospect" ? "#fff" : "#177b75",
                }}>-</span>
              </div>
              <div style={{ fontSize: 12, color: "#7a96b0", marginTop: 2 }}>
                Prospect qualification and conversion tracking
              </div>
            </div>
          </button>
        </div>

        {/* ── Filter bar ─────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
          borderRadius: 14, background: "#fff", border: "1px solid #e8eef5",
          boxShadow: "0 2px 8px rgba(17,34,68,0.03)",
        }}>
          {/* Search */}
          <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
            <input
              type="text"
              placeholder="Search deals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%", height: 34, borderRadius: 10,
                border: "1px solid #dbe6f2", paddingLeft: 32, paddingRight: 12,
                fontSize: 13, outline: "none",
              }}
            />
          </div>

          {/* Stage group filter */}
          <StyledSelect value={stageGroup} onChange={setStageGroup} active={stageGroup !== "all"}>
            <option value="all">All Stages</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
          </StyledSelect>

          {/* Priority (deals only) */}
          {tab === "deal" && (
            <StyledSelect value={priorityFilter} onChange={setPriorityFilter} active={priorityFilter !== "all"}>
              <option value="all">Any Priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </StyledSelect>
          )}

          {/* Assignee */}
          <StyledSelect value={assigneeFilter} onChange={setAssigneeFilter} active={assigneeFilter !== "all"}>
            <option value="all">All Reps</option>
            <option value="unassigned">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </StyledSelect>

          {/* Stats */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "#5e738b" }}>
            <span style={{ fontWeight: 700 }}>{activeDeals.length} active</span>
            {totalValue > 0 && <span style={{ fontWeight: 700 }}>{formatCurrency(totalValue)}</span>}
          </div>

          {/* New deal button */}
          <button
            className="crm-button primary"
            onClick={() => setCreateStage(tab === "deal" ? "open" : "todo")}
            style={{ height: 34, fontSize: 13 }}
          >
            <Plus size={14} />
            New {tab === "deal" ? "Deal" : "Prospect"}
          </button>

          {hasActiveFilters && (
            <button
              className="crm-button soft"
              style={{ height: 34, fontSize: 12 }}
              onClick={() => { setSearch(""); setStageGroup("all"); setPriorityFilter("all"); setAssigneeFilter("all"); }}
            >
              Reset
            </button>
          )}
        </div>

        {/* ── Board ──────────────────────────────────────────────────── */}
        {loading ? (
          <div className="crm-panel" style={{ padding: 56, textAlign: "center", color: "#7a96b0" }}>
            Loading pipeline...
          </div>
        ) : (
          <div style={{ flex: 1, overflowX: "auto", paddingBottom: 16 }}>
            <div style={{ display: "flex", gap: 14, minWidth: "max-content" }}>
              {stages.map((stage, i) => {
                // Add divider between active and closed groups
                const prev = stages[i - 1];
                const showDivider = prev && prev.group === "active" && stage.group === "closed";

                return (
                  <div key={stage.id} style={{ display: "flex", gap: 14 }}>
                    {showDivider && (
                      <div style={{
                        width: 1, background: "#dbe6f2", margin: "28px 4px 0",
                        alignSelf: "stretch",
                      }} />
                    )}
                    <Column
                      stageId={stage.id}
                      label={stage.label}
                      group={stage.group}
                      deals={filteredBoard[stage.id] ?? []}
                      onCardClick={setSelectedDeal}
                      onNewDeal={(s) => setCreateStage(s)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Modals / Drawers ───────────────────────────────────────── */}
      {createStage && (
        <CreateDealModal
          pipelineType={tab}
          defaultStage={createStage}
          companies={companies}
          users={users}
          onClose={() => setCreateStage(null)}
          onCreated={handleDealCreated}
        />
      )}

      {selectedDeal && (
        <DealDetailDrawer
          deal={selectedDeal}
          companies={companies}
          users={users}
          stages={stages}
          onClose={() => setSelectedDeal(null)}
          onDealUpdated={handleDealUpdated}
          onConvert={tab === "prospect" ? (d) => { setSelectedDeal(null); setConvertDeal(d); } : undefined}
        />
      )}

      {convertDeal && (
        <ConvertToDealModal
          deal={convertDeal}
          onClose={() => setConvertDeal(null)}
          onConverted={(newDeal) => {
            loadBoard();
            setConvertDeal(null);
          }}
        />
      )}
    </>
  );
}
