import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Plus, X } from "lucide-react";
import { companiesApi, dealsApi, meetingsApi } from "../lib/api";
import type { Company, Deal, Meeting } from "../types";
import { formatDate } from "../lib/utils";

const MEETING_TYPES = ["discovery", "demo", "poc", "qbr", "other"];

export default function Meetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    company_id: "",
    deal_id: "",
    meeting_type: "discovery",
    scheduled_at: "",
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [ms, cs, ds] = await Promise.all([
        meetingsApi.list(0, 200),
        companiesApi.list(),
        dealsApi.list(0, 300),
      ]);
      setMeetings(ms);
      setCompanies(cs);
      setDeals(ds);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const companyName = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c.name])), [companies]);
  const companyDeals = useMemo(() => {
    return deals.filter((d) => !form.company_id || d.company_id === form.company_id);
  }, [deals, form.company_id]);

  const handleCreate = async () => {
    if (!form.title.trim()) {
      setError("Meeting title is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await meetingsApi.create({
        title: form.title.trim(),
        company_id: form.company_id || undefined,
        deal_id: form.deal_id || undefined,
        meeting_type: form.meeting_type,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : undefined,
      });
      setShowModal(false);
      setForm({ title: "", company_id: "", deal_id: "", meeting_type: "discovery", scheduled_at: "" });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create meeting");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="crm-panel p-6 crm-toolbar">
        <div className="flex items-center gap-2">
          <span className="crm-chip">
            <span className="font-bold tabular">{meetings.length}</span>
            Meetings
          </span>
        </div>
        <button className="crm-button primary" onClick={() => setShowModal(true)}>
          <Plus size={14} />
          New Meeting
        </button>
      </div>

      {loading ? (
        <div className="crm-panel p-14 text-center crm-muted">Loading meetings...</div>
      ) : (
        <div className="crm-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="crm-table" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Type</th>
                  <th>Scheduled</th>
                  <th>Status</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link to={`/meetings/${m.id}`} className="font-bold text-[#24364b] hover:text-[#ff6b35] transition-colors">
                        {m.title}
                      </Link>
                    </td>
                    <td>{m.company_id ? (companyName[m.company_id] ?? "-") : "-"}</td>
                    <td className="capitalize">{m.meeting_type.replace(/_/g, " ")}</td>
                    <td>{formatDate(m.scheduled_at)}</td>
                    <td>
                      <span className="crm-chip capitalize">{m.status}</span>
                    </td>
                    <td className="tabular">{m.meeting_score ?? "-"}</td>
                  </tr>
                ))}
                {meetings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-[#7a8ea4] py-12">
                      No meetings yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <>
          <div className="fixed inset-0 bg-black/25 z-40" onClick={() => setShowModal(false)} />
          <div className="fixed inset-0 z-50 grid place-items-center p-4">
            <div className="crm-panel w-full max-w-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[18px] font-bold">Create Meeting</h3>
                <button className="text-[#7a8ea4] hover:text-[#31465f]" onClick={() => setShowModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-3">
                <input
                  className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px]"
                  placeholder="Meeting title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select
                    className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px] bg-white"
                    value={form.company_id}
                    onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value, deal_id: "" }))}
                  >
                    <option value="">Select company (optional)</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <select
                    className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px] bg-white"
                    value={form.deal_id}
                    onChange={(e) => setForm((f) => ({ ...f, deal_id: e.target.value }))}
                  >
                    <option value="">Select deal (optional)</option>
                    {companyDeals.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select
                    className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px] bg-white"
                    value={form.meeting_type}
                    onChange={(e) => setForm((f) => ({ ...f, meeting_type: e.target.value }))}
                  >
                    {MEETING_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <label className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px] bg-white flex items-center gap-2 text-[#6f8399]">
                    <CalendarDays size={14} />
                    <input
                      type="datetime-local"
                      className="w-full outline-none text-[#25384d]"
                      value={form.scheduled_at}
                      onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                    />
                  </label>
                </div>
              </div>

              {error && <p className="text-[12px] text-[#b94a24] font-semibold">{error}</p>}

              <div className="flex justify-end gap-2">
                <button className="crm-button soft" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="crm-button primary" onClick={handleCreate} disabled={saving}>
                  {saving ? "Creating..." : "Create Meeting"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
