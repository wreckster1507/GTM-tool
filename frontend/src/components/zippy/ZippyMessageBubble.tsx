import type { ReactNode } from "react";
import type { ZippyMessage } from "../../lib/api";

// Backend base URL — we concatenate it with the relative zippy_outputs URL
// the server returns so artifact links resolve against the API host, not the
// Vite dev server.
const API_BASE = import.meta.env.VITE_API_URL || "";

// Render a single chat turn. Matches the Beacon chatbot widget pattern:
//   - AI:   small avatar on the left + white card + timestamp at the bottom right
//   - User: dark bubble right-aligned + timestamp inside
// The markdown renderer is intentionally simple — we render bold / italic /
// code / links and split double-newlines into paragraphs.
export function ZippyMessageBubble({ message }: { message: ZippyMessage }) {
  const isUser = message.role === "user";
  const timestamp = formatClock(message.created_at);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-stone-900 px-3.5 py-2 text-[13px] text-white shadow-sm">
          <AssistantContent content={message.content} />
          {timestamp && (
            <div className="mt-1 text-right text-[10px] text-stone-300">
              {timestamp}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-sm">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
        </svg>
      </div>
      <div className="min-w-0 max-w-[88%] flex-1 rounded-2xl rounded-tl-sm border border-stone-200 bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-stone-800 shadow-sm">
        <AssistantContent content={message.content} />

        {message.artifacts && message.artifacts.length > 0 && (
          <div className="mt-3 flex flex-col gap-2 border-t border-stone-100 pt-3">
            {message.artifacts.map((artifact) => (
              <a
                key={artifact.url}
                href={`${API_BASE}${artifact.url}`}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start gap-2.5 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 transition hover:border-violet-400 hover:bg-violet-50"
              >
                <span className="mt-0.5 text-violet-600">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M4 4a2 2 0 012-2h5.586A2 2 0 0113 2.586L16.414 6A2 2 0 0117 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm7 0v3a1 1 0 001 1h3" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-violet-900">
                    {artifact.filename}
                  </div>
                  <div className="truncate text-[11px] text-violet-700/70">
                    {artifact.summary}
                  </div>
                </div>
                <span className="text-[11px] font-medium text-violet-600 group-hover:underline">
                  Open
                </span>
              </a>
            ))}
          </div>
        )}

        {message.citations && message.citations.length > 0 && (
          <div className="mt-3 border-t border-stone-100 pt-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
              Sources
            </div>
            <ul className="flex flex-col gap-1">
              {message.citations.slice(0, 5).map((c) => (
                <li key={`${c.source_id}-${c.chunk_index}`} className="text-[11px]">
                  <a
                    href={c.drive_url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-violet-700 hover:underline"
                    title={c.snippet}
                  >
                    <span>•</span>
                    <span className="truncate">{c.source_name}</span>
                    <span className="rounded bg-violet-100 px-1.5 text-[10px] text-violet-700">
                      {Math.round(c.score * 100)}%
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {timestamp && (
          <div className="mt-1.5 text-right text-[10px] text-stone-400">
            {timestamp}
          </div>
        )}
      </div>
    </div>
  );
}


function AssistantContent({ content }: { content: string }) {
  // Real markdown-ish rendering: paragraphs on blank lines, "- " collected
  // into proper <ul>, ### → bold heading, inline bold/italic/code/md-links.
  const blocks = parseBlocks(content);
  return (
    <div className="flex flex-col gap-2 break-words">
      {blocks.map((b, i) => {
        if (b.type === "list") {
          return (
            <ul
              key={i}
              className="ml-4 list-disc space-y-1 marker:text-stone-400"
            >
              {b.items.map((line, j) => (
                <li key={j}>{renderInline(line)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "heading") {
          return (
            <p key={i} className="font-semibold text-stone-900">
              {renderInline(b.text)}
            </p>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {renderInline(b.text)}
          </p>
        );
      })}
    </div>
  );
}


type Block =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "heading"; text: string };


function parseBlocks(content: string): Block[] {
  // Split on blank lines, then within each block pull out bullet runs so a
  // lead-in sentence + bullet list (no blank line between them) still renders.
  const blocks: Block[] = [];
  const paragraphs = content.split(/\n{2,}/);
  for (const para of paragraphs) {
    const lines = para.split("\n");
    let buffer: string[] = [];
    let currentList: string[] = [];
    const flushBuffer = () => {
      if (buffer.length) {
        blocks.push({ type: "paragraph", text: buffer.join("\n") });
        buffer = [];
      }
    };
    const flushList = () => {
      if (currentList.length) {
        blocks.push({ type: "list", items: currentList });
        currentList = [];
      }
    };
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      const heading = line.match(/^#{1,6}\s+(.*)$/);
      if (bullet) {
        flushBuffer();
        currentList.push(bullet[1]);
      } else if (heading) {
        flushBuffer();
        flushList();
        blocks.push({ type: "heading", text: heading[1] });
      } else {
        flushList();
        buffer.push(line);
      }
    }
    flushList();
    flushBuffer();
  }
  return blocks;
}


function renderInline(text: string): ReactNode[] {
  // Order matters: [text](url) before raw URLs so we don't double-match the
  // URL inside a markdown link.
  const tokens: ReactNode[] = [];
  const regex =
    /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    if (raw.startsWith("**")) {
      tokens.push(<strong key={`b-${key++}`}>{raw.slice(2, -2)}</strong>);
    } else if (raw.startsWith("`")) {
      tokens.push(
        <code
          key={`c-${key++}`}
          className="rounded bg-stone-100 px-1 py-0.5 text-[12px] text-stone-800"
        >
          {raw.slice(1, -1)}
        </code>,
      );
    } else if (raw.startsWith("[")) {
      // [label](url)
      const inner = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (inner) {
        tokens.push(
          <a
            key={`ml-${key++}`}
            href={inner[2]}
            target="_blank"
            rel="noreferrer"
            className="text-violet-600 underline decoration-violet-300 underline-offset-2 hover:decoration-violet-500"
          >
            {inner[1]}
          </a>,
        );
      } else {
        tokens.push(raw);
      }
    } else if (raw.startsWith("http")) {
      // Strip trailing punctuation not meant to be part of the URL.
      const clean = raw.replace(/[),.;:]+$/, "");
      tokens.push(
        <a
          key={`a-${key++}`}
          href={clean}
          target="_blank"
          rel="noreferrer"
          className="break-all text-violet-600 underline-offset-2 hover:underline"
        >
          {clean}
        </a>,
      );
      if (clean.length < raw.length) {
        tokens.push(raw.slice(clean.length));
      }
    } else if (raw.startsWith("*")) {
      tokens.push(<em key={`i-${key++}`}>{raw.slice(1, -1)}</em>);
    }
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
}


// "03:17 PM" — local-time clock format, matches the Beacon widget.
function formatClock(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
