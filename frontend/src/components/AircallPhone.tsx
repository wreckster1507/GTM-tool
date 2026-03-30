/**
 * AircallPhone — persistent floating phone panel powered by Aircall Everywhere SDK.
 *
 * Mount once at the app root. Exposes window.__aircallDial(phoneNumber) so any
 * component can trigger a call without prop drilling.
 *
 * The panel slides in from the top-right when a call is triggered or when
 * the rep manually opens it. It can be minimised to a small tab.
 */
import { useEffect, useRef, useState } from "react";
import { Phone, X, Minus, PhoneCall, PhoneOff, PhoneMissed } from "lucide-react";
import AircallPhone from "aircall-everywhere";

// Extend window type for the global dial trigger
declare global {
  interface Window {
    __aircallDial?: (phoneNumber: string, contactName?: string) => void;
    __aircallOpen?: () => void;
  }
}

interface CallState {
  active: boolean;
  contactName?: string;
  phoneNumber?: string;
  duration: number;       // seconds elapsed
  status: "idle" | "ringing" | "answered" | "ended";
}

export default function AircallPhonePanel() {
  const panelTop = 118;
  const [open, setOpen] = useState(false);
  const [minimised, setMinimised] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [callState, setCallState] = useState<CallState>({
    active: false,
    duration: 0,
    status: "idle",
  });

  const phoneRef = useRef<AircallPhone | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Init SDK once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phoneRef.current) return; // already initialised

    const phone = new AircallPhone({
      domToLoadWorkspace: "#aircall-workspace",
      onLogin: () => {
        setSdkReady(true);
        console.log("[Aircall] Agent logged in");
      },
      onLogout: () => {
        setSdkReady(false);
        console.log("[Aircall] Agent logged out");
      },
      size: "big",
      debug: false,
    });

    // ── Call lifecycle events ────────────────────────────────────────────────
    phone.on("incoming_call", (info: any) => {
      setCallState({
        active: true,
        phoneNumber: info.from,
        contactName: info.contact?.name,
        duration: 0,
        status: "ringing",
      });
      setOpen(true);
      setMinimised(false);
    });

    phone.on("outgoing_call", (info: any) => {
      setCallState(prev => ({
        ...prev,
        active: true,
        phoneNumber: info.to,
        duration: 0,
        status: "ringing",
      }));
    });

    phone.on("outgoing_answered", () => {
      setCallState(prev => ({ ...prev, status: "answered" }));
      // Start duration timer
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setCallState(prev => ({ ...prev, duration: prev.duration + 1 }));
      }, 1000);
    });

    phone.on("call_end_ringtone", ({ answer_status }: any) => {
      if (answer_status === "no_answer" || answer_status === "busy") {
        setCallState(prev => ({ ...prev, status: "ended", active: false }));
        if (timerRef.current) clearInterval(timerRef.current);
      }
    });

    phone.on("call_ended", ({ duration }: any) => {
      if (timerRef.current) clearInterval(timerRef.current);
      setCallState(prev => ({
        ...prev,
        active: false,
        duration: duration || prev.duration,
        status: "ended",
      }));
      // Auto-collapse after 3 seconds
      setTimeout(() => {
        setCallState({ active: false, duration: 0, status: "idle" });
        setMinimised(true);
      }, 3000);
    });

    phoneRef.current = phone;
  }, []);

  // ── Global dial trigger — called from any component ────────────────────────
  useEffect(() => {
    window.__aircallDial = (phoneNumber: string, contactName?: string) => {
      setOpen(true);
      setMinimised(false);
      setCallState(prev => ({ ...prev, phoneNumber, contactName, status: "ringing" }));

      // Wait for panel to be visible, then send dial command
      setTimeout(() => {
        if (phoneRef.current) {
          phoneRef.current.send(
            "dial_number",
            { phone_number: phoneNumber },
            (success: boolean) => {
              if (!success) console.warn("[Aircall] dial_number command failed");
            }
          );
        }
      }, 300);
    };

    window.__aircallOpen = () => {
      setOpen(true);
      setMinimised(false);
    };

    return () => {
      delete window.__aircallDial;
      delete window.__aircallOpen;
    };
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const statusColor = {
    idle: "#94a3b8",
    ringing: "#f59e0b",
    answered: "#16a34a",
    ended: "#64748b",
  }[callState.status];

  const statusLabel = callState.active
    ? callState.status === "answered"
      ? formatDuration(callState.duration)
      : callState.status === "ringing"
        ? "Ringing..."
        : "Call ended"
    : sdkReady
      ? "Ready for calls"
      : "Loading workspace...";

  return (
    <>
      {/* ── Aircall workspace div — ALWAYS in DOM (hidden offscreen when closed) ── */}
      {/* The SDK needs this element to exist at init time to mount the iframe */}
      <div
        id="aircall-workspace"
        style={{
          position: "fixed",
          bottom: -9999, left: -9999,
          width: 0, height: 0,
          overflow: "hidden",
          // This div is just for SDK initialization. The actual iframe gets
          // moved into view via the panel below once the SDK creates it.
        }}
      />

      {/* ── Floating trigger button (visible when panel is closed) ── */}
      {!open && (
        <button
          onClick={() => { setOpen(true); setMinimised(false); }}
          style={{
            position: "fixed", top: panelTop, right: 24, zIndex: 900,
            width: 194,
            borderRadius: 20,
            border: "1px solid #d9e6f2",
            background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(243,248,255,0.98) 100%)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            boxShadow: "0 16px 36px rgba(15,39,68,0.10)",
            transition: "all 0.2s ease",
            textAlign: "left",
            backdropFilter: "blur(12px)",
          }}
          title="Open Aircall phone"
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: 14,
              background: callState.active
                ? "linear-gradient(135deg, #0f7b4b, #16a34a)"
                : "linear-gradient(135deg, #0f2744, #175089)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
          >
            {callState.status === "ended"
              ? <PhoneMissed size={16} color="#ffffff" />
              : callState.active
                ? <PhoneCall size={16} color="#ffffff" />
                : <Phone size={16} color="#ffffff" />
            }
          </span>
          <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
            <span style={{ color: "#18324b", fontSize: 13, fontWeight: 800, lineHeight: 1.1 }}>
              Aircall
            </span>
            <span style={{ color: "#6a7f96", fontSize: 11.5, fontWeight: 600, lineHeight: 1.2 }}>
              {statusLabel}
            </span>
          </span>
          {callState.active && (
            <span style={{
              position: "absolute", top: 10, right: 10,
              width: 10, height: 10, borderRadius: "50%",
              background: "#ef4444", border: "2px solid #ffffff",
              animation: "pulse 1.5s infinite",
            }} />
          )}
        </button>
      )}

      {/* ── Phone panel ── */}
      {open && (
        <div style={{
          position: "fixed", top: panelTop, right: 24, zIndex: 950,
          width: minimised ? 244 : 392,
          maxWidth: "calc(100vw - 36px)",
          borderRadius: 24,
          background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(247,251,255,0.98) 100%)",
          border: "1px solid #d8e4ef",
          boxShadow: "0 24px 54px rgba(14,38,66,0.14)",
          overflow: "hidden",
          transition: "width 0.2s ease, transform 0.2s ease",
          display: "flex", flexDirection: "column",
          backdropFilter: "blur(14px)",
        }}>
          {/* Header — z-index ensures it stays clickable above iframe */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 16px",
            background: "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(240,246,255,0.92) 100%)",
            color: "#18324b",
            position: "relative",
            zIndex: 2,
            flexShrink: 0,
            borderBottom: "1px solid #e3edf6",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 14,
                background: callState.active
                  ? "linear-gradient(135deg, #e8f8f0, #d8f2e5)"
                  : "linear-gradient(135deg, #eef5ff, #e6f0fb)",
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "1px solid #d8e5f2",
              }}>
                {callState.status === "answered"
                  ? <PhoneCall size={15} color="#1f8f5f" />
                  : callState.status === "ended"
                    ? <PhoneOff size={15} color="#7b8ea3" />
                    : <Phone size={15} color="#175089" />
                }
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800 }}>
                  {callState.active
                    ? callState.contactName || callState.phoneNumber || "Calling…"
                    : "Aircall Phone"
                  }
                </div>
                <div style={{ fontSize: 11.5, color: "#6d8297", display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, display: "inline-block" }} />
                  {statusLabel}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setMinimised(m => !m)}
                style={{ background: "#ffffff", border: "1px solid #d9e5f0", borderRadius: 10, padding: "6px 8px", cursor: "pointer", color: "#5b7087" }}
                title={minimised ? "Expand" : "Minimise"}
              >
                <Minus size={14} />
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{ background: "#ffffff", border: "1px solid #d9e5f0", borderRadius: 10, padding: "6px 8px", cursor: "pointer", color: "#5b7087" }}
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Aircall iframe container — rendered inline, below the header */}
          {!minimised && (
            <div
              ref={(el) => {
                // Move the SDK-created iframe from the hidden init div into this visible container
                if (el) {
                  const initDiv = document.getElementById("aircall-workspace");
                  if (initDiv) {
                    while (initDiv.firstChild) {
                      el.appendChild(initDiv.firstChild);
                    }
                  }
                }
              }}
              style={{
                width: "100%",
                height: 620,
                position: "relative",
                zIndex: 1,
                background: "#ffffff",
              }}
            />
          )}

          {/* Post-call status bar */}
          {callState.status === "ended" && !minimised && (
            <div style={{
              padding: "10px 16px",
              background: "#edf9f3",
              borderTop: "1px solid #cdeed9",
              fontSize: 12, color: "#166534",
              display: "flex", alignItems: "center", gap: 6,
              flexShrink: 0,
              position: "relative",
              zIndex: 2,
            }}>
              <PhoneOff size={12} />
              Call ended · {formatDuration(callState.duration)} · Auto-logged in CRM
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.2); }
        }
      `}</style>
    </>
  );
}
