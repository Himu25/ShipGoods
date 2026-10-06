"use client";

import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useSocket } from "@/context/SocketContext";
import { useVoiceAgent } from "@/hooks/useVoiceAgent";

const RING_TIMEOUT_MS = 20000;
// Matches AGENT_NAME in server/src/services/voiceAgent/constants.js —
// update both together if the agent's name/voice ever changes.
const AGENT_DISPLAY_NAME = "Shubh";

function Waveform({ tone }) {
  // tone: "speaking" | "listening" | "idle" — green matches the existing
  // pickup-dot green (.sg-offer__dot--a), blue matches the app's primary
  // accent, so this reads as "the same app" rather than a new palette.
  const active = tone !== "idle";
  const color = tone === "speaking" ? "#2563eb" : tone === "listening" ? "#16a34a" : "#cbd5e1";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 20 }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={i}
          className={active ? "sg-call-wave-bar" : ""}
          style={{
            width: 2,
            borderRadius: 2,
            background: color,
            height: active ? `${6 + ((i * 7) % 14)}px` : "3px",
            animationDuration: active ? `${0.6 + (i % 5) * 0.12}s` : undefined,
            animationDelay: active ? `${(i % 6) * 0.07}s` : undefined,
          }}
        />
      ))}
    </div>
  );
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function IncomingCall() {
  const socket = useSocket();
  const { role, token } = useSelector((state) => state.auth);
  const [incoming, setIncoming] = useState(null);
  const [activeCall, setActiveCall] = useState(null); // { bookingId, callId, greeting }
  const [elapsed, setElapsed] = useState(0);
  const ringTimerRef = useRef(null);
  const elapsedTimerRef = useRef(null);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";

  const endCallOnServer = (callId) => {
    if (!callId) return;
    fetch(`${apiBaseUrl}/api/voice-agent/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ callId }),
    }).catch(() => {});
  };

  const agent = useVoiceAgent({
    bookingId: activeCall?.bookingId,
    callId: activeCall?.callId,
    token,
    apiBaseUrl,
  });

  useEffect(() => {
    if (!socket || role !== "user") return;

    const onIncoming = (payload) => {
      setIncoming(payload);
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = setTimeout(() => {
        socket.emit("voiceCallMissed", { callId: payload.callId });
        setIncoming(null);
      }, RING_TIMEOUT_MS);
    };

    socket.on("incomingVoiceCall", onIncoming);
    return () => {
      socket.off("incomingVoiceCall", onIncoming);
      clearTimeout(ringTimerRef.current);
    };
  }, [socket, role]);

  const decline = () => {
    clearTimeout(ringTimerRef.current);
    socket?.emit("voiceCallDeclined", { callId: incoming.callId });
    setIncoming(null);
  };

  const answer = () => {
    clearTimeout(ringTimerRef.current);
    // Carry the greeting forward — same scripted line the rider saw on
    // the ring banner is what gets spoken first once they answer.
    setActiveCall({
      bookingId: incoming.bookingId,
      callId: incoming.callId,
      greeting: incoming.message,
    });
    setIncoming(null);
  };

  // Starts listening only once activeCall (and therefore the hook's
  // bookingId/callId) is actually set — not on first mount.
  useEffect(() => {
    if (activeCall) agent.startListening(activeCall.greeting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall]);

  // Live call-duration timer, e.g. "00:01", "00:02", ...
  useEffect(() => {
    if (!activeCall) {
      setElapsed(0);
      return;
    }
    elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(elapsedTimerRef.current);
  }, [activeCall]);

  const hangUp = () => {
    agent.stopListening();
    endCallOnServer(activeCall?.callId);
    setActiveCall(null);
  };

  if (incoming && !activeCall) {
    return (
      <div className="sg-call">
        <div className="sg-call__card">
          <div className="sg-call__top">
            <div className="sg-call__avatar">S</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="sg-call__name">{AGENT_DISPLAY_NAME}</p>
              <p className="sg-call__status">ShipGoods · incoming call</p>
            </div>
          </div>
          <p className="sg-call__message">{incoming.message}</p>
          <div className="sg-call__actions">
            <button onClick={answer} className="sg-call__answer">
              Answer
            </button>
            <button onClick={decline} className="sg-call__decline">
              Decline
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeCall) {
    const tone = agent.speaking ? "speaking" : agent.listening ? "listening" : "idle";
    return (
      <div className="sg-call">
        <div className="sg-call__card">
          <div className="sg-call__top">
            <div className="sg-call__avatar">S</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="sg-call__name">{AGENT_DISPLAY_NAME}</p>
              <p className="sg-call__status">ShipGoods · {formatElapsed(elapsed)}</p>
            </div>
            <Waveform tone={tone} />
            <button onClick={hangUp} aria-label="Hang up" className="sg-call__hangup">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" style={{ transform: "rotate(135deg)" }}>
                <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.24 1.01l-2.21 2.2Z" />
              </svg>
            </button>
          </div>

          {agent.error && <p className="sg-call__error">{agent.error}</p>}

          {agent.transcript.length > 0 && (
            <div className="sg-call__transcript">
              {agent.transcript.slice(-4).map((t, i) => (
                <p key={i} className={`sg-call__line ${t.role === "assistant" ? "sg-call__line--agent" : ""}`}>
                  <strong>{t.role === "assistant" ? AGENT_DISPLAY_NAME : "You"}: </strong>
                  {t.text}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
