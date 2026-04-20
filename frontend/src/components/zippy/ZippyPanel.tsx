import { useEffect, useMemo, useRef, useState } from "react";
import {
  knowledgeApi,
  zippyApi,
  type IndexStatus,
  type ZippyConversationSummary,
  type ZippyMessage,
} from "../../lib/api";
import { ZippyMessageBubble } from "./ZippyMessageBubble";
import { ZippyComposer } from "./ZippyComposer";

interface ZippyPanelProps {
  open: boolean;
  onClose: () => void;
}

// Copilot-style side panel. Default view is just the active thread so
// messages are easy to read. The session history is hidden behind a clock
// icon in the header — click it to reveal a compact list, click again or
// anywhere outside to collapse. That mirrors the Beacon chatbot widget
// pattern (+ / history / minimise / close).
export function ZippyPanel({ open, onClose }: ZippyPanelProps) {
  const [conversations, setConversations] = useState<ZippyConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ZippyMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sessions drawer is closed by default — opens on demand from the header.
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Knowledge footer — "Grounded in N files · Last synced Xm ago"
  const [userStatus, setUserStatus] = useState<IndexStatus | null>(null);
  const [adminStatus, setAdminStatus] = useState<IndexStatus | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load the session list + footer stats the first time the panel opens.
  useEffect(() => {
    if (!open) return;
    void refreshConversations();
    void loadKnowledgeStatus();
    return undefined;
  }, [open]);

  async function refreshConversations() {
    setRefreshing(true);
    try {
      const data = await zippyApi.listConversations(30);
      setConversations(data);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function loadKnowledgeStatus() {
    try {
      const [user, admin] = await Promise.all([
        knowledgeApi.status("user").catch(() => null),
        knowledgeApi.status("admin").catch(() => null),
      ]);
      setUserStatus(user);
      setAdminStatus(admin);
    } catch {
      // Footer chip silently hides when this fails.
    }
  }

  // Load the selected thread's messages.
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingThread(true);
    zippyApi
      .getConversation(activeId)
      .then((data) => {
        if (!cancelled) setMessages(data.messages);
      })
      .catch((e) => {
        if (!cancelled) setError(formatError(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingThread(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Auto-scroll to the newest message whenever the list grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, loadingThread]);

  const suggestions = useMemo(
    () => [
      "Summarise the last client call with Optera.",
      "Draft a mutual NDA for Beacon and Acme Corp (India).",
      "Generate a MOM from the notes below.",
      "What's in the ROI deck for e2open?",
    ],
    [],
  );

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(term));
  }, [conversations, search]);

  const footerStats = useMemo(() => {
    const userFiles = userStatus?.total_files ?? 0;
    const adminFiles = adminStatus?.total_files ?? 0;
    const totalFiles = userFiles + adminFiles;
    const lastSynced = computeLastSynced([
      ...(userStatus?.files ?? []),
      ...(adminStatus?.files ?? []),
    ]);
    return { totalFiles, lastSynced };
  }, [userStatus, adminStatus]);

  async function sendMessage(text: string) {
    if (!text.trim() || sending) return;
    setError(null);
    setSending(true);

    // Optimistic user bubble.
    const optimistic: ZippyMessage = {
      id: `local-${Date.now()}`,
      conversation_id: activeId ?? "",
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const res = await zippyApi.send({
        message: text,
        conversation_id: activeId ?? undefined,
      });
      setActiveId(res.conversation_id);
      setMessages((prev) => {
        const normalised = prev.map((m) =>
          m.id === optimistic.id ? { ...m, conversation_id: res.conversation_id } : m,
        );
        return [...normalised, res.message];
      });
      zippyApi
        .listConversations(30)
        .then(setConversations)
        .catch(() => {});
    } catch (e) {
      setError(formatError(e));
    } finally {
      setSending(false);
    }
  }

  function startNewChat() {
    setActiveId(null);
    setMessages([]);
    setError(null);
    setSessionsOpen(false);
  }

  function pickConversation(id: string) {
    setActiveId(id);
    setSessionsOpen(false);
  }

  return (
    <>
      {/* Scrim */}
      <div
        className={`fixed inset-0 z-40 bg-stone-900/30 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] transform flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-stone-200 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-sm">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-stone-900">Zippy</div>
            <div className="truncate text-[11px] text-stone-500">
              Grounded in your Drive + Beacon's shared knowledge base
            </div>
          </div>
          <div className="flex items-center gap-1">
            <HeaderIconButton label="New chat" onClick={startNewChat}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
                <path d="M12 8v6M9 11h6" />
              </svg>
            </HeaderIconButton>
            <HeaderIconButton
              label="Chat history"
              active={sessionsOpen}
              onClick={() => setSessionsOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </HeaderIconButton>
            <HeaderIconButton label="Close" onClick={onClose}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path
                  fillRule="evenodd"
                  d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </HeaderIconButton>
          </div>
        </header>

        {/* Sessions drawer — only rendered when open */}
        {sessionsOpen && (
          <div className="border-b border-stone-200 bg-stone-50/60">
            <div className="flex items-center gap-2 px-4 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                Chat history
              </div>
              <div className="ml-auto flex items-center gap-1 text-stone-500">
                <button
                  type="button"
                  onClick={() => void refreshConversations()}
                  disabled={refreshing}
                  title="Refresh"
                  aria-label="Refresh"
                  className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-stone-200 hover:text-stone-700 disabled:opacity-50"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                  >
                    <path d="M23 4v6h-6M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setSessionsOpen(false)}
                  title="Close"
                  aria-label="Close history"
                  className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-stone-200 hover:text-stone-700"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="px-3 pb-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations..."
                className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-800 placeholder-stone-400 focus:border-violet-400 focus:outline-none"
              />
            </div>
            <div className="max-h-[240px] overflow-y-auto px-2 pb-2">
              {filteredConversations.length === 0 ? (
                <div className="px-2.5 py-4 text-center text-xs text-stone-400">
                  {conversations.length === 0
                    ? "No conversations yet."
                    : "No sessions match your search."}
                </div>
              ) : (
                filteredConversations.map((c) => {
                  const isActive = activeId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickConversation(c.id)}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition ${
                        isActive
                          ? "bg-violet-100 text-violet-900"
                          : "text-stone-700 hover:bg-white hover:shadow-sm"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                          isActive ? "bg-violet-600" : "bg-stone-300"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">
                          {c.title}
                        </div>
                        <div className="truncate text-[10px] text-stone-400">
                          {formatSessionMeta(c)}
                        </div>
                      </div>
                      <span className="flex-shrink-0 text-[10px] text-stone-400">
                        {formatRelative(c.updated_at)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Thread */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        >
          {messages.length === 0 && !loadingThread && (
            <ZippyWelcome
              suggestions={suggestions}
              onPick={(text) => void sendMessage(text)}
            />
          )}
          {loadingThread && (
            <div className="flex h-full items-center justify-center text-xs text-stone-400">
              Loading conversation…
            </div>
          )}
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <ZippyMessageBubble key={m.id} message={m} />
            ))}
            {sending && (
              <div className="flex items-center gap-2 px-1 text-xs text-stone-400">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400" />
                </span>
                Zippy is thinking…
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <ZippyComposer disabled={sending} onSubmit={sendMessage} />

        {/* Status chip */}
        <div className="flex items-center gap-2 border-t border-stone-200 bg-white px-4 py-2 text-[11px] text-stone-500">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              footerStats.totalFiles > 0 ? "bg-emerald-500" : "bg-stone-300"
            }`}
          />
          {footerStats.totalFiles > 0 ? (
            <span>
              Grounded in {footerStats.totalFiles} file
              {footerStats.totalFiles === 1 ? "" : "s"}
              {footerStats.lastSynced
                ? ` · Last synced ${footerStats.lastSynced}`
                : ""}
            </span>
          ) : (
            <span>Connect a Drive folder in Settings to ground Zippy.</span>
          )}
        </div>
      </aside>
    </>
  );
}


function HeaderIconButton({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition ${
        active
          ? "bg-violet-100 text-violet-700"
          : "text-stone-500 hover:bg-stone-100 hover:text-stone-700"
      }`}
    >
      {children}
    </button>
  );
}


function ZippyWelcome({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center pt-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-200">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
          <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
        </svg>
      </div>
      <h2 className="mt-3 text-base font-semibold text-stone-900">
        How can I help, today?
      </h2>
      <p className="mt-1 max-w-sm text-xs text-stone-500">
        Ask about files in your Drive, generate a MOM from call notes, or draft
        an NDA for any jurisdiction.
      </p>
      <div className="mt-5 grid w-full grid-cols-1 gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-left text-xs text-stone-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}


function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "Something went wrong talking to Zippy.";
  }
}


// "2h", "3d", "now" — compact relative time for the session row.
function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 45) return "now";
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h`;
  if (diffSec < 30 * 86400) return `${Math.round(diffSec / 86400)}d`;
  return `${Math.round(diffSec / (30 * 86400))}mo`;
}


// "Completed in 4s · 2 messages" — or just "N messages" for longer threads
// where wall-clock duration isn't meaningful.
function formatSessionMeta(c: ZippyConversationSummary): string {
  const count = c.message_count;
  const plural = count === 1 ? "" : "s";
  const created = new Date(c.created_at).getTime();
  const updated = new Date(c.updated_at).getTime();
  if (
    !Number.isNaN(created) &&
    !Number.isNaN(updated) &&
    updated >= created
  ) {
    const diffSec = Math.round((updated - created) / 1000);
    if (diffSec > 0 && diffSec < 120) {
      return `Completed in ${diffSec}s · ${count} message${plural}`;
    }
  }
  return `${count} message${plural}`;
}


// Most recent `last_indexed_at` across every file, formatted as "Xm ago".
function computeLastSynced(
  files: Array<{ last_indexed_at: string | null }>,
): string | null {
  let latest = 0;
  for (const f of files) {
    if (!f.last_indexed_at) continue;
    const t = new Date(f.last_indexed_at).getTime();
    if (!Number.isNaN(t) && t > latest) latest = t;
  }
  if (latest === 0) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - latest) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}
