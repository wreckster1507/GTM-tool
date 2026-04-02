import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronDown, Clock3, DollarSign, Filter, Globe, GripVertical, Mail, Phone, Plus, RotateCcw, Search, Settings2, Target, UserCircle2 } from "lucide-react";
import { activitiesApi, authApi, companiesApi, contactsApi, dealsApi } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import type { Activity, Company, Contact, Deal, User } from "../types";
import { avatarColor, formatCurrency, formatDate, getInitials } from "../lib/utils";
import DealDetailDrawer from "../components/deal/DealDetailDrawer";

type PipelineTab = "deal" | "prospect";
type ProspectStageId = "outreach" | "in_progress" | "meeting_booked" | "negative_response" | "no_response" | "not_a_fit";
type DragItem = { kind: "deal"; id: string; fromStage: string } | { kind: "prospect"; id: string; fromStage: ProspectStageId };
type StageMeta = { id: string; label: string; group: "active" | "closed" };
type FunnelKey = "tofu" | "mofu" | "bofu";
type FunnelConfig = Record<FunnelKey, string[]>;

const DEAL_STAGES: StageMeta[] = [
  { id: "open", label: "Open", group: "active" },
  { id: "demo_scheduled", label: "Demo Scheduled", group: "active" },
  { id: "demo_done", label: "Demo Done", group: "active" },
  { id: "qualified_lead", label: "Qualified Lead", group: "active" },
  { id: "poc_agreed", label: "POC Agreed", group: "active" },
  { id: "poc_wip", label: "POC WIP", group: "active" },
  { id: "poc_done", label: "POC Done", group: "active" },
  { id: "commercial_negotiation", label: "Negotiation", group: "active" },
  { id: "msa_review", label: "MSA", group: "active" },
  { id: "workshop", label: "Workshop", group: "active" },
  { id: "closed_won", label: "Closed Won", group: "closed" },
  { id: "closed_lost", label: "Closed Lost", group: "closed" },
  { id: "not_a_fit", label: "Not a Fit", group: "closed" },
  { id: "on_hold", label: "On Hold", group: "closed" },
  { id: "nurture", label: "Nurture", group: "closed" },
  { id: "churned", label: "Churned", group: "closed" },
];

const PROSPECT_STAGES: Array<StageMeta & { id: ProspectStageId }> = [
  { id: "outreach", label: "Outreach", group: "active" },
  { id: "in_progress", label: "In Progress", group: "active" },
  { id: "meeting_booked", label: "Meeting Booked", group: "active" },
  { id: "negative_response", label: "Negative Response", group: "closed" },
  { id: "no_response", label: "No Response", group: "closed" },
  { id: "not_a_fit", label: "Not a Fit", group: "closed" },
];

const PRIORITY_COLOR: Record<string, string> = { urgent: "#dc2626", high: "#f59e0b", normal: "#94a3b8", low: "#cbd5e1" };
const STAGE_COLOR: Record<string, string> = {
  open: "#3b82f6", demo_scheduled: "#6366f1", demo_done: "#8b5cf6", qualified_lead: "#2563eb",
  poc_agreed: "#0ea5e9", poc_wip: "#06b6d4", poc_done: "#14b8a6", commercial_negotiation: "#f59e0b",
  msa_review: "#a855f7", workshop: "#f97316", closed_won: "#22c55e", closed_lost: "#94a3b8",
  not_a_fit: "#9ca3af", on_hold: "#a78bfa", nurture: "#67e8f9", churned: "#ef4444",
  outreach: "#2563eb", in_progress: "#7c3aed", meeting_booked: "#0ea5e9", negative_response: "#ef4444", no_response: "#94a3b8",
};
const DEFAULT_FUNNEL: FunnelConfig = {
  tofu: ["qualified_lead", "poc_agreed"],
  mofu: ["poc_wip", "poc_done", "commercial_negotiation", "msa_review", "workshop"],
  bofu: ["closed_won"],
};
const FUNNEL_KEY = "pipeline.deal-funnel-config.v1";

function loadFunnel(): FunnelConfig {
  try {
    const raw = window.localStorage.getItem(FUNNEL_KEY);
    if (!raw) return DEFAULT_FUNNEL;
    const parsed = JSON.parse(raw) as Partial<FunnelConfig>;
    return {
      tofu: Array.isArray(parsed.tofu) ? parsed.tofu : DEFAULT_FUNNEL.tofu,
      mofu: Array.isArray(parsed.mofu) ? parsed.mofu : DEFAULT_FUNNEL.mofu,
      bofu: Array.isArray(parsed.bofu) ? parsed.bofu : DEFAULT_FUNNEL.bofu,
    };
  } catch {
    return DEFAULT_FUNNEL;
  }
}

function saveFunnel(config: FunnelConfig) {
  window.localStorage.setItem(FUNNEL_KEY, JSON.stringify(config));
}

function normalizeGeo(raw?: string | null): "US" | "Americas" | "Rest of World" | "" {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "";
  if (["us", "usa", "united states", "united states of america"].includes(value)) return "US";
  if (["na", "north america", "americas", "latam", "latin america", "canada", "mexico"].includes(value)) return "Americas";
  return "Rest of World";
}

function contactName(contact: Contact) {
  return `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || contact.email || "Unnamed Prospect";
}

function prospectStage(contact: Contact): ProspectStageId {
  const text = [contact.outreach_lane, contact.sequence_status, contact.instantly_status, contact.tracking_stage, contact.tracking_summary].filter(Boolean).join(" ").toLowerCase();
  if ((contact.outreach_lane ?? "").toLowerCase() === "not_a_fit" || text.includes("not a fit")) return "not_a_fit";
  if (text.includes("meeting booked") || text.includes("meeting_booked") || text.includes("call booked") || text.includes("demo booked")) return "meeting_booked";
  if (text.includes("negative") || text.includes("not interested") || text.includes("unsubscribed") || text.includes("do not contact") || text.includes("bounce")) return "negative_response";
  if (text.includes("no response") || text.includes("sequence complete") || text.includes("completed")) return "no_response";
  if (text.includes("active") || text.includes("sent") || text.includes("replied") || text.includes("engaged") || text.includes("queued") || text.includes("in progress")) return "in_progress";
  return "outreach";
}

function prospectPatch(stage: ProspectStageId): Partial<Contact> {
  if (stage === "outreach") return { outreach_lane: "outreach", sequence_status: "draft", instantly_status: "not_started" };
  if (stage === "in_progress") return { outreach_lane: "in_progress", sequence_status: "active", instantly_status: "active" };
  if (stage === "meeting_booked") return { outreach_lane: "meeting_booked", sequence_status: "meeting_booked", instantly_status: "meeting_booked" };
  if (stage === "negative_response") return { outreach_lane: "negative_response", sequence_status: "completed", instantly_status: "negative_response" };
  if (stage === "no_response") return { outreach_lane: "no_response", sequence_status: "completed", instantly_status: "completed" };
  return { outreach_lane: "not_a_fit", sequence_status: "completed", instantly_status: "not_a_fit" };
}

function SidebarSelect({ value, onChange, children, label }: { value: string; onChange: (value: string) => void; children: ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 10, fontWeight: 600, color: "#7a96b0", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</label>
      <div style={{ position: "relative" }}>
        <select value={value} onChange={(event) => onChange(event.target.value)} style={{ width: "100%", appearance: "none", height: 34, borderRadius: 8, border: value !== "all" ? "1.5px solid #b8d0f0" : "1px solid #e2eaf2", background: value !== "all" ? "#f0f6ff" : "#f8fafc", padding: "0 28px 0 10px", fontSize: 12, fontWeight: 500, color: "#2d4258", cursor: "pointer", outline: "none" }}>
          {children}
        </select>
        <ChevronDown size={12} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#7a96b0" }} />
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone = "default", action }: { label: string; value: string | number; tone?: "default" | "accent" | "success"; action?: ReactNode }) {
  const palette = tone === "accent" ? { bg: "#f0f6ff", border: "#b8d0f0", value: "#175089" } : tone === "success" ? { bg: "#f0fdf4", border: "#bbf7d0", value: "#15803d" } : { bg: "#f8fafc", border: "#e8eef5", value: "#48607b" };
  return (
    <div style={{ padding: "10px 10px", borderRadius: 10, background: palette.bg, border: `1px solid ${palette.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: palette.value, lineHeight: 1 }}>{value}</div>
        {action}
      </div>
      <div style={{ fontSize: 10, color: "#7a96b0", marginTop: 3 }}>{label}</div>
    </div>
  );
}

const chip = (background: string, color: string, border: string) => ({ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 5, background, color, border: `1px solid ${border}` } as const);
const modalInputStyle = { height: 42, borderRadius: 12, border: "1px solid #d7e2ee", padding: "0 14px", fontSize: 14 } as const;

function FunnelSettingsModal({ config, onSave, onClose }: { config: FunnelConfig; onSave: (config: FunnelConfig) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<FunnelConfig>(config);
  const toggle = (bucket: FunnelKey, stageId: string) => setDraft((current) => ({
    ...current,
    [bucket]: current[bucket].includes(stageId) ? current[bucket].filter((item) => item !== stageId) : [...current[bucket], stageId],
  }));

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.25)", zIndex: 60 }} onClick={onClose} />
      <div style={{ position: "fixed", inset: 0, zIndex: 61, display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 620, background: "#fff", borderRadius: 20, border: "1px solid #dbe6f2", boxShadow: "0 20px 60px rgba(15,23,42,0.15)", padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1f2d3d" }}>Funnel tier settings</h3>
              <p style={{ fontSize: 12, color: "#6b7f95", marginTop: 4 }}>Choose which deal stages count toward ToFU, MoFU, and BoFU in the summary cards.</p>
            </div>
            <button className="crm-button soft" onClick={onClose}>Close</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
            {(["tofu", "mofu", "bofu"] as FunnelKey[]).map((bucket) => (
              <div key={bucket} style={{ border: "1px solid #e8eef5", borderRadius: 14, padding: 14, background: "#fbfdff" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1f2d3d", marginBottom: 10, textTransform: "uppercase" }}>{bucket}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {DEAL_STAGES.filter((stage) => stage.group === "active" || stage.id === "closed_won").map((stage) => (
                    <label key={`${bucket}-${stage.id}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#41566d" }}>
                      <input type="checkbox" checked={draft[bucket].includes(stage.id)} onChange={() => toggle(bucket, stage.id)} />
                      <span>{stage.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
            <button className="crm-button soft" onClick={() => setDraft(DEFAULT_FUNNEL)}>Reset defaults</button>
            <button className="crm-button primary" onClick={() => onSave(draft)}>Save settings</button>
          </div>
        </div>
      </div>
    </>
  );
}

function CreateDealModal({ defaultStage, companies, users, onClose, onCreated }: { defaultStage: string; companies: Company[]; users: User[]; onClose: () => void; onCreated: (deal: Deal) => void }) {
  const [form, setForm] = useState({ name: "", company_id: "", value: "", stage: defaultStage, close_date_est: "", priority: "normal", assigned_to_id: "", geography: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setError("Deal name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const deal = await dealsApi.create({
        name: form.name.trim(),
        pipeline_type: "deal",
        stage: form.stage,
        company_id: form.company_id || undefined,
        value: form.value ? Number(form.value) : undefined,
        close_date_est: form.close_date_est || undefined,
        priority: form.priority,
        assigned_to_id: form.assigned_to_id || undefined,
        geography: form.geography || undefined,
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      } as Partial<Deal>);
      onCreated(deal);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create deal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.25)", zIndex: 40 }} onClick={onClose} />
      <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 520, borderRadius: 20, background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1f2d3d" }}>New Deal</h3>
            <button onClick={onClose} style={{ color: "#7a8ea4", cursor: "pointer", background: "none", border: "none" }}>Close</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input style={modalInputStyle} placeholder="Deal name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            <select style={{ ...modalInputStyle, background: "#fff" }} value={form.company_id} onChange={(event) => setForm((current) => ({ ...current, company_id: event.target.value }))}>
              <option value="">Select company</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <select style={{ ...modalInputStyle, background: "#fff" }} value={form.stage} onChange={(event) => setForm((current) => ({ ...current, stage: event.target.value }))}>
                {DEAL_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
              <select style={{ ...modalInputStyle, background: "#fff" }} value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <select style={{ ...modalInputStyle, background: "#fff" }} value={form.assigned_to_id} onChange={(event) => setForm((current) => ({ ...current, assigned_to_id: event.target.value }))}>
                <option value="">Unassigned</option>
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
              <select style={{ ...modalInputStyle, background: "#fff" }} value={form.geography} onChange={(event) => setForm((current) => ({ ...current, geography: event.target.value }))}>
                <option value="">Select geography</option>
                <option value="US">US</option>
                <option value="Americas">Americas</option>
                <option value="Rest of World">Rest of World</option>
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <input type="number" style={modalInputStyle} placeholder="Value" value={form.value} onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))} />
              <input type="date" style={modalInputStyle} value={form.close_date_est} onChange={(event) => setForm((current) => ({ ...current, close_date_est: event.target.value }))} />
            </div>
            <input style={modalInputStyle} placeholder="Tags, comma separated" value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} />
          </div>

          {error && <p style={{ fontSize: 12, color: "#b94a24", fontWeight: 600, marginTop: 12 }}>{error}</p>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button className="crm-button soft" onClick={onClose}>Cancel</button>
            <button className="crm-button primary" onClick={handleCreate} disabled={saving}>{saving ? "Creating..." : "Create deal"}</button>
          </div>
        </div>
      </div>
    </>
  );
}

function DealCard({ deal, onClick, onDragStart }: { deal: Deal; onClick: () => void; onDragStart: () => void }) {
  const isOverdue = deal.close_date_est && new Date(deal.close_date_est) < new Date();
  return (
    <button type="button" draggable onDragStart={onDragStart} onClick={onClick} style={{ width: "100%", textAlign: "left", cursor: "pointer", borderRadius: 14, border: "1px solid #e8eef5", background: "#fff", boxShadow: "0 1px 4px rgba(17,34,68,0.04)", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <GripVertical size={12} style={{ color: "#94a3b8", marginTop: 3, flexShrink: 0 }} />
        <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 5, background: PRIORITY_COLOR[deal.priority] ?? "#94a3b8" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "#1f2d3d", lineHeight: 1.35, flex: 1 }}>{deal.name}</span>
      </div>
      {deal.company_name && <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#5e738b" }}><Building2 size={11} /><span>{deal.company_name}</span></div>}
      <div style={{ fontSize: 15, fontWeight: 700, color: deal.value ? "#1f2a37" : "#b4c3d4" }}>{formatCurrency(deal.value)}</div>
      {deal.next_step && <div style={{ fontSize: 11, color: "#2563eb", fontWeight: 500, lineHeight: 1.3 }}>{deal.next_step}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {(deal.tags ?? []).slice(0, 2).map((tag) => <span key={tag} style={chip("#f8f0ff", "#6b46a0", "#e8d8f8")}>{tag}</span>)}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid #f0f4f8", marginTop: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {deal.assigned_rep_name ? <div className={`flex items-center justify-center rounded-full text-[9px] font-bold ${avatarColor(deal.assigned_rep_name)}`} style={{ width: 20, height: 20 }}>{getInitials(deal.assigned_rep_name)}</div> : <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#e8eef5" }} />}
          <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#7a8ca1" }}><Clock3 size={10} /><span>{deal.days_in_stage ?? 0}d</span></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {deal.close_date_est && <span style={{ fontSize: 10, color: isOverdue ? "#dc2626" : "#7a8ca1", fontWeight: isOverdue ? 600 : 400 }}>{formatDate(deal.close_date_est)}</span>}
          {(deal.contact_count ?? 0) > 0 && <span style={{ fontSize: 10, color: "#5e738b", display: "flex", alignItems: "center", gap: 2 }}><UserCircle2 size={10} />{deal.contact_count}</span>}
        </div>
      </div>
    </button>
  );
}

function ProspectCard({ contact, company, onOpen, onDragStart }: { contact: Contact; company?: Company; onOpen: () => void; onDragStart: () => void }) {
  return (
    <button type="button" draggable onDragStart={onDragStart} onClick={onOpen} style={{ width: "100%", textAlign: "left", cursor: "pointer", borderRadius: 14, border: "1px solid #e8eef5", background: "#fff", boxShadow: "0 1px 4px rgba(17,34,68,0.04)", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <GripVertical size={12} style={{ color: "#94a3b8", marginTop: 3, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1f2d3d", lineHeight: 1.3 }}>{contactName(contact)}</div>
          <div style={{ fontSize: 11, color: "#5e738b", marginTop: 2 }}>{contact.title || contact.persona || "Prospect"}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#5e738b" }}><Building2 size={11} /><span>{contact.company_name || company?.name || "Unknown company"}</span></div>
      {contact.tracking_summary && <div style={{ fontSize: 11, color: "#2563eb", fontWeight: 500, lineHeight: 1.35 }}>{contact.tracking_summary}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {contact.persona && <span style={chip("#eef4ff", "#24567e", "#d7e6ff")}>{contact.persona}</span>}
        {contact.tracking_label && <span style={chip("#effcf6", "#047857", "#bbf7d0")}>{contact.tracking_label}</span>}
        {typeof contact.tracking_score === "number" && <span style={chip("#fff7ed", "#c2410c", "#fed7aa")}>{contact.tracking_score}/100</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid #f0f4f8", marginTop: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {(contact.assigned_to_name || contact.sdr_name) ? <div className={`flex items-center justify-center rounded-full text-[9px] font-bold ${avatarColor(contact.assigned_to_name || contact.sdr_name || "")}`} style={{ width: 20, height: 20 }}>{getInitials(contact.assigned_to_name || contact.sdr_name || "RP")}</div> : <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#e8eef5" }} />}
          <div style={{ fontSize: 10, color: "#7a8ca1" }}>{contact.sequence_status || contact.instantly_status || "ready"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#7a8ca1" }}>
          {contact.email && <Mail size={11} />}
          {contact.phone && <Phone size={11} />}
          {contact.linkedin_url && <Globe size={11} />}
        </div>
      </div>
    </button>
  );
}

function BoardColumn({ stage, count, totalValue, dropActive, onAdd, onDrop, children }: { stage: StageMeta; count: number; totalValue?: number; dropActive: boolean; onAdd?: () => void; onDrop: () => void; children: ReactNode }) {
  return (
    <div style={{ width: 286, flexShrink: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, padding: "0 4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: STAGE_COLOR[stage.id] ?? "#94a3b8" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: stage.group === "closed" ? "#7a8ca1" : "#2d4258" }}>{stage.label}</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: "#ecf1f7", color: "#48607b" }}>{count}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {typeof totalValue === "number" && totalValue > 0 && <span style={{ fontSize: 10, color: "#7a96b0" }}>{formatCurrency(totalValue)}</span>}
          {onAdd && <button onClick={onAdd} style={{ width: 22, height: 22, borderRadius: 7, border: "1px solid #dbe6f2", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#7a96b0" }}><Plus size={12} /></button>}
        </div>
      </div>
      <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(); }} style={{ flex: 1, minHeight: 240, borderRadius: 14, padding: 8, display: "flex", flexDirection: "column", gap: 8, background: dropActive ? "#eef6ff" : stage.group === "closed" ? "#f4f6f9" : "#f9fbfe", border: dropActive ? "1px solid #93c5fd" : "1px solid #e8eef5", overflowY: "auto", transition: "all 0.15s ease" }}>
        {children}
      </div>
    </div>
  );
}

function ProspectDetailDrawer({
  contact,
  company,
  activities,
  loading,
  onConvert,
  converting,
  onClose,
}: {
  contact: Contact;
  company?: Company;
  activities: Activity[];
  loading: boolean;
  onConvert?: () => Promise<void>;
  converting?: boolean;
  onClose: () => void;
}) {
  const fullName = contactName(contact);
  const stage = prospectStage(contact);
  const stageLabel = PROSPECT_STAGES.find((item) => item.id === stage)?.label ?? stage;
  const canConvert = stage === "meeting_booked";
  const positiveSignals = activities.filter((item) => {
    const text = `${item.ai_summary ?? ""} ${item.content ?? ""} ${item.call_outcome ?? ""}`.toLowerCase();
    return text.includes("interested") || text.includes("positive") || text.includes("meeting booked") || text.includes("answered");
  }).length;

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.22)", backdropFilter: "blur(3px)", zIndex: 50 }} onClick={onClose} />
      <div style={{ position: "fixed", top: 12, right: 12, bottom: 12, width: "min(760px, calc(100vw - 24px))", zIndex: 51, background: "#fff", border: "1px solid #dfe8f2", borderRadius: 22, boxShadow: "-18px 0 60px rgba(15, 23, 42, 0.16)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "22px 28px 18px", borderBottom: "1px solid #e8eef5", display: "flex", flexDirection: "column", gap: 12, background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#1f2d3d" }}>{fullName}</div>
              <div style={{ marginTop: 6, color: "#5e738b", fontSize: 14 }}>{contact.title || "Prospect"} {company ? `at ${company.name}` : ""}</div>
            </div>
            <button onClick={onClose} style={{ color: "#7a96b0", cursor: "pointer", background: "none", border: "none" }}>Close</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#eef4ff", color: "#175089", border: "1px solid #c8daf0" }}>{stageLabel}</span>
            {contact.tracking_label && <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#effcf6", color: "#047857", border: "1px solid #bbf7d0" }}>{contact.tracking_label}</span>}
            {typeof contact.tracking_score === "number" && <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" }}>{contact.tracking_score}/100</span>}
            {canConvert && <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#ecfdf5", color: "#15803d", border: "1px solid #bbf7d0" }}>Ready to convert to deal</span>}
            {canConvert && onConvert && (
              <button
                type="button"
                disabled={converting}
                onClick={onConvert}
                style={{ borderRadius: 10, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", padding: "8px 12px", fontSize: 12, fontWeight: 800, cursor: converting ? "wait" : "pointer" }}
              >
                {converting ? "Converting..." : "Convert to Deal"}
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px 28px", display: "grid", gap: 18, background: "#fcfdff" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <SummaryCard label="Status" value={stageLabel} tone="accent" />
            <SummaryCard label="Positive signals" value={positiveSignals} tone="success" />
            <SummaryCard label="Last signal" value={activities[0] ? formatDate(activities[0].created_at) : "No activity"} />
          </div>

          <div style={{ border: "1px solid #e8eef5", borderRadius: 16, background: "#fff", padding: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#1f2d3d", marginBottom: 12 }}>Contact Actions</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {contact.email && <a href={`mailto:${contact.email}`} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 12, border: "1px solid #cfe0fb", background: "#eef5ff", color: "#1f6feb", padding: "10px 12px", fontSize: 13, fontWeight: 700 }}><Mail size={14} />Email</a>}
              {contact.phone && <button type="button" onClick={() => window.__aircallDial?.(contact.phone!, fullName || undefined)} style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 12, border: "1px solid #bfe8d1", background: "#e8f8f0", color: "#1f8f5f", padding: "10px 12px", fontSize: 13, fontWeight: 700 }}><Phone size={14} />Call</button>}
              {contact.linkedin_url && <a href={contact.linkedin_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 12, border: "1px solid #d9e1ec", background: "#fff", color: "#55657a", padding: "10px 12px", fontSize: 13, fontWeight: 700 }}><Globe size={14} />LinkedIn</a>}
            </div>
          </div>

          <div style={{ border: "1px solid #e8eef5", borderRadius: 16, background: "#fff", padding: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#1f2d3d", marginBottom: 12 }}>Prospect Activity</div>
            <div style={{ color: "#6b7f95", fontSize: 13, marginBottom: 12 }}>
              Instantly drives email status and responses, Aircall drives call outcomes and insights, and Beacon keeps the timeline automatic.
            </div>
            {loading ? (
              <div style={{ color: "#7a96b0", fontSize: 13 }}>Loading activity...</div>
            ) : activities.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>No synced activity yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {activities.map((activity) => {
                  const source = (activity.source || "beacon").toLowerCase();
                  const positive = `${activity.ai_summary ?? ""} ${activity.content ?? ""}`.toLowerCase().includes("replied") || `${activity.ai_summary ?? ""} ${activity.content ?? ""}`.toLowerCase().includes("interested");
                  return (
                    <div key={activity.id} style={{ border: "1px solid #e8eef5", borderRadius: 14, background: positive ? "#f0fdf4" : "#fbfdff", padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#1f2d3d", textTransform: "capitalize" }}>{activity.type.replace(/_/g, " ")}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: source.includes("instantly") ? "#eef4ff" : source.includes("aircall") ? "#fff7ed" : "#f5f8fc", color: source.includes("instantly") ? "#175089" : source.includes("aircall") ? "#c2410c" : "#60758b" }}>
                            {source.includes("instantly") ? "Instantly" : source.includes("aircall") ? "Aircall" : activity.source || "Beacon"}
                          </span>
                          {positive && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#166534" }}>Client response</span>}
                        </div>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{formatDate(activity.created_at)}</span>
                      </div>
                      {activity.call_outcome && <div style={{ marginTop: 8, fontSize: 12, color: "#475569" }}>Call outcome: {activity.call_outcome}</div>}
                      {activity.email_subject && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#1f2d3d" }}>{activity.email_subject}</div>}
                      {activity.ai_summary && <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 10, background: positive ? "#dcfce7" : "#eef4ff", color: positive ? "#166534" : "#175089", fontSize: 12, fontWeight: 600 }}>{activity.ai_summary}</div>}
                      {!activity.ai_summary && activity.content && <div style={{ marginTop: 8, fontSize: 12, color: "#475569", lineHeight: 1.55 }}>{activity.content}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function Pipeline() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<PipelineTab>("deal");
  const [dealBoard, setDealBoard] = useState<Record<string, Deal[]>>({});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stageGroup, setStageGroup] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [geographyFilter, setGeographyFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [createDealStage, setCreateDealStage] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [selectedProspect, setSelectedProspect] = useState<Contact | null>(null);
  const [prospectActivities, setProspectActivities] = useState<Activity[]>([]);
  const [loadingProspectActivities, setLoadingProspectActivities] = useState(false);
  const [convertingProspect, setConvertingProspect] = useState(false);
  const [pendingConvertProspect, setPendingConvertProspect] = useState<Contact | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [showFunnelSettings, setShowFunnelSettings] = useState(false);
  const [funnelConfig, setFunnelConfig] = useState<FunnelConfig>(() => loadFunnel());

  const companyMap = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const allDeals = useMemo(() => Object.values(dealBoard).flat(), [dealBoard]);
  const dealTags = useMemo(() => Array.from(new Set(allDeals.flatMap((deal) => deal.tags ?? []))).sort((a, b) => a.localeCompare(b)), [allDeals]);

  const loadBoard = async () => {
    setLoading(true);
    try {
      const [board, companyList, userList, contactList] = await Promise.all([
        dealsApi.board("deal"),
        companiesApi.list(),
        authApi.listAllUsers().catch(() => []),
        contactsApi.list(0, 500),
      ]);
      setDealBoard(board);
      setCompanies(companyList);
      setUsers(userList);
      setContacts(contactList);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoard();
  }, []);

  useEffect(() => {
    if (!selectedProspect) {
      setProspectActivities([]);
      setLoadingProspectActivities(false);
      return;
    }
    setLoadingProspectActivities(true);
    activitiesApi
      .list(undefined, selectedProspect.id)
      .then(setProspectActivities)
      .catch(() => setProspectActivities([]))
      .finally(() => setLoadingProspectActivities(false));
  }, [selectedProspect]);

  const filteredDealBoard = useMemo(() => {
    const next: Record<string, Deal[]> = {};
    for (const stage of DEAL_STAGES) {
      let items = dealBoard[stage.id] ?? [];
      if (search) {
        const q = search.toLowerCase();
        items = items.filter((deal) => deal.name.toLowerCase().includes(q) || (deal.company_name ?? "").toLowerCase().includes(q));
      }
      if (stageGroup !== "all" && stage.group !== stageGroup) items = [];
      if (assigneeFilter !== "all") items = assigneeFilter === "unassigned" ? items.filter((deal) => !deal.assigned_to_id) : items.filter((deal) => deal.assigned_to_id === assigneeFilter);
      if (geographyFilter !== "all") items = items.filter((deal) => normalizeGeo(deal.geography) === geographyFilter);
      if (tagFilter !== "all") items = items.filter((deal) => (deal.tags ?? []).includes(tagFilter));
      next[stage.id] = items;
    }
    return next;
  }, [assigneeFilter, dealBoard, geographyFilter, search, stageGroup, tagFilter]);

  const filteredProspects = useMemo(() => {
    const next: Record<ProspectStageId, Contact[]> = { outreach: [], in_progress: [], meeting_booked: [], negative_response: [], no_response: [], not_a_fit: [] };
    contacts.forEach((contact) => {
      const stage = prospectStage(contact);
      const company = contact.company_id ? companyMap.get(contact.company_id) : undefined;
      const text = `${contactName(contact)} ${contact.email ?? ""} ${contact.title ?? ""} ${contact.company_name ?? company?.name ?? ""}`.toLowerCase();
      if (search && !text.includes(search.toLowerCase())) return;
      if (stageGroup !== "all" && PROSPECT_STAGES.find((item) => item.id === stage)?.group !== stageGroup) return;
      if (assigneeFilter !== "all") {
        if (assigneeFilter === "unassigned") {
          if (contact.assigned_to_id || contact.sdr_id) return;
        } else if (contact.assigned_to_id !== assigneeFilter && contact.sdr_id !== assigneeFilter) return;
      }
      if (geographyFilter !== "all" && normalizeGeo(company?.region) !== geographyFilter) return;
      next[stage].push(contact);
    });
    return next;
  }, [assigneeFilter, companyMap, contacts, geographyFilter, search, stageGroup]);

  const dealSummary = useMemo(() => {
    const visible = Object.values(filteredDealBoard).flat();
    return {
      total: visible.length,
      active: visible.filter((deal) => DEAL_STAGES.find((stage) => stage.id === deal.stage)?.group === "active").length,
      closed: visible.filter((deal) => DEAL_STAGES.find((stage) => stage.id === deal.stage)?.group === "closed").length,
      tofu: visible.filter((deal) => funnelConfig.tofu.includes(deal.stage)).length,
      mofu: visible.filter((deal) => funnelConfig.mofu.includes(deal.stage)).length,
      bofu: visible.filter((deal) => funnelConfig.bofu.includes(deal.stage)).length,
    };
  }, [filteredDealBoard, funnelConfig]);

  const prospectSummary = useMemo(() => ({
    total: Object.values(filteredProspects).flat().length,
    active: filteredProspects.outreach.length + filteredProspects.in_progress.length + filteredProspects.meeting_booked.length,
    closed: filteredProspects.negative_response.length + filteredProspects.no_response.length + filteredProspects.not_a_fit.length,
    tofu: filteredProspects.outreach.length,
    mofu: filteredProspects.in_progress.length,
    bofu: filteredProspects.meeting_booked.length,
  }), [filteredProspects]);

  const summary = tab === "deal" ? dealSummary : prospectSummary;
  const hasFilters = Boolean(search) || stageGroup !== "all" || assigneeFilter !== "all" || geographyFilter !== "all" || tagFilter !== "all";
  const stages = tab === "deal" ? DEAL_STAGES : PROSPECT_STAGES;
  const accentColor = tab === "deal" ? "#175089" : "#177b75";
  const accentBg = tab === "deal" ? "#f0f6ff" : "#f0faf9";
  const accentBorder = tab === "deal" ? "#b8d0f0" : "#b2e0dc";

  const resetFilters = () => {
    setSearch("");
    setStageGroup("all");
    setAssigneeFilter("all");
    setGeographyFilter("all");
    setTagFilter("all");
  };

  const handleDealUpdated = (updated: Deal) => {
    setDealBoard((current) => {
      const next: Record<string, Deal[]> = {};
      for (const [stageId, items] of Object.entries(current)) next[stageId] = items.filter((deal) => deal.id !== updated.id);
      next[updated.stage] = [...(next[updated.stage] ?? []), updated];
      return next;
    });
    setSelectedDeal(updated);
  };

  const handleDealDeleted = (dealId: string) => {
    setDealBoard((current) => {
      const next: Record<string, Deal[]> = {};
      for (const [stageId, items] of Object.entries(current)) next[stageId] = items.filter((deal) => deal.id !== dealId);
      return next;
    });
    setSelectedDeal(null);
  };

  const handleDealCreated = (deal: Deal) => setDealBoard((current) => ({ ...current, [deal.stage]: [...(current[deal.stage] ?? []), deal] }));

  const handleDealDrop = async (targetStage: string) => {
    if (!dragItem || dragItem.kind !== "deal" || dragItem.fromStage === targetStage) return;
    setBusyStage(targetStage);
    try {
      await dealsApi.moveStage(dragItem.id, targetStage);
      await loadBoard();
    } finally {
      setBusyStage(null);
      setDragItem(null);
    }
  };

  const handleProspectDrop = async (targetStage: ProspectStageId) => {
    if (!dragItem || dragItem.kind !== "prospect" || dragItem.fromStage === targetStage) return;
    const draggedProspect = contacts.find((contact) => contact.id === dragItem.id) ?? null;
    setBusyStage(targetStage);
    try {
      await contactsApi.update(dragItem.id, prospectPatch(targetStage));
      await loadBoard();
      if (targetStage === "meeting_booked" && draggedProspect?.company_id) {
        setPendingConvertProspect({
          ...draggedProspect,
          ...prospectPatch(targetStage),
          tracking_stage: "meeting_booked",
        } as Contact);
      }
    } finally {
      setBusyStage(null);
      setDragItem(null);
    }
  };

  const handleConvertProspectToDeal = async (prospect?: Contact | null) => {
    const sourceProspect = prospect ?? selectedProspect;
    if (!sourceProspect || !sourceProspect.company_id) return;
    const company = companyMap.get(sourceProspect.company_id);
    setConvertingProspect(true);
    try {
      const deal = await dealsApi.create({
        name: `${company?.name ?? sourceProspect.company_name ?? "Account"} - ${contactName(sourceProspect)}`,
        pipeline_type: "deal",
        stage: "demo_done",
        company_id: sourceProspect.company_id,
        assigned_to_id: sourceProspect.assigned_to_id || undefined,
        geography: normalizeGeo(company?.region) || undefined,
        tags: ["converted_from_prospect"],
        next_step: "Review booked meeting and align demo follow-up",
      } as Partial<Deal>);
      await dealsApi.addContact(deal.id, sourceProspect.id, "champion");
      setPendingConvertProspect(null);
      setSelectedProspect(null);
      setSelectedDeal(deal);
      await loadBoard();
    } finally {
      setConvertingProspect(false);
    }
  };

  return (
    <>
      <div className="crm-page pipeline-page" style={{ display: "flex", flexDirection: "row", alignItems: "stretch", height: "100%", minHeight: 0, gap: 0 }}>
        <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", background: "#fff", borderRight: "1px solid #e8eef5", padding: "20px 16px", gap: 18, overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#7a96b0", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>Pipeline</span>
            {[{ key: "deal" as const, label: "Deals", sub: "Sales pipeline", icon: DollarSign, active: "#175089", soft: "#eaf2ff" }, { key: "prospect" as const, label: "Prospects", sub: "Live outreach board", icon: Target, active: "#177b75", soft: "#e7f7f5" }].map((item) => {
              const Icon = item.icon;
              const active = tab === item.key;
              return (
                <button key={item.key} type="button" onClick={() => { setTab(item.key); resetFilters(); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer", border: active ? `1.5px solid ${item.key === "deal" ? "#b8d0f0" : "#b2e0dc"}` : "1.5px solid transparent", background: active ? (item.key === "deal" ? "#f0f6ff" : "#f0faf9") : "transparent", textAlign: "left" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: active ? item.active : item.soft, color: active ? "#fff" : item.active }}><Icon size={15} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600, color: active ? "#0f2744" : "#4d6178" }}>{item.label}</div><div style={{ fontSize: 10, color: "#7a96b0", marginTop: 1 }}>{item.sub}</div></div>
                </button>
              );
            })}
          </div>

          <div style={{ height: 1, background: "#e8eef5" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#7a96b0", textTransform: "uppercase", letterSpacing: "0.5px" }}>Summary</span>
            {tab === "deal" && <button type="button" onClick={() => setShowFunnelSettings(true)} style={{ border: "1px solid #dbe6f2", background: "#fff", borderRadius: 8, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#5e738b", cursor: "pointer" }} title="Funnel settings"><Settings2 size={14} /></button>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <SummaryCard label="Active" value={summary.active} tone="accent" />
            <SummaryCard label="Closed" value={summary.closed} />
            <SummaryCard label="ToFU" value={summary.tofu} />
            <SummaryCard label="MoFU" value={summary.mofu} />
            <SummaryCard label="BoFU" value={summary.bofu} tone="success" />
            <SummaryCard label="Total" value={summary.total} />
          </div>

          <div style={{ height: 1, background: "#e8eef5" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#7a96b0", textTransform: "uppercase", letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: 4 }}><Filter size={10} />Filters</span>
              {hasFilters && <button onClick={resetFilters} style={{ fontSize: 10, color: "#dc2626", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 3, fontWeight: 500 }}><RotateCcw size={9} />Reset</button>}
            </div>
            <div style={{ position: "relative" }}>
              <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
              <input type="text" placeholder={`Search ${tab === "deal" ? "deals" : "prospects"}...`} value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: "100%", height: 32, borderRadius: 8, border: search ? "1.5px solid #b8d0f0" : "1px solid #e2eaf2", background: search ? "#f0f6ff" : "#f8fafc", paddingLeft: 28, paddingRight: 10, fontSize: 12, outline: "none" }} />
            </div>
            <SidebarSelect value={stageGroup} onChange={setStageGroup} label="Stage"><option value="all">All Stages</option><option value="active">Active Only</option><option value="closed">Closed Only</option></SidebarSelect>
            <SidebarSelect value={assigneeFilter} onChange={setAssigneeFilter} label="Assignee"><option value="all">All Reps</option><option value="unassigned">Unassigned</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</SidebarSelect>
            <SidebarSelect value={geographyFilter} onChange={setGeographyFilter} label="Geography"><option value="all">All Geographies</option><option value="US">US</option><option value="Americas">Americas</option><option value="Rest of World">Rest of World</option></SidebarSelect>
            {tab === "deal" && <SidebarSelect value={tagFilter} onChange={setTagFilter} label="Tags"><option value="all">All Tags</option>{dealTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</SidebarSelect>}
          </div>

          <div style={{ flex: 1 }} />
          {tab === "deal"
            ? <button className="crm-button primary" onClick={() => setCreateDealStage("open")} style={{ width: "100%", height: 38, fontSize: 13, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: accentColor }}><Plus size={14} />New Deal</button>
            : <button className="crm-button primary" onClick={() => navigate("/prospecting")} style={{ width: "100%", height: 38, fontSize: 13, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: accentColor }}><Target size={14} />Open Prospecting</button>}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #e8eef5", background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f2744", margin: 0 }}>{tab === "deal" ? "Deals" : "Prospects"} Board</h2>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 999, background: accentBg, color: accentColor, border: `1px solid ${accentBorder}` }}>{summary.total} visible</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#6b7f95" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><GripVertical size={11} />Drag cards across lanes</span>
              {busyStage && <span style={{ color: "#2563eb", fontWeight: 600 }}>Updating lane...</span>}
            </div>
          </div>

          {loading ? <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#7a96b0" }}>Loading pipeline...</div> : (
            <div style={{ flex: 1, overflowX: "auto", padding: "16px 16px 16px 20px" }}>
              <div style={{ display: "flex", gap: 12, minWidth: "max-content", height: "100%" }}>
                {(tab === "deal" ? stages : PROSPECT_STAGES).map((stage, index) => {
                  const divider = index > 0 && (tab === "deal" ? DEAL_STAGES[index - 1]?.group : PROSPECT_STAGES[index - 1]?.group) === "active" && stage.group === "closed";
                  const dealItems = filteredDealBoard[stage.id] ?? [];
                  const prospectItems = filteredProspects[stage.id as ProspectStageId] ?? [];
                  return (
                    <div key={stage.id} style={{ display: "flex", gap: 12, height: "100%" }}>
                      {divider && <div style={{ width: 1, background: "linear-gradient(180deg, #dbe6f2 0%, transparent 100%)", margin: "28px 2px 0", alignSelf: "stretch" }} />}
                      <BoardColumn stage={stage} count={tab === "deal" ? dealItems.length : prospectItems.length} totalValue={tab === "deal" ? dealItems.reduce((sum, deal) => sum + (deal.value ?? 0), 0) : undefined} dropActive={dragItem ? (dragItem.kind === "deal" ? tab === "deal" && dragItem.fromStage !== stage.id : tab === "prospect" && dragItem.fromStage !== stage.id) : false} onAdd={tab === "deal" ? () => setCreateDealStage(stage.id) : undefined} onDrop={() => tab === "deal" ? handleDealDrop(stage.id) : handleProspectDrop(stage.id as ProspectStageId)}>
                        {tab === "deal" ? (
                          dealItems.length ? dealItems.map((deal) => <DealCard key={deal.id} deal={deal} onClick={() => setSelectedDeal(deal)} onDragStart={() => setDragItem({ kind: "deal", id: deal.id, fromStage: deal.stage })} />) : <div style={{ display: "flex", height: 88, alignItems: "center", justifyContent: "center", borderRadius: 12, border: "2px dashed #dbe6f2" }}><span style={{ fontSize: 11, color: "#96a7ba" }}>No deals</span></div>
                        ) : (
                          prospectItems.length ? prospectItems.map((contact) => <ProspectCard key={contact.id} contact={contact} company={contact.company_id ? companyMap.get(contact.company_id) : undefined} onOpen={() => setSelectedProspect(contact)} onDragStart={() => setDragItem({ kind: "prospect", id: contact.id, fromStage: prospectStage(contact) })} />) : <div style={{ display: "flex", height: 88, alignItems: "center", justifyContent: "center", borderRadius: 12, border: "2px dashed #dbe6f2" }}><span style={{ fontSize: 11, color: "#96a7ba" }}>No prospects</span></div>
                        )}
                      </BoardColumn>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {createDealStage && <CreateDealModal defaultStage={createDealStage} companies={companies} users={users} onClose={() => setCreateDealStage(null)} onCreated={handleDealCreated} />}
      {selectedDeal && <DealDetailDrawer deal={selectedDeal} companies={companies} users={users} stages={DEAL_STAGES} onClose={() => setSelectedDeal(null)} onDealUpdated={handleDealUpdated} onDealDeleted={handleDealDeleted} />}
      {selectedProspect && <ProspectDetailDrawer contact={selectedProspect} company={selectedProspect.company_id ? companyMap.get(selectedProspect.company_id) : undefined} activities={prospectActivities} loading={loadingProspectActivities} converting={convertingProspect} onConvert={handleConvertProspectToDeal} onClose={() => setSelectedProspect(null)} />}
      {pendingConvertProspect && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.22)", zIndex: 60 }} onClick={() => setPendingConvertProspect(null)} />
          <div style={{ position: "fixed", inset: 0, zIndex: 61, display: "grid", placeItems: "center", padding: 16 }}>
            <div className="crm-panel" style={{ width: "min(520px, 100%)", padding: 24, borderRadius: 18 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#182042", marginBottom: 10 }}>Convert this prospect to a deal?</div>
              <div style={{ color: "#5e738b", fontSize: 14, lineHeight: 1.7, marginBottom: 18 }}>
                {contactName(pendingConvertProspect)} was moved to <strong>Meeting Booked</strong>. You can create a deal now, or skip and convert later from the prospect card.
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button type="button" className="crm-button soft" onClick={() => setPendingConvertProspect(null)}>
                  Not now
                </button>
                <button type="button" className="crm-button primary" disabled={convertingProspect} onClick={() => handleConvertProspectToDeal(pendingConvertProspect)}>
                  {convertingProspect ? "Converting..." : "Convert to Deal"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {showFunnelSettings && <FunnelSettingsModal config={funnelConfig} onClose={() => setShowFunnelSettings(false)} onSave={(config) => { setFunnelConfig(config); saveFunnel(config); setShowFunnelSettings(false); }} />}
    </>
  );
}
