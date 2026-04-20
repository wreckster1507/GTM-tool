import { KeyboardEvent, useRef, useState } from "react";

interface ZippyComposerProps {
  disabled?: boolean;
  onSubmit: (text: string) => void;
}

// Auto-growing textarea + Enter-to-send (Shift+Enter for newline) — standard
// Copilot/ChatGPT feel. Resets height after send.
//
// Layout: a single rounded box with the textarea on top and the keyboard
// hint + send button in the action row below. Keeps the composer compact
// so the thread above gets most of the vertical space.
export function ZippyComposer({ disabled, onSubmit }: ZippyComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function handleChange(v: string) {
    setValue(v);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      // Cap the textarea at ~6 lines so long pastes scroll internally rather
      // than pushing the composer off-screen.
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
    const el = textareaRef.current;
    if (el) el.style.height = "auto";
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="border-t border-stone-200 bg-stone-50/60 px-3 py-2.5">
      <div className="flex flex-col gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 shadow-sm focus-within:border-violet-400">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Zippy anything — grounded in your Drive + Beacon's shared knowledge base."
          className="max-h-[160px] min-h-[28px] w-full resize-none bg-transparent text-sm leading-snug text-stone-900 placeholder-stone-400 focus:outline-none"
          disabled={disabled}
        />
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-stone-400">
            ⏎ send · Shift+⏎ newline · ⌘J toggle · Esc close
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-sm transition hover:from-violet-700 hover:to-fuchsia-600 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M3.105 3.105a.5.5 0 01.55-.105l13 5.5a.5.5 0 010 .92l-13 5.5a.5.5 0 01-.682-.63l1.89-4.74L10 10 4.863 8.475 2.973 3.735a.5.5 0 01.132-.63z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
