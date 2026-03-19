import { useEffect, useState, type CSSProperties } from "react";
import { outreachApi, sendApi } from "../../lib/api";
import type { Contact, OutreachSequence } from "../../types";
import { X, Sparkles, Copy, CheckCheck, Linkedin, Mail, RefreshCw, Send } from "lucide-react";
import { cn, avatarColor, getInitials } from "../../lib/utils";

interface Props {
  contact: Contact | null;
  onClose: () => void;
}

type TabKey = "email_1" | "email_2" | "email_3" | "linkedin";

const TABS: { key: TabKey; label: string }[] = [
  { key: "email_1",  label: "Email 1" },
  { key: "email_2",  label: "Follow-up" },
  { key: "email_3",  label: "Final" },
  { key: "linkedin", label: "LinkedIn" },
];

const PERSONA_LABEL: Record<string, string> = {
  economic_buyer:      "Economic Buyer",
  champion:            "Champion",
  technical_evaluator: "Technical Eval",
  unknown:             "Unknown",
};

const PERSONA_STYLE: Record<string, CSSProperties> = {
  economic_buyer: { color: "#7b3a1d", background: "#ffe8de", border: "1px solid #ffc8b4" },
  champion: { color: "#1b6f53", background: "#e4fbf3", border: "1px solid #b8efd8" },
  technical_evaluator: { color: "#24567e", background: "#eaf4ff", border: "1px solid #c9e0f8" },
  unknown: { color: "#546679", background: "#edf3f9", border: "1px solid #d7e1eb" },
};

export default function OutreachDrawer({ contact, onClose }: Props) {
  const [seq, setSeq] = useState<OutreachSequence | null>(null);
  const [tab, setTab] = useState<TabKey>("email_1");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState("");
  const [error, setError] = useState("");

  const isOpen = !!contact;

  const handleSend = async () => {
    if (!seq || !contact) return;
    const emailNum = tab === "email_1" ? 1 : tab === "email_2" ? 2 : 3;
    setSending(true);
    setSendResult("");
    try {
      const result = await sendApi.sendEmail(seq.id, emailNum as 1 | 2 | 3, contact.email);
      setSendResult(
        result.status === "sent"
          ? `Sent to ${result.to}`
          : `Queued (mock) — add RESEND_API_KEY to send for real`
      );
      setTimeout(() => setSendResult(""), 5000);
    } catch (e: unknown) {
      setSendResult(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!contact) {
      setSeq(null);
      setError("");
      setSendResult("");
      return;
    }
    setLoading(true);
    setTab("email_1");
    outreachApi
      .getSequence(contact.id)
      .then((s) => { setSeq(s); setError(""); })
      .catch(() => { setSeq(null); setError(""); })
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

  const getSubject = (): string | null => {
    if (!seq) return null;
    if (tab === "email_1") return seq.subject_1 ?? null;
    if (tab === "email_2") return seq.subject_2 ?? null;
    if (tab === "email_3") return seq.subject_3 ?? null;
    return null;
  };

  const getBody = (): string => {
    if (!seq) return "";
    let text = "";
    if (tab === "email_1") text = seq.email_1 ?? "";
    else if (tab === "email_2") text = seq.email_2 ?? "";
    else if (tab === "email_3") text = seq.email_3 ?? "";
    else if (tab === "linkedin") text = seq.linkedin_message ?? "";
    return text.replace(/^Subject:.*\n\n?/i, "").trim();
  };

  const handleCopy = async () => {
    const subject = getSubject();
    const body = getBody();
    const full = subject ? `Subject: ${subject}\n\n${body}` : body;
    if (!full) return;
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px] transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      <div
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-160 max-w-full bg-white border-l border-[#dfe7f1]",
          "flex flex-col shadow-2xl transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-start justify-between px-8 py-6 border-b border-[#e4ebf3] shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            {contact && (
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${avatarColor(contact.first_name + contact.last_name)}`}>
                {getInitials(`${contact.first_name} ${contact.last_name}`)}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[18px] font-bold text-[#25384d] truncate">
                  {contact ? `${contact.first_name} ${contact.last_name}` : "Outreach"}
                </h2>
                {contact?.persona && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold" style={PERSONA_STYLE[contact.persona] ?? PERSONA_STYLE.unknown}>
                    {PERSONA_LABEL[contact.persona] ?? contact.persona}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-[#7890a7] truncate mt-1">
                {contact?.title ?? ""}
                {contact?.email ? ` · ${contact.email}` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 ml-3 mt-0.5 text-[#7a8ea4] hover:text-[#334a61] transition-colors"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-[#7a8ea4] text-[13px]">Loading...</div>
          ) : !seq ? (
            <div className="flex flex-col items-center justify-center h-52 gap-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#fff0e9]">
                <Mail className="h-6 w-6 text-[#ff6b35]" />
              </div>
              <p className="text-[14px] text-[#647a91] text-center leading-relaxed">
                No outreach sequence yet.<br />Generate one with GPT-4o.
              </p>
              <button className="crm-button primary" onClick={handleGenerate} disabled={generating}>
                {generating ? (
                  <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />Generating...</>
                ) : (
                  <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Generate Sequence</>
                )}
              </button>
              {error && <p className="text-[12px] text-red-500">{error}</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold capitalize"
                    style={seq.status === "approved" ? { color: "#1b6f53", background: "#e4fbf3", border: "1px solid #b8efd8" } : seq.status === "sent" ? { color: "#24567e", background: "#eaf4ff", border: "1px solid #c9e0f8" } : { color: "#546679", background: "#edf3f9", border: "1px solid #d7e1eb" }}
                  >
                    {seq.status}
                  </span>
                  {seq.generated_at && (
                    <span className="text-[12px] text-[#7a8ea4]">
                      {new Date(seq.generated_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="flex items-center gap-1 text-[13px] text-[#6f8399] hover:text-[#ff6b35] transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3 w-3", generating && "animate-spin")} />
                  Regenerate
                </button>
              </div>

              <div className="flex gap-1.5 bg-[#edf3f9] rounded-xl p-1.5">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "flex items-center gap-1.5 flex-1 justify-center rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150",
                      tab === t.key
                        ? "bg-white text-[#26394e] shadow-sm"
                        : "text-[#5f748b] hover:text-[#2e455b]"
                    )}
                  >
                    {t.key === "linkedin" ? (
                      <Linkedin className="h-3 w-3" />
                    ) : (
                      <Mail className="h-3 w-3" />
                    )}
                    {t.label}
                  </button>
                ))}
              </div>

              {tab !== "linkedin" && getSubject() && (
                <div className="rounded-xl bg-[#f8fbff] border border-[#dde7f2] px-4 py-3">
                  <p className="text-[10px] font-semibold text-[#7d8fa3] uppercase tracking-wider mb-0.5">Subject</p>
                  <p className="text-[14px] font-semibold text-[#2e4358]">{getSubject()}</p>
                </div>
              )}

              <div className="relative rounded-xl border border-[#dde7f2] bg-[#f9fbff] p-6">
                <pre className="whitespace-pre-wrap text-[14px] text-[#2e4358] font-sans leading-relaxed">
                  {getBody() || (
                    <span className="text-[#8da0b5] italic">No content for this touch.</span>
                  )}
                </pre>
                {getBody() && (
                  <button
                    onClick={handleCopy}
                    className="absolute top-4 right-4 flex items-center gap-1 rounded-md bg-white border border-[#dce6f0] px-2.5 py-1 text-[11px] text-[#5f748b] hover:text-[#2a3f56] shadow-sm transition-colors"
                  >
                    {copied ? (
                      <><CheckCheck className="h-3 w-3 text-emerald-500" />Copied</>
                    ) : (
                      <><Copy className="h-3 w-3" />Copy</>
                    )}
                  </button>
                )}
              </div>

              {tab === "linkedin" && contact?.linkedin_url && (
                <a
                  href={contact.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[13px] text-[#ff6b35] hover:text-[#df5a2b] transition-colors"
                >
                  <Linkedin className="h-3.5 w-3.5" />
                  Open LinkedIn profile
                </a>
              )}

              {tab !== "linkedin" && (
                <div className="flex items-center justify-between rounded-xl bg-[#f8fbff] border border-[#dde7f2] px-4 py-3">
                  <p className="text-[12px] text-[#6f8399]">
                    {tab === "email_1" && "Day 1 — initial cold outreach"}
                    {tab === "email_2" && "Day 3 — follow-up with new insight"}
                    {tab === "email_3" && "Day 7 — final touch / soft CTA"}
                  </p>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    {sendResult && <span className="text-[12px] text-[#ff6b35]">{sendResult}</span>}
                    {contact?.email && (
                      <button
                        onClick={handleSend}
                        disabled={sending || !getBody()}
                        className="flex items-center gap-1 rounded-md bg-[#ff6b35] hover:bg-[#e75822] disabled:opacity-50 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors shadow-sm"
                      >
                        {sending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        Send
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
