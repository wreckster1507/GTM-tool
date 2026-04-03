import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Mail,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  Unplug,
  Wand2,
} from "lucide-react";
import { settingsApi } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import type { GmailSyncSettings, OutreachContentSettings, OutreachTemplateStep } from "../types";

type SettingsTab = "email-sync" | "outreach-ai";

function formatTimestamp(epoch?: number | null) {
  if (!epoch) return "Never";
  return new Date(epoch * 1000).toLocaleString();
}

function formatDate(value?: string | null) {
  if (!value) return "Not connected";
  return new Date(value).toLocaleString();
}

function buildCcPattern(inbox?: string | null) {
  if (!inbox || !inbox.includes("@")) return "zippy+deal-name@beacon.li";
  const [local, domain] = inbox.split("@");
  return `${local}+deal-name@${domain}`;
}

function createTemplate(stepNumber: number): OutreachTemplateStep {
  return {
    step_number: stepNumber,
    label: `Step ${stepNumber}`,
    goal: "",
    subject_hint: "",
    body_template: "",
    prompt_hint: "",
  };
}

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>("email-sync");
  const [gmail, setGmail] = useState<GmailSyncSettings | null>(null);
  const [inbox, setInbox] = useState("zippy@beacon.li");
  const [outreachContent, setOutreachContent] = useState<OutreachContentSettings | null>(null);
  const [outreachStepDelays, setOutreachStepDelays] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingInbox, setSavingInbox] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savingOutreach, setSavingOutreach] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusTone = useMemo(() => {
    if (!gmail) return { bg: "#eef2ff", color: "#4b56c7", label: "Loading" };
    if (gmail.configured) return { bg: "#e8f8ee", color: "#217a49", label: "Connected" };
    if (gmail.inbox) return { bg: "#fff6df", color: "#a26a00", label: "Needs connect" };
    return { bg: "#f3f5fc", color: "#66748f", label: "Not set up" };
  }, [gmail]);

  const ccPattern = useMemo(() => buildCcPattern(gmail?.inbox || inbox), [gmail?.inbox, inbox]);
  const extraTemplateCount = Math.max((outreachContent?.step_templates.length ?? 0) - outreachStepDelays.length, 0);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const [gmailData, outreachContentData, outreachTiming] = await Promise.all([
        settingsApi.getGmailSync(),
        settingsApi.getOutreachContent(),
        settingsApi.getOutreach(),
      ]);
      setGmail(gmailData);
      setInbox(gmailData.inbox || "zippy@beacon.li");
      setOutreachContent(outreachContentData);
      setOutreachStepDelays(outreachTiming.step_delays);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    if (gmailStatus === "connected") {
      setMessage("Gmail connected successfully. Beacon will keep syncing zippy@beacon.li automatically from here.");
      loadSettings();
    } else if (gmailStatus === "error") {
      setError("Gmail connection failed. Please try again.");
    }
    if (gmailStatus) {
      params.delete("gmail");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

  const handleSaveInbox = async () => {
    setSavingInbox(true);
    setError(null);
    setMessage(null);
    try {
      const data = await settingsApi.updateGmailInbox(inbox.trim());
      setGmail(data);
      setMessage("Shared mailbox saved. Next step: connect Gmail once as an admin.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save inbox");
    } finally {
      setSavingInbox(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    setMessage(null);
    try {
      if (!gmail?.inbox || gmail.inbox !== inbox.trim()) {
        await settingsApi.updateGmailInbox(inbox.trim());
      }
      const result = await settingsApi.getGmailConnectUrl();
      window.location.assign(result.url);
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : "Failed to start Gmail connect");
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    setMessage(null);
    try {
      await settingsApi.disconnectGmail();
      await loadSettings();
      setMessage("Gmail disconnected. Sync is paused until an admin reconnects it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Gmail");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await settingsApi.triggerEmailSync();
      setMessage(
        result.status === "queued"
          ? "Sync queued. Beacon will pull new emails into deal activity shortly."
          : (result.message ?? "Sync request completed."),
      );
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger sync");
    } finally {
      setSyncing(false);
    }
  };

  const updateOutreachField = (field: keyof OutreachContentSettings, value: string) => {
    setOutreachContent((current) => {
      if (!current) return current;
      return { ...current, [field]: value };
    });
  };

  const updateTemplate = (index: number, field: keyof OutreachTemplateStep, value: string) => {
    setOutreachContent((current) => {
      if (!current) return current;
      const nextTemplates = current.step_templates.map((template, templateIndex) =>
        templateIndex === index ? { ...template, [field]: value } : template,
      );
      return { ...current, step_templates: nextTemplates };
    });
  };

  const handleAddTemplate = () => {
    setOutreachContent((current) => {
      if (!current) return current;
      return {
        ...current,
        step_templates: [...current.step_templates, createTemplate(current.step_templates.length + 1)],
      };
    });
  };

  const handleRemoveTemplate = (index: number) => {
    setOutreachContent((current) => {
      if (!current || current.step_templates.length <= 1) return current;
      const nextTemplates = current.step_templates
        .filter((_, templateIndex) => templateIndex !== index)
        .map((template, templateIndex) => ({
          ...template,
          step_number: templateIndex + 1,
          label: template.label?.trim() ? template.label : `Step ${templateIndex + 1}`,
        }));
      return { ...current, step_templates: nextTemplates };
    });
  };

  const handleSaveOutreach = async () => {
    if (!outreachContent) return;
    setSavingOutreach(true);
    setError(null);
    setMessage(null);
    try {
      const payload: OutreachContentSettings = {
        general_prompt: outreachContent.general_prompt.trim(),
        linkedin_prompt: outreachContent.linkedin_prompt.trim(),
        step_templates: outreachContent.step_templates.map((template, index) => ({
          step_number: index + 1,
          label: template.label.trim() || `Step ${index + 1}`,
          goal: template.goal.trim(),
          subject_hint: template.subject_hint?.trim() || null,
          body_template: template.body_template?.trim() || null,
          prompt_hint: template.prompt_hint?.trim() || null,
        })),
      };
      const saved = await settingsApi.updateOutreachContent(payload);
      setOutreachContent(saved);
      setMessage("Outreach AI settings saved. New outreach generation will use this shared playbook.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save outreach settings");
    } finally {
      setSavingOutreach(false);
    }
  };

  const tabButton = (id: SettingsTab, label: string, icon: ReactNode) => (
    <button
      key={id}
      type="button"
      onClick={() => setActiveTab(id)}
      className={`crm-button ${activeTab === id ? "primary" : "soft"}`}
      style={{ minWidth: 180, justifyContent: "center" }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="crm-page" style={{ maxWidth: 1160, display: "grid", gap: 20 }}>
      <section className="crm-panel" style={{ padding: 28, display: "grid", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: "#182042", marginBottom: 8 }}>Workspace settings</h2>
            <p className="crm-muted" style={{ maxWidth: 760, lineHeight: 1.7 }}>
              Keep shared workflows centralized here. Gmail sync controls how Beacon captures customer emails automatically,
              and Outreach AI controls the playbook Beacon follows when it generates new sequences.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {tabButton("email-sync", "Email Sync", <Mail size={15} />)}
            {tabButton("outreach-ai", "Outreach AI", <Sparkles size={15} />)}
          </div>
        </div>

        {message && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, background: "#eaf8ef", border: "1px solid #cbe8d5", color: "#1f7a47" }}>
            <CheckCircle2 size={18} />
            <span>{message}</span>
          </div>
        )}

        {(error || gmail?.last_error) && activeTab === "email-sync" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, background: "#fff4e6", border: "1px solid #f0d4ac", color: "#a46206" }}>
            <AlertTriangle size={18} />
            <span>{error || gmail?.last_error}</span>
          </div>
        )}

        {error && activeTab === "outreach-ai" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, background: "#fff4e6", border: "1px solid #f0d4ac", color: "#a46206" }}>
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        {activeTab === "email-sync" ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div className="crm-chip" style={{ marginBottom: 12, background: "#eef2ff", color: "#4958d8", borderColor: "#d8def8" }}>
                  <Mail size={14} />
                  Email Sync
                </div>
                <h3 style={{ fontSize: 24, fontWeight: 800, color: "#182042", marginBottom: 8 }}>Shared inbox tracking</h3>
                <p className="crm-muted" style={{ maxWidth: 700, lineHeight: 1.7 }}>
                  Connect one shared mailbox once as an admin, then Beacon will keep pulling CC'd customer emails into deal activity automatically.
                  Reps should CC <strong>{ccPattern}</strong> on customer threads so Beacon can map the email straight to the right deal.
                </p>
              </div>
              <div style={{ padding: "10px 14px", borderRadius: 12, background: statusTone.bg, color: statusTone.color, fontWeight: 700, minWidth: 150, textAlign: "center" }}>
                {statusTone.label}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(320px, 0.75fr)", gap: 18 }}>
              <div className="crm-panel" style={{ padding: 22, borderRadius: 14, boxShadow: "none" }}>
                <div style={{ display: "grid", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7c86a6", fontWeight: 700, marginBottom: 8 }}>
                      Shared mailbox
                    </div>
                    <input
                      value={inbox}
                      onChange={(event) => setInbox(event.target.value)}
                      placeholder="zippy@beacon.li"
                      style={{ width: "100%", height: 48, padding: "0 14px", fontSize: 14 }}
                      disabled={!isAdmin}
                    />
                    <p className="crm-muted" style={{ marginTop: 8, fontSize: 13 }}>
                      This is the base mailbox Beacon watches. Reps should CC aliases like <strong>{ccPattern}</strong>.
                    </p>
                  </div>

                  {isAdmin ? (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button className="crm-button soft" onClick={handleSaveInbox} disabled={savingInbox}>
                        {savingInbox ? <RefreshCw size={15} className="animate-spin" /> : <Shield size={15} />}
                        Save inbox
                      </button>
                      <button className="crm-button primary" onClick={handleConnect} disabled={connecting}>
                        {connecting ? <RefreshCw size={15} className="animate-spin" /> : <Link2 size={15} />}
                        Connect Gmail
                      </button>
                      <button className="crm-button soft" onClick={handleDisconnect} disabled={disconnecting || !gmail?.configured}>
                        {disconnecting ? <RefreshCw size={15} className="animate-spin" /> : <Unplug size={15} />}
                        Disconnect
                      </button>
                      <button className="crm-button soft" onClick={handleSyncNow} disabled={syncing || !gmail?.configured}>
                        {syncing ? <RefreshCw size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                        Sync now
                      </button>
                    </div>
                  ) : (
                    <p className="crm-muted" style={{ fontSize: 13 }}>
                      Only admins can change the inbox connection. Everyone can view sync status here.
                    </p>
                  )}
                </div>
              </div>

              <div className="crm-panel" style={{ padding: 22, borderRadius: 14, boxShadow: "none", display: "grid", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7c86a6", fontWeight: 700, marginBottom: 6 }}>
                    Connection status
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#182042" }}>
                    {loading ? "Loading..." : (gmail?.configured ? "Auto-sync active" : "Needs setup")}
                  </div>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span className="crm-muted">Connected mailbox</span>
                    <strong style={{ color: "#182042" }}>{gmail?.connected_email || "Not connected"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span className="crm-muted">Connected at</span>
                    <strong style={{ color: "#182042" }}>{formatDate(gmail?.connected_at)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span className="crm-muted">Last sync</span>
                    <strong style={{ color: "#182042" }}>{formatTimestamp(gmail?.last_sync_epoch)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span className="crm-muted">Polling interval</span>
                    <strong style={{ color: "#182042" }}>{gmail ? `${Math.round(gmail.interval_seconds / 60)} min` : "--"}</strong>
                  </div>
                </div>
              </div>
            </div>

            <section className="crm-panel" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: "#182042", marginBottom: 14 }}>How it works</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
                {[
                  {
                    title: "1. Admin connects once",
                    body: "Connect zippy@beacon.li through Google OAuth. Beacon stores the refresh token and keeps the connection alive.",
                  },
                  {
                    title: "2. Reps CC the shared inbox",
                    body: `Customer emails stay in normal rep workflows. The only habit change is CC'ing an alias like ${ccPattern} so Beacon can map the thread to the right deal.`,
                  },
                  {
                    title: "3. Beacon logs activity automatically",
                    body: "Synced emails land in deal activity with AI summaries, so the CRM stays current without reps rewriting notes.",
                  },
                ].map((item) => (
                  <div key={item.title} style={{ border: "1px solid #e7eaf5", borderRadius: 14, padding: 18, background: "#fff" }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#182042", marginBottom: 8 }}>{item.title}</div>
                    <p className="crm-muted" style={{ fontSize: 14, lineHeight: 1.7 }}>{item.body}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div className="crm-chip" style={{ marginBottom: 12, background: "#f5efff", color: "#6f46d9", borderColor: "#e4d8ff" }}>
                  <Wand2 size={14} />
                  Outreach AI
                </div>
                <h3 style={{ fontSize: 24, fontWeight: 800, color: "#182042", marginBottom: 8 }}>Shared outreach playbook</h3>
                <p className="crm-muted" style={{ maxWidth: 760, lineHeight: 1.7 }}>
                  This is the shared writing system Beacon uses when it generates outreach. Sequence timing controls <strong>when</strong> each touch
                  goes out, and these prompts plus templates control <strong>how</strong> each touch sounds.
                </p>
              </div>
              <div className="crm-panel" style={{ padding: 18, borderRadius: 14, boxShadow: "none", minWidth: 320 }}>
                <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7c86a6", fontWeight: 700, marginBottom: 10 }}>
                  Current sequence timing
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  {outreachStepDelays.map((delay, index) => (
                    <span key={`${delay}-${index}`} className="crm-chip" style={{ background: "#eef2ff", color: "#4958d8", borderColor: "#d8def8" }}>
                      Step {index + 1}: Day {delay}
                    </span>
                  ))}
                </div>
                <p className="crm-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                  Need to change day gaps? Use the existing sequence timing controls. This tab only shapes the copy and prompting.
                </p>
              </div>
            </div>

            <div style={{ display: "grid", gap: 18 }}>
              <div className="crm-panel" style={{ padding: 22, borderRadius: 14, boxShadow: "none", display: "grid", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7c86a6", fontWeight: 700, marginBottom: 8 }}>
                    General AI prompt
                  </div>
                  <textarea
                    value={outreachContent?.general_prompt ?? ""}
                    onChange={(event) => updateOutreachField("general_prompt", event.target.value)}
                    disabled={!isAdmin || !outreachContent}
                    rows={5}
                    placeholder="Tell Beacon the shared writing rules, tone, and constraints to follow across all emails."
                    style={{ width: "100%", resize: "vertical", minHeight: 120 }}
                  />
                  <p className="crm-muted" style={{ marginTop: 8, fontSize: 13 }}>
                    Use this for shared rules like tone, CTA style, banned phrasing, compliance guardrails, or how personalized you want the emails to feel.
                  </p>
                </div>

                <div>
                  <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7c86a6", fontWeight: 700, marginBottom: 8 }}>
                    LinkedIn prompt
                  </div>
                  <textarea
                    value={outreachContent?.linkedin_prompt ?? ""}
                    onChange={(event) => updateOutreachField("linkedin_prompt", event.target.value)}
                    disabled={!isAdmin || !outreachContent}
                    rows={3}
                    placeholder="Guide how Beacon should write LinkedIn connection notes."
                    style={{ width: "100%", resize: "vertical", minHeight: 90 }}
                  />
                </div>
              </div>

              <div className="crm-panel" style={{ padding: 22, borderRadius: 14, boxShadow: "none", display: "grid", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#182042", marginBottom: 6 }}>Touch templates</div>
                    <p className="crm-muted" style={{ maxWidth: 760, lineHeight: 1.7 }}>
                      Each touch has a goal, optional subject hint, writing cue, and reference template. Beacon will adapt these to the actual contact instead of copying them verbatim.
                    </p>
                  </div>
                  {isAdmin && (
                    <button className="crm-button soft" type="button" onClick={handleAddTemplate} disabled={!outreachContent || outreachContent.step_templates.length >= 10}>
                      <Plus size={15} />
                      Add step template
                    </button>
                  )}
                </div>

                {extraTemplateCount > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, background: "#fff8ea", border: "1px solid #f3ddb0", color: "#a26a00" }}>
                    <AlertTriangle size={18} />
                    <span>
                      You have {extraTemplateCount} template{extraTemplateCount === 1 ? "" : "s"} beyond the current sequence timing. Beacon will only use them after you add more touches in timing settings.
                    </span>
                  </div>
                )}

                <div style={{ display: "grid", gap: 14 }}>
                  {(outreachContent?.step_templates ?? []).map((template, index) => (
                    <div key={template.step_number} className="crm-panel" style={{ padding: 18, borderRadius: 14, boxShadow: "none", display: "grid", gap: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span className="crm-chip" style={{ background: "#eef2ff", color: "#4958d8", borderColor: "#d8def8" }}>
                            Step {index + 1}
                          </span>
                          {outreachStepDelays[index] !== undefined && (
                            <span className="crm-chip" style={{ background: "#f7f8fc", color: "#5b6685", borderColor: "#e7eaf5" }}>
                              Sends on Day {outreachStepDelays[index]}
                            </span>
                          )}
                        </div>
                        {isAdmin && (
                          <button className="crm-button soft" type="button" onClick={() => handleRemoveTemplate(index)} disabled={(outreachContent?.step_templates.length ?? 0) <= 1}>
                            <Trash2 size={15} />
                            Remove
                          </button>
                        )}
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 0.55fr) minmax(0, 1fr)", gap: 14 }}>
                        <div>
                          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7c86a6", fontWeight: 700, marginBottom: 8 }}>
                            Template label
                          </div>
                          <input
                            value={template.label}
                            onChange={(event) => updateTemplate(index, "label", event.target.value)}
                            disabled={!isAdmin}
                            placeholder="Initial email"
                            style={{ width: "100%", height: 44, padding: "0 14px", fontSize: 14 }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7c86a6", fontWeight: 700, marginBottom: 8 }}>
                            Goal
                          </div>
                          <input
                            value={template.goal}
                            onChange={(event) => updateTemplate(index, "goal", event.target.value)}
                            disabled={!isAdmin}
                            placeholder="What should this touch accomplish?"
                            style={{ width: "100%", height: 44, padding: "0 14px", fontSize: 14 }}
                          />
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.95fr) minmax(0, 1.05fr)", gap: 14 }}>
                        <div>
                          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7c86a6", fontWeight: 700, marginBottom: 8 }}>
                            Subject hint
                          </div>
                          <input
                            value={template.subject_hint ?? ""}
                            onChange={(event) => updateTemplate(index, "subject_hint", event.target.value)}
                            disabled={!isAdmin}
                            placeholder="Quick question about {{company_name}}"
                            style={{ width: "100%", height: 44, padding: "0 14px", fontSize: 14 }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7c86a6", fontWeight: 700, marginBottom: 8 }}>
                            Prompt hint
                          </div>
                          <input
                            value={template.prompt_hint ?? ""}
                            onChange={(event) => updateTemplate(index, "prompt_hint", event.target.value)}
                            disabled={!isAdmin}
                            placeholder="Tell Beacon how this touch should feel."
                            style={{ width: "100%", height: 44, padding: "0 14px", fontSize: 14 }}
                          />
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7c86a6", fontWeight: 700, marginBottom: 8 }}>
                          Reference template
                        </div>
                        <textarea
                          value={template.body_template ?? ""}
                          onChange={(event) => updateTemplate(index, "body_template", event.target.value)}
                          disabled={!isAdmin}
                          rows={6}
                          placeholder="Use placeholders like {{first_name}} and {{company_name}} if you want to give Beacon a reusable pattern."
                          style={{ width: "100%", resize: "vertical", minHeight: 150 }}
                        />
                        <p className="crm-muted" style={{ marginTop: 8, fontSize: 13 }}>
                          Supported placeholders include <strong>{"{{first_name}}"}</strong> and <strong>{"{{company_name}}"}</strong>. Beacon treats this as a reference pattern, not a hard-coded script.
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {isAdmin ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <p className="crm-muted" style={{ fontSize: 13 }}>
                      These settings apply to new outreach generation and regeneration. Existing launched sequences keep their current copy.
                    </p>
                    <button className="crm-button primary" type="button" onClick={handleSaveOutreach} disabled={savingOutreach || !outreachContent}>
                      {savingOutreach ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
                      Save outreach settings
                    </button>
                  </div>
                ) : (
                  <p className="crm-muted" style={{ fontSize: 13 }}>
                    Only admins can change the shared outreach playbook. Everyone can review it here to understand how Beacon is generating outreach.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
