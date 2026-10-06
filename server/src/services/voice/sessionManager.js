import jwt from "jsonwebtoken";
import VoiceCall from "../../models/VoiceCall.js";
import { createGrokSession } from "./grokClient.js";

const MAX_CALL_MS = 90 * 1000;

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function verifyClient(url) {
  const params = url.searchParams;
  const token = params.get("token");
  const bookingId = params.get("bookingId");
  const callId = params.get("callId");
  if (!token || !bookingId || !callId) {
    throw new Error("missing_params");
  }
  const user = jwt.verify(token, process.env.JWT_SECRET);
  return { user, bookingId, callId };
}

export async function attachVoiceSession(clientWs, requestUrl, { redis, io }) {
  let identity;
  try {
    identity = verifyClient(requestUrl);
  } catch {
    sendJson(clientWs, { type: "error", message: "unauthorized" });
    clientWs.close(4401, "unauthorized");
    return;
  }

  const call = await VoiceCall.findById(identity.callId);
  if (!call) {
    sendJson(clientWs, { type: "error", message: "call_not_found" });
    clientWs.close(4404, "call_not_found");
    return;
  }

  if (String(call.userId) !== String(identity.user.id)) {
    sendJson(clientWs, { type: "error", message: "forbidden" });
    clientWs.close(4403, "forbidden");
    return;
  }

  if (String(call.bookingId) !== String(identity.bookingId)) {
    sendJson(clientWs, { type: "error", message: "booking_mismatch" });
    clientWs.close(4403, "forbidden");
    return;
  }

  if (!["ringing", "active"].includes(call.status)) {
    sendJson(clientWs, { type: "error", message: "call_not_active" });
    clientWs.close(4409, "call_not_active");
    return;
  }

  call.status = "active";
  call.answeredAt = new Date();
  await call.save();
  sendJson(clientWs, { type: "status", status: "active", callId: String(call._id) });

  const ctx = {
    callId: String(call._id),
    bookingId: String(call.bookingId),
    userId: String(call.userId),
    driverId: call.driverId ? String(call.driverId) : null,
    redis,
    io,
  };

  const grok = createGrokSession({
    ctx,
    onAudio: (base64) => {
      sendJson(clientWs, { type: "audio", audio: base64 });
    },
    onEvent: async (event) => {
      if (event.type === "transcript") {
        sendJson(clientWs, event);
        try {
          await VoiceCall.findByIdAndUpdate(call._id, {
            $push: {
              transcript: {
                role: event.role,
                text: event.text,
              },
            },
          });
        } catch {
          /* ignore */
        }
      } else if (event.type === "timeout") {
        sendJson(clientWs, { type: "ended", reason: "duration_cap" });
      } else if (event.type === "closed") {
        sendJson(clientWs, { type: "ended", reason: event.reason });
      } else if (event.type === "grok_error") {
        sendJson(clientWs, { type: "error", message: "voice_backend_error" });
      }
    },
    onFatal: async (err) => {
      console.error("Grok session error:", err.message);
      sendJson(clientWs, { type: "error", message: "voice_unavailable" });
      try {
        await VoiceCall.findByIdAndUpdate(call._id, {
          status: "failed",
          endedAt: new Date(),
          endedReason: "grok_error",
        });
      } catch {
        /* ignore */
      }
      clientWs.close();
    },
  });

  const hardStop = setTimeout(() => {
    grok.close("duration_cap");
    clientWs.close();
  }, MAX_CALL_MS);

  const finish = async (reason) => {
    clearTimeout(hardStop);
    grok.close(reason);
    try {
      const latest = await VoiceCall.findById(call._id);
      if (latest && latest.status === "active") {
        latest.status = "completed";
        latest.endedAt = new Date();
        latest.endedReason = reason || "hangup";
        await latest.save();
      }
    } catch {
      /* ignore */
    }
  };

  clientWs.on("message", (data, isBinary) => {
    if (isBinary) {
      grok.sendAudio(Buffer.from(data).toString("base64"));
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "audio" && msg.audio) {
      grok.sendAudio(msg.audio);
    }
    if (msg.type === "hangup") {
      sendJson(clientWs, { type: "ended", reason: "hangup" });
      finish("hangup");
      clientWs.close();
    }
  });

  clientWs.on("close", () => {
    finish("client_closed");
  });

  clientWs.on("error", () => {
    finish("client_error");
  });
}
