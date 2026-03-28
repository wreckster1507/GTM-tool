import { CSSProperties, useEffect, useMemo, useState } from "react";
import { outreachApi } from "../../lib/api";
import type { Contact, OutreachSequence } from "../../types";
import {
  X, Sparkles, Copy, CheckCheck, Linkedin, Mail, RefreshCw,
  Send, Rocket, CheckCircle, Clock, MessageSquare, ExternalLink, ChevronDown, ChevronUp,
  Pencil, Check,
} from "lucide-react";
import { avatarColor, getInitials } from "../../lib/utils";

interface Props {
  contact: Contact | null;
  onClose: () => void;
}

type TabKey = "email_1" | "email_2" | "email_3" | "linkedin";

const TABS: { key: TabKey; label: string; day: string }[] = [
  { key: "email_1", label: "Email 1", day: "Day 0" },
  { key: "email_2", label: "Follow-up", day: "Day 3" },
  { key: "email_3", label: "Final", day: "Day 7" },
  { key: "linkedin", label: "LinkedIn", day: "" },
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
  green: "#1f8f5f",
  greenSoft: "#e8f8f0",
  greenBorder: "#bde8d1",
  blue: "#24567e",
  blueSoft: "#eaf4ff",
  blueBorder: "#c9e0f8",
};

const DEFAULT_SENDING_ACCOUNT = "mahesh@beacon.li";

export default function OutreachDrawer({ contact, onClose }: Props) {
  const isOpen = !!contact;

  const [seq, setSeq] = useState<OutreachSequence | null>(null);
  const [tab, setTab] = useState<TabKey>("email_1");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  // Launch state
  const [sendingAccount, setSendingAccount] = useState(DEFAULT_SENDING_ACCOUNT);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");

  // Inline editing state
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  // Replies state
  const [replies, setReplies] = useState<Array<{ subject?: string; body?: string; from_email?: string; timestamp?: string; created_at?: string }>>([]);
  const [showReplies, setShowReplies] = useState(false);
  const [loadingReplies, setLoadingReplies] = useState(false);

  useEffect(() => {
    if (!contact) {
      setSeq(null);
      setError("");
      setLaunchError("");
      setReplies([]);
      return;
    }

    setLoading(true);
    setTab("email_1");

    outreachApi
      .getSequence(contact.id)
      .then((s) => {
        setSeq(s);
        setError("");
        // Auto-load replies if already launched
        if (s.instantly_campaign_id) {
          loadReplies(s.id);
        }
      })
      .catch(() => {
        setSeq(null);
        setError("");
      })
      .finally(() => setLoading(false));
  }, [contact?.id]);

  const loadReplies = async (sequenceId: string) => {
    setLoadingReplies(true);
    try {
      const result = await outreachApi.getReplies(sequenceId);
      setReplies(result.replies ?? []);
    } catch {
      // Non-fatal
    } finally {
      setLoadingReplies(false);
    }
  };

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

  const handleLaunch = async () => {
    if (!seq || !sendingAccount.trim()) return;
    setLaunching(true);
    setLaunchError("");
    try {
      await outreachApi.launch(seq.id, sendingAccount.trim());
      // Reload the sequence to get updated campaign ID and status
      const updated = await outreachApi.getSequence(contact!.id);
      setSeq(updated);
      // Load replies (will be empty initially but sets up the section)
      if (updated.instantly_campaign_id) {
        await loadReplies(updated.id);
      }
    } catch (e: unknown) {
      setLaunchError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setLaunching(false);
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

  const handleStartEdit = () => {
    setEditSubject(subject ?? "");
    setEditBody(body);
    setEditing(true);
    setSaveOk(false);
  };

  const handleSave = async () => {
    if (!seq) return;
    setSaving(true);
    const subjectKey = tab === "email_1" ? "subject_1" : tab === "email_2" ? "subject_2" : "subject_3";
    const bodyKey = tab === "email_1" ? "email_1" : tab === "email_2" ? "email_2" : tab === "email_3" ? "email_3" : "linkedin_message";
    try {
      const updated = await outreachApi.updateSequence(seq.id, {
        [subjectKey]: editSubject,
        [bodyKey]: editBody,
      });
      setSeq(updated);
      setEditing(false);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } catch {
      // keep editing open on error
    } finally {
      setSaving(false);
    }
  };

  const handleTabChange = (key: TabKey) => {
    setTab(key);
    setEditing(false);
    setSaveOk(false);
  };

  const isLaunched = !!seq?.instantly_campaign_id;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 40,
          background: "rgba(16, 24, 40, 0.24)",
          backdropFilter: "blur(2px)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 220ms ease",
        }}
      />

      <aside
        style={{
          position: "fixed", top: 0, right: 0, zIndex: 50,
          height: "100%", width: "min(800px, 100%)",
          background: palette.panelBg,
          borderLeft: `1px solid ${palette.line}`,
          boxShadow: "-16px 0 40px rgba(10, 21, 42, 0.18)",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 260ms ease",
          display: "grid",
          gridTemplateRows: "auto 1fr",
        }}
      >
        {/* Header */}
        <header style={{
          padding: "18px 22px",
          borderBottom: `1px solid ${palette.line}`,
          display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
            {contact && (
              <div
                className={avatarColor(contact.first_name + contact.last_name)}
                style={{
                  width: 42, height: 42, borderRadius: "999px",
                  display: "inline-flex", alignItems: "center",
                  justifyContent: "center", fontSize: 13, fontWeight: 800, flexShrink: 0,
                }}
              >
                {getInitials(`${contact.first_name} ${contact.last_name}`)}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 22, color: palette.text, fontWeight: 800 }}>
                  {contact ? `${contact.first_name} ${contact.last_name}` : "Outreach"}
                </h2>
                {contact?.persona && (
                  <span style={{
                    ...(PERSONA_STYLE[contact.persona] ?? PERSONA_STYLE.unknown),
                    borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700,
                  }}>
                    {PERSONA_LABEL[contact.persona] ?? contact.persona}
                  </span>
                )}
                {isLaunched && (
                  <span style={{
                    borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700,
                    color: palette.green, background: palette.greenSoft, border: `1px solid ${palette.greenBorder}`,
                    display: "inline-flex", alignItems: "center", gap: 4,
                  }}>
                    <CheckCircle size={10} /> Live in Instantly
                  </span>
                )}
              </div>
              <p style={{ margin: "4px 0 0", color: palette.sub, fontSize: 14, lineHeight: 1.4 }}>
                {contact?.title ?? ""}
                {contact?.email ? ` · ${contact.email}` : ""}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ border: 0, background: "transparent", color: palette.muted, cursor: "pointer", padding: 2 }}>
            <X size={18} />
          </button>
        </header>

        {/* Body */}
        <div style={{ overflowY: "auto", padding: "20px 22px 32px", background: "#fbfdff" }}>
          {loading ? (
            <div style={{ height: 180, display: "grid", placeItems: "center", color: palette.sub }}>Loading...</div>
          ) : !seq ? (
            // ── Empty state ───────────────────────────────────────────────────
            <div style={{ ...panel, minHeight: 220, display: "grid", placeItems: "center", textAlign: "center", gap: 14 }}>
              <Mail size={28} color={palette.accent} />
              <p style={{ margin: 0, color: palette.sub, lineHeight: 1.6, fontSize: 15 }}>
                No outreach sequence yet. Generate one with AI.
              </p>
              <button onClick={handleGenerate} disabled={generating} style={primaryBtn}>
                {generating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {generating ? "Generating..." : "Generate Sequence"}
              </button>
              {error && <p style={{ margin: 0, color: "#b42336", fontSize: 13 }}>{error}</p>}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>

              {/* ── Status bar ─────────────────────────────────────────────── */}
              <div style={{ ...panel, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <StatusChip status={seq.status} />
                  {seq.generated_at && (
                    <span style={{ color: palette.muted, fontSize: 12 }}>
                      Generated {new Date(seq.generated_at).toLocaleDateString()}
                    </span>
                  )}
                  {seq.launched_at && (
                    <span style={{ color: palette.muted, fontSize: 12 }}>
                      · Launched {new Date(seq.launched_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <button onClick={handleGenerate} disabled={generating || isLaunched} style={ghostBtn} title={isLaunched ? "Cannot regenerate after launch" : undefined}>
                  <RefreshCw size={13} className={generating ? "animate-spin" : ""} /> Regenerate
                </button>
              </div>

              {/* ── Step timeline ───────────────────────────────────────────── */}
              <StepTimeline seq={seq} />

              {/* ── Email tabs ──────────────────────────────────────────────── */}
              <div style={{ ...panel, padding: 8, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => handleTabChange(t.key)}
                    style={{
                      border: 0, borderRadius: 10, padding: "10px 8px",
                      cursor: "pointer", fontWeight: 700, fontSize: 13,
                      color: tab === t.key ? palette.text : palette.sub,
                      background: tab === t.key ? "#ffffff" : "transparent",
                      boxShadow: tab === t.key ? "0 1px 5px rgba(30,50,80,0.15)" : "none",
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                      flexDirection: "column",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {t.key === "linkedin" ? <Linkedin size={13} /> : <Mail size={13} />}
                      {t.label}
                    </span>
                    {t.day && <span style={{ fontSize: 10, fontWeight: 600, color: palette.muted }}>{t.day}</span>}
                  </button>
                ))}
              </div>

              {/* Subject */}
              {tab !== "linkedin" && (subject || editing) && (
                <div style={{ ...panel, padding: "12px 14px" }}>
                  <div style={{ color: palette.muted, fontSize: 11, letterSpacing: 0.4, fontWeight: 700, marginBottom: 6 }}>SUBJECT</div>
                  {editing ? (
                    <input
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${palette.accent}`, borderRadius: 8, padding: "7px 10px", fontSize: 15, fontWeight: 700, color: palette.text, fontFamily: "inherit", outline: "none" }}
                    />
                  ) : (
                    <div style={{ color: palette.text, fontWeight: 800, fontSize: 17, lineHeight: 1.4 }}>{subject}</div>
                  )}
                </div>
              )}

              {/* Body */}
              <div style={{ ...panel, padding: "14px 14px 16px", position: "relative" }}>
                {editing ? (
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={12}
                    style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${palette.accent}`, borderRadius: 8, padding: "10px", fontSize: 15, color: palette.text, fontFamily: "inherit", lineHeight: 1.65, resize: "vertical", outline: "none" }}
                  />
                ) : body ? (
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", color: palette.text, lineHeight: 1.65, fontSize: 16 }}>
                    {body}
                  </pre>
                ) : (
                  <div style={{ color: palette.muted, fontStyle: "italic" }}>No content for this touch.</div>
                )}

                {/* Edit / Save / Copy controls */}
                <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 6 }}>
                  {!isLaunched && !editing && body && (
                    <button onClick={handleStartEdit} style={copyBtn}>
                      <Pencil size={12} /> Edit
                    </button>
                  )}
                  {editing && (
                    <>
                      <button onClick={() => setEditing(false)} style={copyBtn}>Cancel</button>
                      <button onClick={handleSave} disabled={saving} style={{ ...copyBtn, color: palette.green, borderColor: palette.greenBorder }}>
                        {saving ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </>
                  )}
                  {!editing && body && saveOk && (
                    <span style={{ ...copyBtn, color: palette.green, borderColor: palette.greenBorder, cursor: "default" }}>
                      <Check size={12} /> Saved
                    </span>
                  )}
                  {!editing && body && (
                    <button onClick={handleCopy} style={copyBtn}>
                      {copied ? <CheckCheck size={13} color={palette.green} /> : <Copy size={13} />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  )}
                </div>
              </div>

              {/* LinkedIn profile link */}
              {tab === "linkedin" && contact?.linkedin_url && (
                <a
                  href={contact.linkedin_url}
                  target="_blank" rel="noopener noreferrer"
                  style={{ ...panel, padding: "10px 12px", color: palette.accent, fontWeight: 700, fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, justifySelf: "start" }}
                >
                  <Linkedin size={13} /> Open LinkedIn profile
                </a>
              )}

              {/* ── Launch section ──────────────────────────────────────────── */}
              {tab !== "linkedin" && (
                isLaunched ? (
                  // Already launched — show campaign info
                  <div style={{ ...panel, padding: "14px 16px", borderLeft: `3px solid ${palette.green}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <CheckCircle size={15} color={palette.green} />
                        <span style={{ fontWeight: 700, color: palette.green, fontSize: 14 }}>Sequence live in Instantly</span>
                      </div>
                      <a
                        href="https://app.instantly.ai/app/campaigns"
                        target="_blank" rel="noopener noreferrer"
                        style={{ ...ghostBtn, textDecoration: "none", fontSize: 12 }}
                      >
                        <ExternalLink size={12} /> View Campaign
                      </a>
                    </div>
                    {seq.instantly_campaign_id && (
                      <div style={{ marginTop: 8, fontSize: 11, color: palette.muted, fontFamily: "monospace" }}>
                        Campaign ID: {seq.instantly_campaign_id}
                      </div>
                    )}
                  </div>
                ) : (
                  // Not launched — always show sending account + launch button
                  <div style={{ ...panel, padding: "16px 16px" }}>
                    <div style={{ display: "grid", gap: 12 }}>
                      <div style={{ fontWeight: 700, color: palette.text, fontSize: 14, display: "flex", alignItems: "center", gap: 7 }}>
                        <Rocket size={14} color={palette.accent} /> Launch to Instantly
                      </div>

                      {/* Sending account — always visible */}
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 700, color: palette.sub, display: "block", marginBottom: 5 }}>
                          SENDING FROM
                        </label>
                        <input
                          type="email"
                          value={sendingAccount}
                          onChange={(e) => setSendingAccount(e.target.value)}
                          placeholder="sender@yourdomain.com"
                          style={{
                            width: "100%", boxSizing: "border-box",
                            border: `1px solid ${palette.line}`, borderRadius: 8,
                            padding: "9px 12px", fontSize: 14, color: palette.text,
                            fontFamily: "inherit", outline: "none",
                          }}
                        />
                        <p style={{ margin: "5px 0 0", fontSize: 11, color: palette.muted }}>
                          Must be a connected sending account in Instantly (e.g. mahesh@beacon.li)
                        </p>
                      </div>

                      {/* Info note */}
                      <div style={{
                        padding: "8px 10px", borderRadius: 8,
                        background: palette.blueSoft, border: `1px solid ${palette.blueBorder}`,
                        fontSize: 12, color: palette.blue,
                      }}>
                        Sends Day 0 → Day 3 → Day 7 · Auto-stops on reply · Opens & clicks tracked
                      </div>

                      {launchError && (
                        <p style={{ margin: 0, color: "#b42336", fontSize: 13 }}>{launchError}</p>
                      )}

                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button onClick={handleLaunch} disabled={launching || !sendingAccount.trim()} style={launchBtn}>
                          {launching ? <RefreshCw size={13} className="animate-spin" /> : <Rocket size={13} />}
                          {launching ? "Launching..." : "Launch Sequence"}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              )}

              {/* ── Replies section ─────────────────────────────────────────── */}
              {isLaunched && (
                <div style={{ ...panel, padding: "12px 14px" }}>
                  <button
                    onClick={() => {
                      setShowReplies(!showReplies);
                      if (!showReplies && seq.id) loadReplies(seq.id);
                    }}
                    style={{ width: "100%", border: 0, background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", padding: 0 }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, color: palette.text, fontSize: 14 }}>
                      <MessageSquare size={14} color={palette.accent} />
                      Replies
                      {replies.length > 0 && (
                        <span style={{ background: palette.accent, color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 11, fontWeight: 800 }}>
                          {replies.length}
                        </span>
                      )}
                    </span>
                    {showReplies ? <ChevronUp size={14} color={palette.muted} /> : <ChevronDown size={14} color={palette.muted} />}
                  </button>

                  {showReplies && (
                    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                      {loadingReplies ? (
                        <div style={{ color: palette.muted, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                          <RefreshCw size={12} className="animate-spin" /> Loading replies...
                        </div>
                      ) : replies.length === 0 ? (
                        <div style={{ color: palette.muted, fontSize: 13, padding: "10px 0" }}>
                          No replies yet. Instantly will notify us when a reply comes in.
                        </div>
                      ) : (
                        replies.map((reply, i) => (
                          <div key={i} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${palette.greenBorder}`, background: palette.greenSoft }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                              <span style={{ fontWeight: 700, fontSize: 13, color: palette.text }}>
                                {reply.from_email ?? "Prospect"}
                              </span>
                              <span style={{ fontSize: 11, color: palette.muted }}>
                                {reply.created_at ? new Date(reply.created_at).toLocaleDateString() : reply.timestamp ?? ""}
                              </span>
                            </div>
                            {reply.subject && (
                              <div style={{ fontSize: 12, color: palette.sub, marginBottom: 4 }}>Re: {reply.subject}</div>
                            )}
                            {reply.body && (
                              <div style={{ fontSize: 13, color: palette.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                                {reply.body.slice(0, 500)}{reply.body.length > 500 ? "..." : ""}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// ── Step Timeline ─────────────────────────────────────────────────────────────

function StepTimeline({ seq }: { seq: OutreachSequence }) {
  const steps = [
    { label: "Initial email", day: "Day 0", body: seq.email_1 },
    { label: "Follow-up", day: "Day 3", body: seq.email_2 },
    { label: "Final touch", day: "Day 7", body: seq.email_3 },
  ];

  const isLaunched = !!seq.instantly_campaign_id;
  const isReplied = seq.status === "replied" || seq.status === "meeting_booked";

  return (
    <div style={{ ...panel, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: palette.muted, letterSpacing: 0.4, marginBottom: 10 }}>
        SEQUENCE STEPS
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {steps.map((step, i) => {
          const isReady = !!step.body;
          const isSent = isLaunched && !isReplied;
          const isDone = isReplied;

          return (
            <div key={i} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flex: 1 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 800,
                  background: isDone ? palette.greenSoft : isSent ? palette.accentSoft : isReady ? "#f0f4fa" : "#f5f5f5",
                  border: `2px solid ${isDone ? palette.greenBorder : isSent ? "#ffc8b4" : isReady ? "#c5d4e8" : "#e0e0e0"}`,
                  color: isDone ? palette.green : isSent ? palette.accent : isReady ? palette.sub : palette.muted,
                }}>
                  {isDone ? <CheckCircle size={13} /> : isSent ? <Send size={11} /> : <Clock size={11} />}
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: palette.text }}>{step.label}</div>
                  <div style={{ fontSize: 10, color: palette.muted }}>{step.day}</div>
                </div>
              </div>
              {i < steps.length - 1 && (
                <div style={{
                  height: 2, width: 24, flexShrink: 0, marginBottom: 20,
                  background: isSent || isDone ? palette.accent : palette.line,
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const style: CSSProperties =
    status === "launched"
      ? { color: palette.green, background: palette.greenSoft, border: `1px solid ${palette.greenBorder}` }
      : status === "replied" || status === "meeting_booked"
      ? { color: "#6b3fa0", background: "#f3eeff", border: "1px solid #d4b8f8" }
      : status === "approved" || status === "sent"
      ? { color: palette.blue, background: palette.blueSoft, border: `1px solid ${palette.blueBorder}` }
      : { color: "#546679", background: "#edf3f9", border: "1px solid #d7e1eb" };

  return (
    <span style={{ ...style, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>
      {status.replace("_", " ")}
    </span>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const panel: CSSProperties = {
  background: "#ffffff",
  border: `1px solid ${palette.line}`,
  borderRadius: 12,
  boxShadow: "0 2px 6px rgba(17, 34, 68, 0.05)",
};

const primaryBtn: CSSProperties = {
  border: 0, borderRadius: 10,
  background: palette.accent, color: "#fff",
  fontSize: 13, fontWeight: 700, cursor: "pointer",
  padding: "9px 12px", display: "inline-flex", alignItems: "center", gap: 7,
};

const ghostBtn: CSSProperties = {
  border: `1px solid ${palette.line}`, borderRadius: 10,
  background: "#fff", color: palette.sub,
  fontSize: 13, fontWeight: 700, cursor: "pointer",
  padding: "8px 10px", display: "inline-flex", alignItems: "center", gap: 7,
};

const copyBtn: CSSProperties = {
  border: `1px solid ${palette.line}`, borderRadius: 8,
  background: "#fff", color: palette.sub,
  fontSize: 12, fontWeight: 700, cursor: "pointer",
  padding: "6px 9px", display: "inline-flex", alignItems: "center", gap: 6,
};

const launchBtn: CSSProperties = {
  border: 0, borderRadius: 10,
  background: palette.accent, color: "#fff",
  fontSize: 13, fontWeight: 700, cursor: "pointer",
  padding: "9px 14px", display: "inline-flex", alignItems: "center", gap: 7,
  whiteSpace: "nowrap",
};
