import { useEffect, useState } from "react";
import {
  X, ChevronDown, Building2, CalendarDays, Flag, UserCircle2,
  Send, Tag, Plus, Trash2, ArrowRight, Clock3, Globe, Zap, Navigation,
} from "lucide-react";
import { dealsApi, contactsApi } from "../../lib/api";
import type { Activity, Company, Contact, Deal, DealContact, User } from "../../types";
import { avatarColor, formatCurrency, formatDate, getInitials } from "../../lib/utils";

interface Props {
  deal: Deal;
  companies: Company[];
  users: User[];
  stages: { id: string; label: string; group: string }[];
  onClose: () => void;
  onDealUpdated: (deal: Deal) => void;
  onConvert?: (deal: Deal) => void;
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#dc2626", high: "#f59e0b", normal: "#94a3b8", low: "#cbd5e1",
};

const PERSONA_STYLE: Record<string, { bg: string; color: string }> = {
  economic_buyer: { bg: "#ffe8de", color: "#7b3a1d" },
  champion: { bg: "#e4fbf3", color: "#1b6f53" },
  technical_evaluator: { bg: "#eaf4ff", color: "#24567e" },
};

export default function DealDetailDrawer({ deal, companies, users, stages, onClose, onDealUpdated, onConvert }: Props) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [dealContacts, setDealContacts] = useState<DealContact[]>([]);
  const [comment, setComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);

  // Inline editing states
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(deal.name);
  const [showStageMenu, setShowStageMenu] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);

  // Link contact
  const [showLinkContact, setShowLinkContact] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [linkRole, setLinkRole] = useState("");

  // Tag input
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    dealsApi.getActivities(deal.id).then(setActivities).catch(() => {});
    dealsApi.getContacts(deal.id).then(setDealContacts).catch(() => {});
  }, [deal.id]);

  // ── Field updates ─────────────────────────────────────────────────────────

  const patchDeal = async (data: Partial<Deal>) => {
    const updated = await dealsApi.patch(deal.id, data);
    onDealUpdated(updated);
  };

  const handleMoveStage = async (newStage: string) => {
    setShowStageMenu(false);
    if (newStage === deal.stage) return;
    const updated = await dealsApi.moveStage(deal.id, newStage);
    onDealUpdated(updated);
    dealsApi.getActivities(deal.id).then(setActivities);
  };

  const handleNameSave = async () => {
    setEditingName(false);
    if (nameVal.trim() && nameVal !== deal.name) {
      await patchDeal({ name: nameVal.trim() });
    }
  };

  // ── Comments ──────────────────────────────────────────────────────────────

  const handleAddComment = async () => {
    if (!comment.trim()) return;
    setSendingComment(true);
    try {
      const act = await dealsApi.addComment(deal.id, comment.trim());
      setActivities((prev) => [act, ...prev]);
      setComment("");
    } finally { setSendingComment(false); }
  };

  // ── Contact linking ───────────────────────────────────────────────────────

  const searchContacts = async (q: string) => {
    setContactSearch(q);
    if (q.length < 2) { setContactResults([]); return; }
    try {
      // If deal has a company, only show contacts from that company
      const all = await contactsApi.list(0, 200, deal.company_id ?? undefined);
      const lq = q.toLowerCase();
      setContactResults(
        all
          .filter((c) =>
            `${c.first_name} ${c.last_name} ${c.email ?? ""} ${c.title ?? ""}`.toLowerCase().includes(lq) &&
            !dealContacts.some((dc) => dc.contact_id === c.id)
          )
          .slice(0, 15)
      );
    } catch { setContactResults([]); }
  };

  const handleLinkContact = async (contactId: string) => {
    const dc = await dealsApi.addContact(deal.id, contactId, linkRole || undefined);
    setDealContacts((prev) => [dc, ...prev]);
    setShowLinkContact(false);
    setContactSearch("");
    setLinkRole("");
    dealsApi.getActivities(deal.id).then(setActivities);
  };

  const handleUnlinkContact = async (contactId: string) => {
    await dealsApi.removeContact(deal.id, contactId);
    setDealContacts((prev) => prev.filter((dc) => dc.contact_id !== contactId));
  };

  // ── Tags ──────────────────────────────────────────────────────────────────

  const handleAddTag = async () => {
    const tag = tagInput.trim();
    if (!tag || (deal.tags ?? []).includes(tag)) return;
    await patchDeal({ tags: [...(deal.tags ?? []), tag] } as Partial<Deal>);
    setTagInput("");
  };

  const handleRemoveTag = async (tag: string) => {
    await patchDeal({ tags: (deal.tags ?? []).filter((t) => t !== tag) } as Partial<Deal>);
  };

  const stageLabel = stages.find((s) => s.id === deal.stage)?.label ?? deal.stage;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", zIndex: 50 }}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 580, zIndex: 51,
        background: "#fff", boxShadow: "-8px 0 40px rgba(0,0,0,0.12)",
        display: "flex", flexDirection: "column",
        animation: "slideInRight 0.2s ease-out",
      }}>

        {/* ── Header ───────────────────────────────────────────────── */}
        <div style={{
          padding: "20px 24px", borderBottom: "1px solid #e8eef5",
          display: "flex", flexDirection: "column", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            {/* Name */}
            {editingName ? (
              <input
                autoFocus
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onBlur={handleNameSave}
                onKeyDown={(e) => e.key === "Enter" && handleNameSave()}
                style={{
                  fontSize: 20, fontWeight: 700, color: "#1f2d3d", flex: 1,
                  border: "1px solid #b8d0f0", borderRadius: 8, padding: "4px 8px",
                  outline: "none",
                }}
              />
            ) : (
              <h2
                onClick={() => { setEditingName(true); setNameVal(deal.name); }}
                style={{
                  fontSize: 20, fontWeight: 700, color: "#1f2d3d", cursor: "pointer",
                  flex: 1, lineHeight: 1.3,
                }}
                title="Click to edit"
              >
                {deal.name}
              </h2>
            )}
            <button onClick={onClose} style={{ color: "#7a96b0", cursor: "pointer", background: "none", border: "none", marginLeft: 12 }}>
              <X size={20} />
            </button>
          </div>

          {/* Stage + Priority badges */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* Stage badge with dropdown */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowStageMenu(!showStageMenu)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: "#eaf2ff", color: "#175089", border: "1px solid #c8daf0",
                  cursor: "pointer",
                }}
              >
                {stageLabel}
                <ArrowRight size={12} />
              </button>
              {showStageMenu && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, marginTop: 4,
                  background: "#fff", border: "1px solid #dbe6f2", borderRadius: 12,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 6, zIndex: 10,
                  minWidth: 200, maxHeight: 320, overflowY: "auto",
                }}>
                  {stages.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleMoveStage(s.id)}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        padding: "8px 12px", borderRadius: 8, fontSize: 13,
                        cursor: "pointer", border: "none",
                        background: s.id === deal.stage ? "#f0f6ff" : "transparent",
                        color: s.id === deal.stage ? "#175089" : "#2d4258",
                        fontWeight: s.id === deal.stage ? 600 : 400,
                      }}
                      onMouseEnter={(e) => { if (s.id !== deal.stage) e.currentTarget.style.background = "#f8fafc"; }}
                      onMouseLeave={(e) => { if (s.id !== deal.stage) e.currentTarget.style.background = "transparent"; }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Priority badge */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowPriorityMenu(!showPriorityMenu)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "4px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: "#f8f9fc", color: "#4d6178", border: "1px solid #e2eaf2",
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRIORITY_COLOR[deal.priority] }} />
                {deal.priority}
                <ChevronDown size={11} />
              </button>
              {showPriorityMenu && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, marginTop: 4,
                  background: "#fff", border: "1px solid #dbe6f2", borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 4, zIndex: 10,
                }}>
                  {["urgent", "high", "normal", "low"].map((p) => (
                    <button
                      key={p}
                      onClick={async () => { setShowPriorityMenu(false); await patchDeal({ priority: p }); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "6px 12px", borderRadius: 6, fontSize: 13, border: "none",
                        cursor: "pointer", background: p === deal.priority ? "#f0f6ff" : "transparent",
                        color: "#2d4258", textTransform: "capitalize",
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRIORITY_COLOR[p] }} />
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Convert button for prospects */}
            {onConvert && deal.stage === "in_progress" && (
              <button
                className="crm-button primary"
                onClick={() => onConvert(deal)}
                style={{ height: 30, fontSize: 12, marginLeft: "auto" }}
              >
                Convert to Deal
              </button>
            )}
          </div>
        </div>

        {/* ── Scrollable body ──────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

          {/* ── Fields section ──────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {/* Company */}
            <FieldRow label="Company" icon={<Building2 size={13} />}>
              <select
                value={deal.company_id ?? ""}
                onChange={(e) => patchDeal({ company_id: e.target.value || undefined } as Partial<Deal>)}
                style={{ ...fieldInputStyle }}
              >
                <option value="">None</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FieldRow>

            {/* Assigned rep */}
            <FieldRow label="Assigned" icon={<UserCircle2 size={13} />}>
              <select
                value={deal.assigned_to_id ?? ""}
                onChange={(e) => patchDeal({ assigned_to_id: e.target.value || undefined } as Partial<Deal>)}
                style={{ ...fieldInputStyle }}
              >
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </FieldRow>

            {/* Amount */}
            <FieldRow label="Amount" icon={<span style={{ fontSize: 13, fontWeight: 700 }}>$</span>}>
              <input
                type="number"
                defaultValue={deal.value ?? ""}
                onBlur={(e) => patchDeal({ value: e.target.value ? Number(e.target.value) : undefined } as Partial<Deal>)}
                style={{ ...fieldInputStyle }}
                placeholder="0"
              />
            </FieldRow>

            {/* Close date */}
            <FieldRow label="Close Date" icon={<CalendarDays size={13} />}>
              <input
                type="date"
                defaultValue={deal.close_date_est ?? ""}
                onChange={(e) => patchDeal({ close_date_est: e.target.value || undefined } as Partial<Deal>)}
                style={{ ...fieldInputStyle }}
              />
            </FieldRow>

            {/* Department */}
            <FieldRow label="Department" icon={<Flag size={13} />}>
              <input
                type="text"
                defaultValue={deal.department ?? ""}
                onBlur={(e) => patchDeal({ department: e.target.value || undefined } as Partial<Deal>)}
                style={{ ...fieldInputStyle }}
                placeholder="e.g. Finance"
              />
            </FieldRow>

            {/* Health */}
            <FieldRow label="Health" icon={<span style={{ width: 10, height: 10, borderRadius: "50%", background: deal.health === "green" ? "#22c55e" : deal.health === "yellow" ? "#f59e0b" : "#ef4444" }} />}>
              <select
                value={deal.health}
                onChange={(e) => patchDeal({ health: e.target.value })}
                style={{ ...fieldInputStyle }}
              >
                <option value="green">Green</option>
                <option value="yellow">Yellow</option>
                <option value="red">Red</option>
              </select>
            </FieldRow>

            {/* Geography */}
            <FieldRow label="Geography" icon={<Globe size={13} />}>
              <select
                value={deal.geography ?? ""}
                onChange={(e) => patchDeal({ geography: e.target.value || undefined } as Partial<Deal>)}
                style={{ ...fieldInputStyle }}
              >
                <option value="">Select region</option>
                <option value="NA">North America</option>
                <option value="EMEA">EMEA</option>
                <option value="APAC">APAC</option>
                <option value="LATAM">LATAM</option>
                <option value="India">India</option>
                <option value="Global">Global</option>
              </select>
            </FieldRow>

            {/* Source */}
            <FieldRow label="Source" icon={<Zap size={13} />}>
              <select
                value={deal.source ?? ""}
                onChange={(e) => patchDeal({ source: e.target.value || undefined } as Partial<Deal>)}
                style={{ ...fieldInputStyle }}
              >
                <option value="">Select source</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
                <option value="referral">Referral</option>
                <option value="partner">Partner</option>
                <option value="event">Event</option>
                <option value="cold_call">Cold Call</option>
                <option value="linkedin">LinkedIn</option>
              </select>
            </FieldRow>
          </div>

          {/* Next Step */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#5e738b", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
              <Navigation size={12} /> Next Step
            </div>
            <input
              type="text"
              defaultValue={deal.next_step ?? ""}
              onBlur={(e) => patchDeal({ next_step: e.target.value || undefined } as Partial<Deal>)}
              placeholder="e.g. Send pricing proposal by Friday"
              style={{
                width: "100%", height: 38, borderRadius: 10,
                border: "1px solid #dbe6f2", padding: "0 12px",
                fontSize: 13, outline: "none",
              }}
            />
          </div>

          {/* Tags */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#5e738b", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
              <Tag size={12} /> Tags
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {(deal.tags ?? []).map((tag) => (
                <span key={tag} style={{
                  fontSize: 12, padding: "3px 10px", borderRadius: 8,
                  background: "#f8f0ff", color: "#6b46a0", border: "1px solid #e8d8f8",
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  {tag}
                  <button onClick={() => handleRemoveTag(tag)} style={{
                    background: "none", border: "none", cursor: "pointer", color: "#a78bfa",
                    padding: 0, display: "flex",
                  }}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                  placeholder="Add tag..."
                  style={{
                    width: 100, height: 28, borderRadius: 8, border: "1px solid #e2eaf2",
                    padding: "0 8px", fontSize: 12, outline: "none",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#5e738b", marginBottom: 8 }}>Description</div>
            <textarea
              defaultValue={deal.description ?? ""}
              onBlur={(e) => patchDeal({ description: e.target.value || undefined } as Partial<Deal>)}
              placeholder="Add notes about this deal..."
              style={{
                width: "100%", minHeight: 80, borderRadius: 12, border: "1px solid #dbe6f2",
                padding: 12, fontSize: 13, resize: "vertical", outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* ── Contacts section ───────────────────────────────────── */}
          <div>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 12,
            }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#1f2d3d" }}>
                People on this deal ({dealContacts.length})
              </span>
              <button
                onClick={() => setShowLinkContact(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: "#f0f6ff", color: "#175089", border: "1px solid #c8daf0",
                  cursor: "pointer",
                }}
              >
                <Plus size={12} /> Link Contact
              </button>
            </div>

            {showLinkContact && (
              <div style={{
                marginBottom: 12, padding: 14, borderRadius: 12,
                border: "1px solid #dbe6f2", background: "#f9fbfe",
              }}>
                <input
                  autoFocus
                  placeholder="Search contacts..."
                  value={contactSearch}
                  onChange={(e) => searchContacts(e.target.value)}
                  style={{
                    width: "100%", height: 36, borderRadius: 10,
                    border: "1px solid #dbe6f2", padding: "0 12px", fontSize: 13, outline: "none",
                    marginBottom: 8,
                  }}
                />
                <select
                  value={linkRole}
                  onChange={(e) => setLinkRole(e.target.value)}
                  style={{
                    width: "100%", height: 32, borderRadius: 8, border: "1px solid #dbe6f2",
                    padding: "0 10px", fontSize: 12, background: "#fff", marginBottom: 8,
                  }}
                >
                  <option value="">No role</option>
                  <option value="champion">Champion</option>
                  <option value="economic_buyer">Economic Buyer</option>
                  <option value="technical_evaluator">Technical Evaluator</option>
                  <option value="blocker">Blocker</option>
                  <option value="influencer">Influencer</option>
                </select>
                {contactResults.length > 0 && (
                  <div style={{ maxHeight: 160, overflowY: "auto" }}>
                    {contactResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleLinkContact(c.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, width: "100%",
                          padding: "8px 10px", borderRadius: 8, border: "none",
                          cursor: "pointer", background: "transparent", textAlign: "left",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#f0f6ff"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                      >
                        <div className={`flex items-center justify-center rounded-full text-[9px] font-bold ${avatarColor(c.first_name + c.last_name)}`}
                          style={{ width: 24, height: 24, flexShrink: 0 }}>
                          {getInitials(`${c.first_name} ${c.last_name}`)}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1f2d3d" }}>{c.first_name} {c.last_name}</div>
                          <div style={{ fontSize: 11, color: "#7a96b0" }}>{c.title ?? c.email}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                  <button
                    onClick={() => { setShowLinkContact(false); setContactSearch(""); setContactResults([]); }}
                    style={{ fontSize: 12, color: "#7a96b0", cursor: "pointer", background: "none", border: "none" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {dealContacts.length === 0 && !showLinkContact ? (
              <div style={{ fontSize: 13, color: "#94a3b8", padding: "12px 0" }}>No contacts linked yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {dealContacts.map((dc) => {
                  const name = `${dc.first_name ?? ""} ${dc.last_name ?? ""}`.trim();
                  const ps = PERSONA_STYLE[dc.persona ?? ""] ?? { bg: "#edf3f9", color: "#546679" };
                  return (
                    <div key={dc.contact_id} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                      borderRadius: 12, border: "1px solid #e8eef5", background: "#fff",
                    }}>
                      <div className={`flex items-center justify-center rounded-full text-[9px] font-bold ${avatarColor(name)}`}
                        style={{ width: 28, height: 28, flexShrink: 0 }}>
                        {getInitials(name || "?")}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1f2d3d" }}>{name}</div>
                        <div style={{ fontSize: 11, color: "#7a96b0" }}>{dc.title ?? dc.email}</div>
                      </div>
                      {dc.persona && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                          background: ps.bg, color: ps.color,
                        }}>
                          {dc.persona.replace(/_/g, " ")}
                        </span>
                      )}
                      {dc.role && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                          background: "#e8f0fb", color: "#175089",
                        }}>
                          {dc.role.replace(/_/g, " ")}
                        </span>
                      )}
                      <button
                        onClick={() => handleUnlinkContact(dc.contact_id)}
                        style={{ color: "#c8d2dd", cursor: "pointer", background: "none", border: "none" }}
                        title="Remove"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Activity log ───────────────────────────────────────── */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1f2d3d", marginBottom: 12 }}>
              Activity ({activities.length})
            </div>

            {/* Comment box */}
            <div style={{
              display: "flex", gap: 8, marginBottom: 16, alignItems: "flex-end",
            }}>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment..."
                rows={2}
                style={{
                  flex: 1, borderRadius: 10, border: "1px solid #dbe6f2",
                  padding: "8px 12px", fontSize: 13, resize: "none", outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <button
                onClick={handleAddComment}
                disabled={!comment.trim() || sendingComment}
                style={{
                  width: 36, height: 36, borderRadius: 10, border: "none",
                  background: comment.trim() ? "#175089" : "#e8eef5",
                  color: comment.trim() ? "#fff" : "#94a3b8",
                  cursor: comment.trim() ? "pointer" : "default",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Send size={14} />
              </button>
            </div>

            {/* Activity feed */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activities.map((act) => {
                const isSystem = act.type !== "comment";
                return (
                  <div key={act.id} style={{
                    padding: "10px 14px", borderRadius: 12,
                    background: isSystem ? "#f4f6f9" : "#fff",
                    border: isSystem ? "none" : "1px solid #e8eef5",
                  }}>
                    {!isSystem && act.user_name && (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
                      }}>
                        <div className={`flex items-center justify-center rounded-full text-[8px] font-bold ${avatarColor(act.user_name)}`}
                          style={{ width: 20, height: 20 }}>
                          {getInitials(act.user_name)}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#2d4258" }}>{act.user_name}</span>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{formatDate(act.created_at)}</span>
                      </div>
                    )}
                    <div style={{
                      fontSize: 13,
                      color: isSystem ? "#5e738b" : "#2d4258",
                      fontStyle: isSystem ? "italic" : "normal",
                    }}>
                      {act.content}
                      {isSystem && (
                        <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>
                          {formatDate(act.created_at)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {activities.length === 0 && (
                <div style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: 16 }}>
                  No activity yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function FieldRow({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "#7a96b0", marginBottom: 4 }}>
        {icon} {label}
      </div>
      {children}
    </div>
  );
}

const fieldInputStyle: React.CSSProperties = {
  width: "100%", height: 34, borderRadius: 10,
  border: "1px solid #e2eaf2", padding: "0 10px",
  fontSize: 13, background: "#fff", outline: "none",
};
