"use client";

const TARGET_RATE = 24000;

function downsample(float32, fromRate) {
  if (fromRate === TARGET_RATE) return float32;
  const ratio = fromRate / TARGET_RATE;
  const length = Math.round(float32.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = float32[Math.min(float32.length - 1, Math.floor(i * ratio))];
  }
  return out;
}

function floatToPcm16(float32) {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function pcm16ToFloat(buffer) {
  const view = new DataView(buffer);
  const samples = new Float32Array(buffer.byteLength / 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
}

function voiceWsUrl({ token, bookingId, callId }) {
  const base = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3000";
  const wsBase = base.replace(/^http/, "ws").replace(/\/$/, "");
  const params = new URLSearchParams({ token, bookingId, callId });
  return `${wsBase}/voice?${params.toString()}`;
}

export function createVoiceSession({ token, bookingId, callId, onEvent }) {
  let ws;
  let audioCtx;
  let processor;
  let source;
  let mediaStream;
  let nextPlayTime = 0;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try {
      processor?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      source?.disconnect();
    } catch {
      /* ignore */
    }
    mediaStream?.getTracks().forEach((t) => t.stop());
    try {
      audioCtx?.close();
    } catch {
      /* ignore */
    }
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  };

  const playPcm16 = (arrayBuffer) => {
    if (!audioCtx) return;
    const samples = pcm16ToFloat(arrayBuffer);
    const buffer = audioCtx.createBuffer(1, samples.length, TARGET_RATE);
    buffer.getChannelData(0).set(samples);
    const node = audioCtx.createBufferSource();
    node.buffer = buffer;
    node.connect(audioCtx.destination);
    const startAt = Math.max(audioCtx.currentTime, nextPlayTime);
    node.start(startAt);
    nextPlayTime = startAt + buffer.duration;
  };

  const start = async () => {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: TARGET_RATE,
    });
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    source = audioCtx.createMediaStreamSource(mediaStream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (ev) => {
      if (closed || !ws || ws.readyState !== WebSocket.OPEN) return;
      const input = ev.inputBuffer.getChannelData(0);
      const resampled = downsample(input, audioCtx.sampleRate);
      const pcm = floatToPcm16(resampled);
      ws.send(pcm);
    };
    const mute = audioCtx.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(audioCtx.destination);

    ws = new WebSocket(voiceWsUrl({ token, bookingId, callId }));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "audio" && msg.audio) {
        const binary = atob(msg.audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        playPcm16(bytes.buffer);
      }
      onEvent?.(msg);
      if (msg.type === "ended" || msg.type === "error") {
        cleanup();
      }
    };
    ws.onerror = () => {
      onEvent?.({ type: "error", message: "socket_error" });
    };
    ws.onclose = () => {
      onEvent?.({ type: "ended", reason: "socket_closed" });
      cleanup();
    };
  };

  return {
    start,
    hangup() {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "hangup" }));
      }
      cleanup();
    },
  };
}
