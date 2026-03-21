import { CSSProperties, useEffect, useMemo, useState } from "react";
import { outreachApi } from "../../lib/api";
import type { Contact, OutreachSequence } from "../../types";
import { X, Sparkles, Copy, CheckCheck, Linkedin, Mail, RefreshCw, Send } from "lucide-react";
import { avatarColor, getInitials } from "../../lib/utils";

interface Props {
  contact: Contact | null;
  onClose: () => void;
}

type TabKey = "email_1" | "email_2" | "email_3" | "linkedin";

const TABS: { key: TabKey; label: string }[] = [
  { key: "email_1", label: "Email 1" },
  { key: "email_2", label: "Follow-up" },
  { key: "email_3", label: "Final" },
  { key: "linkedin", label: "LinkedIn" },
];

const PERSONA_LABEL: Record<string, string> = {
  economic_buyer: "Economic Buyer",
  champion: "Champion",
  technical_evaluator: "Technical Evaluator",
  unknown: "Unknown",
};

const PERSONA_STYLE: Record<string, CSSProperties> = {
  economic_buyer: { color: "#7b3a1d", background: "#ffe8de", border: "1px solid #ffc8b4" },
  champion: { color: "#1b6f53", background: "#e4fbf3", border: "1px solid #b8efd8" },
  technical_evaluator: { color: "#24567e", background: "#eaf4ff", border: "1px solid #c9e0f8" },
  unknown: { color: "#546679", background: "#edf3f9", border: "1px solid #d7e1eb" },
};

const palette = {
  panelBg: "#ffffff",
  line: "#dbe4ee",
  text: "#24384d",
  sub: "#5d748b",
  muted: "#7f93a8",
  soft: "#f4f8fc",
  accent: "#ff6b35",
  accentDark: "#e05725",
  accentSoft: "#fff1ea",
};

export default function OutreachDrawer({ contact, onClose }: Props) {
  const isOpen = !!contact;

  const [seq, setSeq] = useState<OutreachSequence | null>(null);
  const [tab, setTab] = useState<TabKey>("email_1");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!contact) {
      setSeq(null);
      setError("");
      return;
    }

    setLoading(true);
    setTab("email_1");

    outreachApi
      .getSequence(contact.id)
      .then((s) => {
        setSeq(s);
        setError("");
      })
      .catch(() => {
        setSeq(null);
        setError("");
      })
      .finally(() => setLoading(false));
  }, [contact?.id]);

  const handleGenerate = async () => {
    if (!contact) return;
    setGenerating(true);
    setError("");

    try {
      const result = await outreachApi.generate(contact.id);
      setSeq(result);
      setTab("email_1");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const subject = useMemo(() => {
    if (!seq) return null;
    if (tab === "email_1") return seq.subject_1 ?? null;
    if (tab === "email_2") return seq.subject_2 ?? null;
    if (tab === "email_3") return seq.subject_3 ?? null;
    return null;
  }, [seq, tab]);

  const body = useMemo(() => {
    if (!seq) return "";
    let text = "";
    if (tab === "email_1") text = seq.email_1 ?? "";
    else if (tab === "email_2") text = seq.email_2 ?? "";
    else if (tab === "email_3") text = seq.email_3 ?? "";
    else text = seq.linkedin_message ?? "";
    return text.replace(/^Subject:.*\n\n?/i, "").trim();
  }, [seq, tab]);

  const handleCopy = async () => {
    const full = subject ? `Subject: ${subject}\n\n${body}` : body;
    if (!full) return;
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 40,
          background: "rgba(16, 24, 40, 0.24)",
          backdropFilter: "blur(2px)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 220ms ease",
        }}
      />

      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          zIndex: 50,
          height: "100%",
          width: "min(780px, 100%)",
          background: palette.panelBg,
          borderLeft: `1px solid ${palette.line}`,
          boxShadow: "-16px 0 40px rgba(10, 21, 42, 0.18)",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 260ms ease",
          display: "grid",
          gridTemplateRows: "auto 1fr",
        }}
      >
        <header
          style={{
            padding: "18px 22px",
            borderBottom: `1px solid ${palette.line}`,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
            {contact ? (
              <div
                className={avatarColor(contact.first_name + contact.last_name)}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "999px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {getInitials(`${contact.first_name} ${contact.last_name}`)}
              </div>
            ) : null}

            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 26, color: palette.text, fontWeight: 800 }}>
                  {contact ? `${contact.first_name} ${contact.last_name}` : "Outreach"}
                </h2>
                {contact?.persona ? (
                  <span
                    style={{
                      ...(PERSONA_STYLE[contact.persona] ?? PERSONA_STYLE.unknown),
                      borderRadius: 999,
                      padding: "4px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {PERSONA_LABEL[contact.persona] ?? contact.persona}
                  </span>
                ) : null}
              </div>
              <p style={{ margin: "6px 0 0", color: palette.sub, fontSize: 15, lineHeight: 1.4 }}>
                {contact?.title ?? ""}
                {contact?.email ? ` · ${contact.email}` : ""}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              border: 0,
              background: "transparent",
              color: palette.muted,
              cursor: "pointer",
              padding: 2,
            }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ overflowY: "auto", padding: "20px 22px 24px", background: "#fbfdff" }}>
          {loading ? (
            <div style={{ height: 180, display: "grid", placeItems: "center", color: palette.sub }}>Loading...</div>
          ) : !seq ? (
            <div
              style={{
                ...panel,
                minHeight: 220,
                display: "grid",
                placeItems: "center",
                textAlign: "center",
                gap: 14,
              }}
            >
              <Mail size={28} color={palette.accent} />
              <p style={{ margin: 0, color: palette.sub, lineHeight: 1.6, fontSize: 15 }}>
                No outreach sequence yet. Generate one with AI.
              </p>
              <button onClick={handleGenerate} disabled={generating} style={primaryBtn}>
                {generating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />} 
                {generating ? "Generating..." : "Generate Sequence"}
              </button>
              {error ? <p style={{ margin: 0, color: "#b42336", fontSize: 13 }}>{error}</p> : null}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ ...panel, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <StatusChip status={seq.status} />
                  {seq.generated_at ? (
                    <span style={{ color: palette.muted, fontSize: 12 }}>
                      Draft {new Date(seq.generated_at).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
                <button onClick={handleGenerate} disabled={generating} style={ghostBtn}>
                  <RefreshCw size={13} className={generating ? "animate-spin" : ""} /> Regenerate
                </button>
              </div>

              <div style={{ ...panel, padding: 8, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    style={{
                      border: 0,
                      borderRadius: 10,
                      padding: "10px 8px",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 13,
                      color: tab === t.key ? palette.text : palette.sub,
                      background: tab === t.key ? "#ffffff" : "transparent",
                      boxShadow: tab === t.key ? "0 1px 5px rgba(30,50,80,0.15)" : "none",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    {t.key === "linkedin" ? <Linkedin size={13} /> : <Mail size={13} />}
                    {t.label}
                  </button>
                ))}
              </div>

              {tab !== "linkedin" && subject ? (
                <div style={{ ...panel, padding: "12px 14px" }}>
                  <div style={{ color: palette.muted, fontSize: 11, letterSpacing: 0.4, fontWeight: 700 }}>SUBJECT</div>
                  <div style={{ marginTop: 5, color: palette.text, fontWeight: 800, fontSize: 17, lineHeight: 1.4 }}>{subject}</div>
                </div>
              ) : null}

              <div style={{ ...panel, padding: "14px 14px 16px", position: "relative" }}>
                {body ? (
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                      color: palette.text,
                      lineHeight: 1.65,
                      fontSize: 17,
                    }}
                  >
                    {body}
                  </pre>
                ) : (
                  <div style={{ color: palette.muted, fontStyle: "italic" }}>No content for this touch.</div>
                )}

                {body ? (
                  <button onClick={handleCopy} style={{ ...copyBtn, position: "absolute", top: 12, right: 12 }}>
                    {copied ? <CheckCheck size={13} color="#1f8f5f" /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                ) : null}
              </div>

              {tab === "linkedin" && contact?.linkedin_url ? (
                <a
                  href={contact.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...panel, padding: "10px 12px", color: palette.accent, fontWeight: 700, fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, justifySelf: "start" }}
                >
                  <Linkedin size={13} /> Open LinkedIn profile
                </a>
              ) : null}

              {tab !== "linkedin" ? (
                <div style={{ ...panel, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <p style={{ margin: 0, color: palette.sub, fontSize: 13 }}>
                      {tab === "email_1" && "Day 1 — initial cold outreach"}
                      {tab === "email_2" && "Day 3 — follow-up with new insight"}
                      {tab === "email_3" && "Day 7 — final touch / soft CTA"}
                    </p>
                    <button disabled style={disabledSendBtn}>
                      <Send size={13} /> Send
                    </button>
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #ffd7c8",
                      background: palette.accentSoft,
                      color: "#8f3f20",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Sending is disabled while we are in development.
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function StatusChip({ status }: { status: string }) {
  const style: CSSProperties =
    status === "approved"
      ? { color: "#1f8f5f", background: "#e8f8f0", border: "1px solid #bde8d1" }
      : status === "sent"
      ? { color: "#24567e", background: "#eaf4ff", border: "1px solid #c9e0f8" }
      : { color: "#546679", background: "#edf3f9", border: "1px solid #d7e1eb" };

  return (
    <span
      style={{
        ...style,
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

const panel: CSSProperties = {
  background: "#ffffff",
  border: `1px solid ${palette.line}`,
  borderRadius: 12,
  boxShadow: "0 2px 6px rgba(17, 34, 68, 0.05)",
};

const primaryBtn: CSSProperties = {
  border: 0,
  borderRadius: 10,
  background: palette.accent,
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  padding: "9px 12px",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
};

const ghostBtn: CSSProperties = {
  border: `1px solid ${palette.line}`,
  borderRadius: 10,
  background: "#fff",
  color: palette.sub,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  padding: "8px 10px",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
};

const copyBtn: CSSProperties = {
  border: `1px solid ${palette.line}`,
  borderRadius: 8,
  background: "#fff",
  color: palette.sub,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  padding: "6px 9px",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const disabledSendBtn: CSSProperties = {
  border: "1px solid #ffd2bf",
  borderRadius: 9,
  background: "#ffe8de",
  color: "#8f3f20",
  fontSize: 12,
  fontWeight: 700,
  cursor: "not-allowed",
  padding: "7px 10px",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  opacity: 0.85,
};
