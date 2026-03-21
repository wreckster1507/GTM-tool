import { useEffect, useState, type ComponentType, type CSSProperties } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { dealsApi, activitiesApi, contactsApi, meetingsApi } from "../lib/api";
import type { Deal, Activity, Contact, Meeting } from "../types";
import { ArrowLeft, Phone, Mail, Video, FileText, Activity as ActivityIcon, Trash2, CalendarDays, X, ExternalLink, Sparkles } from "lucide-react";
import { formatCurrency, formatDate, avatarColor, getInitials } from "../lib/utils";

const MEDDPICC = [
  { key: "metrics",           label: "Metrics",           desc: "Quantifiable value / ROI defined" },
  { key: "economic_buyer",    label: "Economic Buyer",    desc: "Access to budget owner confirmed" },
  { key: "decision_criteria", label: "Decision Criteria", desc: "Evaluation criteria understood" },
  { key: "decision_process",  label: "Decision Process",  desc: "Steps to purchase mapped" },
  { key: "identify_pain",     label: "Identify Pain",     desc: "Core business pain documented" },
  { key: "champion",          label: "Champion",          desc: "Internal advocate identified" },
  { key: "competition",       label: "Competition",       desc: "Competitive landscape known" },
];

const ACTIVITY_ICON: Record<string, ComponentType<{ className?: string }>> = {
  call: Phone, email: Mail, meeting: Video, note: FileText, transcript: ActivityIcon, visit: ActivityIcon,
};

const ACTIVITY_COLOR: Record<string, string> = {
  call: "bg-blue-50 text-blue-500",
  email: "bg-violet-50 text-violet-500",
  meeting: "bg-emerald-50 text-emerald-500",
  note: "bg-amber-50 text-amber-500",
};

const HEALTH_STYLE: Record<string, CSSProperties> = {
  green: { color: "#1d7f57", background: "#e4fbf3", border: "1px solid #b8efd8" },
  yellow: { color: "#8f651c", background: "#fff3dd", border: "1px solid #f7dda4" },
  red: { color: "#8f2f11", background: "#ffe4d9", border: "1px solid #ffc5b3" },
};

const STAGE_LABEL: Record<string, string> = {
  discovery: "Discovery", demo: "Demo", poc: "POC",
  proposal: "Proposal", negotiation: "Negotiation",
  closed_won: "Closed Won", closed_lost: "Closed Lost",
};

export default function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [savingMeeting, setSavingMeeting] = useState(false);
  const [meetingForm, setMeetingForm] = useState({ title: "", meeting_type: "demo", scheduled_at: "", attendee_ids: [] as string[] });
  const [meetingError, setMeetingError] = useState("");

  useEffect(() => {
    if (!id) return;
    Promise.all([dealsApi.get(id), activitiesApi.list(id)]).then(([d, acts]) => {
      setDeal(d);
      setActivities(acts);
      if (d.company_id) contactsApi.list(0, 100, d.company_id).then(setContacts);
      meetingsApi.list(0, 50, undefined, id).then(setMeetings);
      setLoading(false);
    });
  }, [id]);

  const handleScheduleMeeting = async () => {
    if (!deal || !meetingForm.title.trim()) {
      setMeetingError("Meeting title is required.");
      return;
    }
    setSavingMeeting(true);
    setMeetingError("");
    try {
      const meeting = await meetingsApi.create({
        title: meetingForm.title.trim(),
        company_id: deal.company_id,
        deal_id: deal.id,
        meeting_type: meetingForm.meeting_type,
        scheduled_at: meetingForm.scheduled_at ? new Date(meetingForm.scheduled_at).toISOString() : undefined,
        attendees: contacts
          .filter((contact) => meetingForm.attendee_ids.includes(contact.id))
          .map((contact) => ({
            contact_id: contact.id,
            name: `${contact.first_name} ${contact.last_name}`.trim(),
            title: contact.title,
            email: contact.email,
          })),
      });
      setShowMeetingModal(false);
      setMeetingForm({ title: "", meeting_type: "demo", scheduled_at: "", attendee_ids: [] });
      setMeetings((prev) => [meeting, ...prev]);
      navigate(`/meetings/${meeting.id}`);
    } catch (e) {
      setMeetingError(e instanceof Error ? e.message : "Failed to create meeting");
    } finally {
      setSavingMeeting(false);
    }
  };

  const toggleMEDDPICC = async (key: string) => {
    if (!deal) return;
    const qual = (deal.qualification ?? {}) as Record<string, { checked: boolean }>;
    const updated = { ...qual, [key]: { ...(qual[key] ?? {}), checked: !(qual[key]?.checked ?? false) } };
    const updatedDeal = await dealsApi.update(deal.id, { qualification: updated });
    setDeal(updatedDeal);
  };

  if (loading)
    return <div className="crm-panel p-14 text-center crm-muted">Loading deal...</div>;
  if (!deal)
    return <div className="crm-panel p-14 text-center crm-muted">Deal not found.</div>;

  const qual = (deal.qualification ?? {}) as Record<string, { checked: boolean }>;
  const meddpiccScore = MEDDPICC.filter((m) => qual[m.key]?.checked).length;

  return (
    <>
      <div className="crm-page deal-detail-page space-y-6">
      <div className="flex items-center justify-between gap-3 deal-detail-top-actions">
        <button onClick={() => navigate("/pipeline")} className="crm-button soft">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Pipeline
        </button>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-bold capitalize" style={HEALTH_STYLE[deal.health] ?? HEALTH_STYLE.yellow}>
            {deal.health} health
          </span>
          <button
            className="crm-button soft text-[#c0392b] border-[#fcc] hover:bg-[#fff5f5]"
            onClick={async () => {
              if (!window.confirm(`Delete deal "${deal.name}"? This cannot be undone.`)) return;
              await dealsApi.delete(deal.id);
              navigate("/pipeline");
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Deal
          </button>
        </div>
      </div>

      <section className="crm-panel p-8 deal-detail-summary">
        <h2 className="text-[30px] font-extrabold tracking-tight text-[#1f2d3d]">{deal.name}</h2>
        <p className="text-[14px] text-[#6f8399] mt-1.5">Stage: <span className="font-semibold text-[#30445a]">{STAGE_LABEL[deal.stage] ?? deal.stage}</span></p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-[#e3eaf3]">
          {[
            { label: "Deal Value", value: formatCurrency(deal.value) },
            { label: "Close Target", value: formatDate(deal.close_date_est) },
            { label: "Days In Stage", value: `${deal.days_in_stage ?? 0}d` },
            { label: "Stakeholders", value: String(deal.stakeholder_count ?? 0) },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-[#e3eaf3] bg-[#f9fbfe] px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#7d8fa3] font-semibold">{item.label}</p>
              <p className="text-[16px] font-extrabold text-[#2b3f55] mt-1.5 tabular">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Meetings section — schedule + view linked meetings */}
      <section className="crm-panel p-6" style={{ padding: 26 }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-[#ff6b35]" />
            <p className="text-[15px] font-bold text-[#2b3f55]">Meetings ({meetings.length})</p>
          </div>
          <button className="crm-button primary shrink-0" onClick={() => {
            const stageType = ["discovery", "demo", "poc"].includes(deal.stage) ? deal.stage : "other";
            setMeetingForm(f => ({ ...f, title: `${STAGE_LABEL[deal.stage] ?? deal.stage} — ${deal.name}`, meeting_type: stageType, attendee_ids: [] }));
            setShowMeetingModal(true);
          }}>
            <CalendarDays className="h-3.5 w-3.5" />
            Schedule Meeting
          </button>
        </div>

        {meetings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#ffd5be] bg-[#fff8f5] px-5 py-4 flex items-center gap-3">
            <Sparkles className="h-4 w-4 text-[#ff6b35] shrink-0" />
            <div>
              <p className="text-[13px] font-bold text-[#8f3a14]">No meetings scheduled yet</p>
              <p className="text-[12px] text-[#b05a2a]">Schedule a meeting to unlock the Pre-Meeting Intelligence workspace with 13 research sources.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2" style={{ rowGap: 8, display: "grid" }}>
            {meetings.map((m) => (
              <Link
                key={m.id}
                to={`/meetings/${m.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-[#e3eaf3] bg-[#fbfdff] px-4 py-3 hover:border-[#ff6b35] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Video className="h-4 w-4 text-[#4a7fa5] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold text-[#24364b] truncate">{m.title}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[12px] text-[#7a8ea4]">
                      <span className="capitalize">{m.meeting_type}</span>
                      {m.scheduled_at && <span>· {formatDate(m.scheduled_at)}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold capitalize"
                    style={m.status === "completed"
                      ? { color: "#1d7f57", background: "#e4fbf3", border: "1px solid #b8efd8" }
                      : { color: "#4f657e", background: "#f8fbff", border: "1px solid #d7e2ee" }}>
                    {m.status}
                  </span>
                  {m.meeting_score != null && (
                    <span className="text-[12px] font-bold tabular text-[#ff6b35]">{m.meeting_score}/100</span>
                  )}
                  <ExternalLink className="h-3 w-3 text-[#9eb0c3]" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6 deal-detail-main-grid">
        <div className="crm-panel p-6 deal-detail-meddpicc">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold text-[#2b3f55]">MEDDPICC</h3>
            <span className="crm-chip tabular">{meddpiccScore}/{MEDDPICC.length}</span>
          </div>
          <div className="h-2.5 rounded-full bg-[#eaf1f8] mt-4 mb-4 overflow-hidden">
            <div
              className="h-2.5 rounded-full bg-[#ff6b35]"
              style={{ width: `${(meddpiccScore / MEDDPICC.length) * 100}%` }}
            />
          </div>
          <div className="space-y-3.5">
            {MEDDPICC.map(({ key, label, desc }) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={qual[key]?.checked ?? false}
                  onChange={() => toggleMEDDPICC(key)}
                  className="mt-0.5 h-4 w-4 accent-[#ff6b35]"
                />
                <div>
                  <p className={`text-[13px] font-semibold ${qual[key]?.checked ? "text-[#8ea1b5] line-through" : "text-[#2f455d]"}`}>
                    {label}
                  </p>
                  <p className="text-[12px] text-[#7b8ea4] mt-0.5">{desc}</p>
                </div>
              </label>
            ))}
          </div>

          {contacts.length > 0 && (
            <div className="mt-6 pt-4 border-t border-[#e3eaf3]">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[13px] font-bold text-[#2b3f55]">Stakeholders</h4>
                <span className="crm-chip tabular">{contacts.length}</span>
              </div>
              <div className="space-y-3">
                {contacts.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-lg border border-[#e2ebf4] bg-white px-4 py-2">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${avatarColor(c.first_name + c.last_name)}`}>
                      {getInitials(`${c.first_name} ${c.last_name}`)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-[#25384d] truncate">{c.first_name} {c.last_name}</p>
                      <p className="text-[12px] text-[#7b8ea4] truncate">{c.title ?? c.seniority ?? "-"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="crm-panel p-8 xl:col-span-2 deal-detail-timeline">
          <h3 className="text-[16px] font-bold text-[#2b3f55] mb-4">Activity Timeline</h3>
          {activities.length === 0 ? (
            <div className="text-center py-14 text-[#7b8ea4]">
              <ActivityIcon className="h-7 w-7 mx-auto mb-2 opacity-30" />
              No activities yet.
            </div>
          ) : (
            <div className="space-y-4">
              {activities.map((a) => {
                const Icon = ACTIVITY_ICON[a.type] ?? ActivityIcon;
                const colorCls = ACTIVITY_COLOR[a.type] ?? "bg-[#eef3f8] text-[#6f8399]";
                return (
                  <div key={a.id} className="rounded-xl border border-[#e3eaf3] bg-[#fbfdff] px-4 py-4">
                    <div className="flex items-start gap-4">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${colorCls}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <p className="text-[13px] font-bold capitalize text-[#31485f]">{a.type}</p>
                          <p className="text-[12px] text-[#7a8ea4]">{formatDate(a.created_at)}</p>
                        </div>
                        {a.content && <p className="text-[13px] text-[#4d6178] mt-1.5 leading-relaxed">{a.content}</p>}
                        {a.ai_summary && <p className="text-[12px] text-[#ff6b35] mt-2">AI summary: {a.ai_summary}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>

      {showMeetingModal && (
        <>
          <div className="fixed inset-0 bg-black/25 z-40" onClick={() => setShowMeetingModal(false)} />
          <div className="fixed inset-0 z-50 grid place-items-center p-4">
            <div className="crm-panel w-full max-w-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[18px] font-bold">Schedule Meeting</h3>
                <button className="text-[#7a8ea4] hover:text-[#31465f]" onClick={() => setShowMeetingModal(false)}>
                  <X size={18} />
                </button>
              </div>
                <div className="grid gap-3">
                <input
                  className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px]"
                  placeholder="Meeting title"
                  value={meetingForm.title}
                  onChange={(e) => setMeetingForm((f) => ({ ...f, title: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px] bg-white"
                    value={meetingForm.meeting_type}
                    onChange={(e) => setMeetingForm((f) => ({ ...f, meeting_type: e.target.value }))}
                  >
                    {["discovery", "demo", "poc", "qbr", "other"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <label className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px] bg-white flex items-center gap-2 text-[#6f8399]">
                    <CalendarDays size={13} />
                    <input
                      type="datetime-local"
                      className="w-full outline-none text-[#25384d] text-[13px]"
                      value={meetingForm.scheduled_at}
                      onChange={(e) => setMeetingForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                    />
                  </label>
                </div>
                {contacts.length > 0 && (
                  <div className="rounded-xl border border-[#d7e2ee] p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-[11px] uppercase tracking-[0.06em] font-bold text-[#6f8399]">Attendees</p>
                      <span className="text-[11px] text-[#7a8ea4]">{meetingForm.attendee_ids.length} selected</span>
                    </div>
                    <div className="grid gap-2 max-h-40 overflow-y-auto">
                      {contacts.map((contact) => {
                        const checked = meetingForm.attendee_ids.includes(contact.id);
                        return (
                          <label key={contact.id} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setMeetingForm((f) => ({
                                ...f,
                                attendee_ids: checked
                                  ? f.attendee_ids.filter((id) => id !== contact.id)
                                  : [...f.attendee_ids, contact.id],
                              }))}
                            />
                            <div>
                              <p className="text-[13px] font-semibold text-[#25384d]">
                                {contact.first_name} {contact.last_name}
                              </p>
                              <p className="text-[12px] text-[#7a8ea4]">
                                {contact.title ?? contact.persona ?? contact.persona_type ?? "Stakeholder"}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              {meetingError && <p className="text-[12px] text-[#b94a24] font-semibold">{meetingError}</p>}
              <div className="flex justify-end gap-2">
                <button className="crm-button soft" onClick={() => setShowMeetingModal(false)}>Cancel</button>
                <button className="crm-button primary" onClick={handleScheduleMeeting} disabled={savingMeeting}>
                  {savingMeeting ? "Creating…" : "Schedule & Open Workspace"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
