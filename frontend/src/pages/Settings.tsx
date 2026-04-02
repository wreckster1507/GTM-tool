import { useEffect, useMemo, useState } from "react";
import { Mail, RefreshCw, Link2, Unplug, CheckCircle2, AlertTriangle, Shield } from "lucide-react";
import { settingsApi } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import type { GmailSyncSettings } from "../types";

function formatTimestamp(epoch?: number | null) {
  if (!epoch) return "Never";
  return new Date(epoch * 1000).toLocaleString();
}

function formatDate(value?: string | null) {
  if (!value) return "Not connected";
  return new Date(value).toLocaleString();
}

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [gmail, setGmail] = useState<GmailSyncSettings | null>(null);
  const [inbox, setInbox] = useState("zippy@beacon.li");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusTone = useMemo(() => {
    if (!gmail) return { bg: "#eef2ff", color: "#4b56c7", label: "Loading" };
    if (gmail.configured) return { bg: "#e8f8ee", color: "#217a49", label: "Connected" };
    if (gmail.inbox) return { bg: "#fff6df", color: "#a26a00", label: "Needs connect" };
    return { bg: "#f3f5fc", color: "#66748f", label: "Not set up" };
  }, [gmail]);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await settingsApi.getGmailSync();
      setGmail(data);
      setInbox(data.inbox || "zippy@beacon.li");
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
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const data = await settingsApi.updateGmailInbox(inbox.trim());
      setGmail(data);
      setMessage("Shared mailbox saved. Next step: connect Gmail once as an admin.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save inbox");
    } finally {
      setSaving(false);
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
      setMessage(result.status === "queued" ? "Sync queued. Beacon will pull new emails into deal activity shortly." : (result.message ?? "Sync request completed."));
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger sync");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="crm-page" style={{ maxWidth: 1080 }}>
      <section className="crm-panel" style={{ padding: 28, display: "grid", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="crm-chip" style={{ marginBottom: 12, background: "#eef2ff", color: "#4958d8", borderColor: "#d8def8" }}>
              <Mail size={14} />
              Email Sync
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: "#182042", marginBottom: 8 }}>Shared inbox tracking</h2>
            <p className="crm-muted" style={{ maxWidth: 700, lineHeight: 1.7 }}>
              Connect one shared mailbox once as an admin, then Beacon will keep pulling CC'd customer emails into deal activity automatically.
              Reps only need to CC <strong>{gmail?.inbox || "zippy@beacon.li"}</strong> on customer threads.
            </p>
          </div>
          <div style={{ padding: "10px 14px", borderRadius: 12, background: statusTone.bg, color: statusTone.color, fontWeight: 700, minWidth: 150, textAlign: "center" }}>
            {statusTone.label}
          </div>
        </div>

        {message && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, background: "#eaf8ef", border: "1px solid #cbe8d5", color: "#1f7a47" }}>
            <CheckCircle2 size={18} />
            <span>{message}</span>
          </div>
        )}

        {(error || gmail?.last_error) && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, background: "#fff4e6", border: "1px solid #f0d4ac", color: "#a46206" }}>
            <AlertTriangle size={18} />
            <span>{error || gmail?.last_error}</span>
          </div>
        )}

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
                  This is the mailbox reps will CC so Beacon can track customer email activity from the start.
                </p>
              </div>

              {isAdmin ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="crm-button soft" onClick={handleSaveInbox} disabled={saving}>
                    {saving ? <RefreshCw size={15} className="animate-spin" /> : <Shield size={15} />}
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
      </section>

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
              body: "Customer emails stay in normal rep workflows. The only habit change is CC'ing the shared mailbox on external threads.",
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
    </div>
  );
}
