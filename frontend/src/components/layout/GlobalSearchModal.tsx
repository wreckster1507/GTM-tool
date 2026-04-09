import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Calendar,
  CheckSquare,
  FileText,
  Loader2,
  Radar,
  Search,
  Settings,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { globalSearchApi } from "../../lib/api";
import type { GlobalSearchItem, GlobalSearchSection } from "../../types";

type QuickAction = {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  link: string;
  keywords: string;
  icon: "pipeline" | "accounts" | "prospecting" | "analytics" | "meetings" | "tasks" | "settings" | "knowledge";
};

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "pipeline",
    title: "Open Pipeline",
    subtitle: "Manage stages, forecast movement, and active opportunities.",
    meta: "Quick Actions",
    link: "/pipeline",
    keywords: "pipeline deals forecast revenue board",
    icon: "pipeline",
  },
  {
    id: "accounts",
    title: "Open Account Sourcing",
    subtitle: "Import, score, and prioritize target accounts.",
    meta: "Quick Actions",
    link: "/account-sourcing",
    keywords: "accounts sourcing companies target icp",
    icon: "accounts",
  },
  {
    id: "prospecting",
    title: "Open Prospecting",
    subtitle: "Search prospects, ownership, personas, and outreach readiness.",
    meta: "Quick Actions",
    link: "/prospecting",
    keywords: "prospects prospecting contacts outreach personas",
    icon: "prospecting",
  },
  {
    id: "analytics",
    title: "Open Sales Analytics",
    subtitle: "Review activity, forecast, and pipeline quality.",
    meta: "Quick Actions",
    link: "/sales-analytics",
    keywords: "analytics dashboard forecast activity reports",
    icon: "analytics",
  },
  {
    id: "meetings",
    title: "Open Meetings",
    subtitle: "See upcoming customer meetings and prep work.",
    meta: "Quick Actions",
    link: "/meetings",
    keywords: "meetings calendar pre meeting assistance",
    icon: "meetings",
  },
  {
    id: "tasks",
    title: "Open Tasks",
    subtitle: "Work Beacon recommendations and manual follow-ups.",
    meta: "Quick Actions",
    link: "/tasks",
    keywords: "tasks to do next actions queue",
    icon: "tasks",
  },
  {
    id: "knowledge",
    title: "Open Knowledge Base",
    subtitle: "Browse reusable sales resources and playbooks.",
    meta: "Quick Actions",
    link: "/knowledge-base",
    keywords: "knowledge docs resources playbooks",
    icon: "knowledge",
  },
  {
    id: "settings",
    title: "Open Settings",
    subtitle: "Configure stages, syncs, and shared workspace rules.",
    meta: "Quick Actions",
    link: "/settings",
    keywords: "settings configuration integrations stages",
    icon: "settings",
  },
];

function getQuickActionIcon(icon: QuickAction["icon"]) {
  switch (icon) {
    case "pipeline":
      return <BriefcaseBusiness size={15} />;
    case "accounts":
      return <Building2 size={15} />;
    case "prospecting":
      return <Radar size={15} />;
    case "analytics":
      return <TrendingUp size={15} />;
    case "meetings":
      return <Calendar size={15} />;
    case "tasks":
      return <CheckSquare size={15} />;
    case "knowledge":
      return <FileText size={15} />;
    case "settings":
      return <Settings size={15} />;
  }
}

type PaletteEntry =
  | { type: "quick"; item: QuickAction }
  | { type: "search"; item: GlobalSearchItem; section: string };

export default function GlobalSearchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GlobalSearchSection[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setResults([]);
      setActiveIndex(0);
      return;
    }
    const handle = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(handle);
  }, [open]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 120);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!open || !debouncedQuery) {
      setLoading(false);
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    globalSearchApi.search(debouncedQuery)
      .then((response) => {
        if (!cancelled) setResults(response.sections);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedQuery]);

  const filteredQuickActions = useMemo(() => {
    if (!debouncedQuery) return QUICK_ACTIONS;
    const needle = debouncedQuery.toLowerCase();
    return QUICK_ACTIONS.filter((item) =>
      `${item.title} ${item.subtitle} ${item.keywords}`.toLowerCase().includes(needle),
    );
  }, [debouncedQuery]);

  const flatEntries = useMemo<PaletteEntry[]>(() => {
    const items: PaletteEntry[] = filteredQuickActions.map((item) => ({ type: "quick", item }));
    for (const section of results) {
      for (const item of section.items) {
        items.push({ type: "search", item, section: section.label });
      }
    }
    return items;
  }, [filteredQuickActions, results]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery, results]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (!flatEntries.length) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % flatEntries.length);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + flatEntries.length) % flatEntries.length);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const current = flatEntries[activeIndex];
        if (!current) return;
        if (current.type === "quick") {
          navigate(current.item.link);
        } else {
          navigate(current.item.link);
        }
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, flatEntries, activeIndex, navigate, onClose]);

  if (!open) return null;

  let cursor = -1;
  const nextIsActive = () => {
    cursor += 1;
    return cursor === activeIndex;
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(8, 15, 31, 0.42)", backdropFilter: "blur(8px)", zIndex: 80 }}
      />
      <div style={{ position: "fixed", inset: 0, zIndex: 81, display: "grid", placeItems: "start center", padding: "72px 18px 18px" }}>
        <div
          style={{
            width: "min(860px, 100%)",
            borderRadius: 28,
            border: "1px solid #dde6f0",
            background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(251,252,255,0.98) 100%)",
            boxShadow: "0 30px 80px rgba(15,23,42,0.24)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 18, borderBottom: "1px solid #edf2f7", display: "grid", gap: 12, position: "relative" }}>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close quick search"
              style={{
                position: "absolute",
                top: 18,
                right: 18,
                width: 40,
                height: 40,
                borderRadius: 14,
                border: "1px solid #dbe4ef",
                background: "rgba(255,255,255,0.92)",
                color: "#6c7f94",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                boxShadow: "0 8px 20px rgba(15,23,42,0.08)",
              }}
            >
              <X size={17} />
            </button>
            <div style={{ position: "relative" }}>
              <Search size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#8393a8" }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="What do you want to find?"
                style={{
                  width: "100%",
                  height: 56,
                  borderRadius: 18,
                  border: "1px solid #dde5ef",
                  background: "#fff",
                  padding: "0 18px 0 48px",
                  fontSize: 16,
                  fontWeight: 600,
                  color: "#203245",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "#718196" }}>
                <span style={{ padding: "4px 8px", borderRadius: 999, background: "#f4f7fb", border: "1px solid #e0e7f0", fontWeight: 700 }}>Ctrl + K</span>
                Navigate accounts, prospects, deals, meetings, tasks, and knowledge.
              </div>
              {debouncedQuery && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "#5d7086", fontWeight: 700 }}>
                  <Users size={14} />
                  Search is live across Beacon CRM
                </div>
              )}
            </div>
          </div>

          <div style={{ maxHeight: "70vh", overflowY: "auto", padding: 18, display: "grid", gap: 18 }}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#6f8095", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Quick Actions
                </span>
                {!debouncedQuery && (
                  <span style={{ fontSize: 12, color: "#8a99ad" }}>Jump straight to the main workspaces</span>
                )}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {filteredQuickActions.map((item) => {
                  const isActive = nextIsActive();
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        navigate(item.link);
                        onClose();
                      }}
                      style={{
                        width: "100%",
                        border: isActive ? "1px solid #ffc8b3" : "1px solid #e5ebf3",
                        background: isActive ? "#fff4ed" : "#fff",
                        borderRadius: 18,
                        padding: "14px 16px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 14,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 14, background: isActive ? "#ff6b35" : "#eef4ff", color: isActive ? "#fff" : "#3555c4", display: "grid", placeItems: "center", flexShrink: 0 }}>
                          {getQuickActionIcon(item.icon)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: "#203245" }}>{item.title}</div>
                          <div style={{ marginTop: 4, fontSize: 12, color: "#6e8095", lineHeight: 1.6 }}>{item.subtitle}</div>
                          <div style={{ marginTop: 6, fontSize: 11, color: "#95a3b4", fontWeight: 700 }}>{item.meta}</div>
                        </div>
                      </div>
                      <ArrowRight size={15} color={isActive ? "#ff6b35" : "#8ca0b6"} />
                    </button>
                  );
                })}
              </div>
            </div>

            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#6f8095", fontSize: 13, padding: "6px 2px" }}>
                <Loader2 size={16} className="animate-spin" />
                Searching Beacon…
              </div>
            )}

            {!loading && results.map((section) => (
              <div key={section.key} style={{ display: "grid", gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#6f8095", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  {section.label}
                </span>
                <div style={{ display: "grid", gap: 8 }}>
                  {section.items.map((item) => {
                    const isActive = nextIsActive();
                    return (
                      <button
                        key={`${section.key}-${item.id}`}
                        type="button"
                        onClick={() => {
                          navigate(item.link);
                          onClose();
                        }}
                        style={{
                          width: "100%",
                          border: isActive ? "1px solid #cfe0fb" : "1px solid #e5ebf3",
                          background: isActive ? "#eef4ff" : "#fff",
                          borderRadius: 18,
                          padding: "14px 16px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 14,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: "#203245" }}>{item.title}</div>
                          {(item.subtitle || item.meta) && (
                            <div style={{ marginTop: 4, fontSize: 12, color: "#6e8095", lineHeight: 1.6 }}>
                              {item.subtitle}
                              {item.subtitle && item.meta ? " • " : ""}
                              {item.meta}
                            </div>
                          )}
                        </div>
                        <ArrowRight size={15} color={isActive ? "#3555c4" : "#8ca0b6"} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {!loading && debouncedQuery && results.length === 0 && filteredQuickActions.length === 0 && (
              <div style={{ borderRadius: 22, border: "1px dashed #dbe4ef", background: "#fbfcff", padding: 28, display: "grid", gap: 8, justifyItems: "center", textAlign: "center" }}>
                <Search size={22} color="#8da0b6" />
                <div style={{ fontSize: 15, fontWeight: 800, color: "#223547" }}>No matches found</div>
                <div style={{ fontSize: 13, color: "#708297", maxWidth: 460, lineHeight: 1.7 }}>
                  Try a company name, prospect name, email, deal name, task keyword, or knowledge-base topic.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
