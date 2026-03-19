import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Swords, RefreshCw, Pencil, Trash2, X } from "lucide-react";
import { battlecardsApi } from "../lib/api";
import type { Battlecard } from "../types";

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "objection", label: "Objections" },
  { key: "competitor", label: "Competitors" },
  { key: "tech_faq", label: "Tech FAQs" },
];

const CATEGORY_STYLE: Record<string, string> = {
  objection: "bg-[#fff1ec] border-[#ffcbb8] text-[#b94a24]",
  competitor: "bg-[#eaf4ff] border-[#c7def8] text-[#2a5f8c]",
  tech_faq: "bg-[#e4fbf3] border-[#b8efd8] text-[#1b6f53]",
  pricing: "bg-[#fff3dd] border-[#f7dda4] text-[#86581a]",
  use_case: "bg-[#edf3f9] border-[#d7e1eb] text-[#546679]",
};

export default function Battlecards() {
  const [cards, setCards] = useState<Battlecard[]>([]);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Battlecard | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    category: "objection",
    title: "",
    trigger: "",
    response: "",
    competitor: "",
    tags: "",
  });

  const loadCards = async (activeCategory = category, query = search) => {
    setLoading(true);
    setError("");
    try {
      let data: Battlecard[];
      if (query.trim().length >= 2) {
        data = await battlecardsApi.search(query.trim());
      } else if (activeCategory === "all") {
        data = await battlecardsApi.list();
      } else {
        data = await battlecardsApi.list(activeCategory);
      }
      setCards(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load battlecards");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCards(category, search);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [category, search]);

  useEffect(() => {
    loadCards("all", "");
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ category: "objection", title: "", trigger: "", response: "", competitor: "", tags: "" });
    setShowModal(true);
  };

  const openEdit = (card: Battlecard) => {
    setEditing(card);
    setForm({
      category: card.category,
      title: card.title,
      trigger: card.trigger,
      response: card.response,
      competitor: card.competitor ?? "",
      tags: card.tags ?? "",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.trigger.trim() || !form.response.trim()) {
      setError("Title, trigger, and response are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        category: form.category,
        title: form.title.trim(),
        trigger: form.trigger.trim(),
        response: form.response.trim(),
        competitor: form.competitor.trim() || undefined,
        tags: form.tags.trim() || undefined,
      };
      if (editing) {
        await battlecardsApi.update(editing.id, payload);
      } else {
        await battlecardsApi.create(payload);
      }
      setShowModal(false);
      await loadCards();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save battlecard");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError("");
    try {
      await battlecardsApi.delete(id);
      await loadCards();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete battlecard");
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    setError("");
    try {
      await battlecardsApi.seed();
      await loadCards();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to seed battlecards");
    } finally {
      setSeeding(false);
    }
  };

  const resultsLabel = useMemo(() => {
    if (search.trim().length >= 2) return `Search results (${cards.length})`;
    return `${cards.length} cards`;
  }, [cards.length, search]);

  return (
    <div className="battlecards-page" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="crm-panel p-6 space-y-4" style={{ padding: 26 }}>
        <div className="crm-toolbar">
          <div className="flex items-center gap-2">
            <span className="crm-chip">{resultsLabel}</span>
          </div>
          <div className="crm-toolbar-actions">
            <button className="crm-button soft" onClick={handleSeed} disabled={seeding}>
              {seeding ? <RefreshCw size={14} className="animate-spin" /> : <Swords size={14} />}
              {seeding ? "Seeding..." : "Seed Default Cards"}
            </button>
            <button className="crm-button primary" onClick={openCreate}>
              <Plus size={14} />
              Add Card
            </button>
          </div>
        </div>

        <div className="relative max-w-lg" style={{ marginTop: 2 }}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8094a8]" />
          <input
            className="h-12 w-full rounded-xl border border-[#d7e2ee] bg-white pl-10 pr-4 text-[14px]"
            placeholder="Search trigger, title, tags"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setCategory(tab.key)}
              className={`h-10 px-4 rounded-xl border text-[13px] font-semibold transition-all ${
                category === tab.key
                  ? "bg-[#fff1ec] border-[#ffcbb8] text-[#b94a24]"
                  : "bg-white border-[#d7e2ee] text-[#4d6178]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="crm-panel p-14 text-center crm-muted">Loading battlecards...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" style={{ rowGap: 20, columnGap: 20 }}>
          {cards.map((card) => (
            <article key={card.id} className="crm-panel p-5 space-y-3" style={{ padding: 22 }}>
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center px-2 py-1 rounded-full border text-[11px] font-bold capitalize ${CATEGORY_STYLE[card.category] ?? "bg-[#edf3f9] border-[#d7e1eb] text-[#546679]"}`}>
                  {card.category.replace(/_/g, " ")}
                </span>
                <div className="flex items-center gap-1">
                  <button className="h-8 w-8 rounded-lg border border-[#d8e3ee] grid place-items-center text-[#5f748b] hover:text-[#2a3f56]" onClick={() => openEdit(card)}>
                    <Pencil size={13} />
                  </button>
                  <button className="h-8 w-8 rounded-lg border border-[#ffd0c0] grid place-items-center text-[#c2532d] hover:text-[#a84321]" onClick={() => handleDelete(card.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <h3 className="text-[15px] font-bold text-[#24364b]">{card.title}</h3>
              <p className="text-[12px] uppercase tracking-[0.08em] text-[#7a8ea4]">Trigger</p>
              <p className="text-[13px] text-[#2f455d]">{card.trigger}</p>
              <p className="text-[12px] uppercase tracking-[0.08em] text-[#7a8ea4]">Response</p>
              <p className="text-[13px] text-[#2f455d] leading-relaxed">{card.response}</p>
            </article>
          ))}
          {cards.length === 0 && (
            <div className="crm-panel p-14 text-center text-[#6f8297] md:col-span-2 xl:col-span-3">
              No battlecards found.
            </div>
          )}
        </div>
      )}

      {error && <p className="text-[12px] text-[#b94a24] font-semibold">{error}</p>}

      {showModal && (
        <>
          <div className="fixed inset-0 bg-black/25 z-40" onClick={() => setShowModal(false)} />
          <div className="fixed inset-0 z-50 grid place-items-center p-4">
            <div className="crm-panel w-full max-w-2xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[18px] font-bold">{editing ? "Edit Battlecard" : "Add Battlecard"}</h3>
                <button className="text-[#7a8ea4] hover:text-[#31465f]" onClick={() => setShowModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <select
                  className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px] bg-white"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                >
                  <option value="objection">objection</option>
                  <option value="competitor">competitor</option>
                  <option value="tech_faq">tech_faq</option>
                  <option value="pricing">pricing</option>
                  <option value="use_case">use_case</option>
                </select>
                <input
                  className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px]"
                  placeholder="Title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>

              <input
                className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px]"
                placeholder="Trigger"
                value={form.trigger}
                onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}
              />

              <textarea
                className="w-full min-h-32 rounded-xl border border-[#d7e2ee] p-3 text-[14px]"
                placeholder="Response"
                value={form.response}
                onChange={(e) => setForm((f) => ({ ...f, response: e.target.value }))}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px]"
                  placeholder="Competitor (optional)"
                  value={form.competitor}
                  onChange={(e) => setForm((f) => ({ ...f, competitor: e.target.value }))}
                />
                <input
                  className="h-11 rounded-xl border border-[#d7e2ee] px-3 text-[14px]"
                  placeholder="Tags comma-separated"
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                />
              </div>

              <div className="flex justify-end gap-2">
                <button className="crm-button soft" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="crm-button primary" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
