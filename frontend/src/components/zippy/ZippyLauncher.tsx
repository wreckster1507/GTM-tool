import { useEffect, useState } from "react";
import { ZippyPanel } from "./ZippyPanel";

// Floating launcher button in the bottom-right. Opens the Copilot-style side
// panel. We keep the open/closed state in this component so pages don't have
// to pass anything to enable Zippy — it's globally available.
export function ZippyLauncher() {
  const [open, setOpen] = useState(false);

  // Keyboard shortcut: ⌘/Ctrl + J toggles Zippy, matching Copilot feel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-br from-violet-600 via-violet-500 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:shadow-violet-500/50 active:scale-[0.98]"
        aria-label="Open Zippy"
      >
        <span aria-hidden="true" className="relative flex h-5 w-5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/30" />
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="relative h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span>Ask Zippy</span>
        <span className="ml-1 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
          ⌘J
        </span>
      </button>

      <ZippyPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
