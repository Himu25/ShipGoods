"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Browser STT -> backend chat (Groq + tools + guardrails) -> backend TTS
 * (Sarvam) -> playback, looped automatically for a full back-and-forth
 * conversation until stopListening() is called explicitly. No auto-hangup
 * on silence — the rider is the only one who ends the call. Kept
 * independent per layer so STT can later be swapped for Sarvam Saaras
 * without touching the chat/TTS plumbing.
 */
function getRecognition() {
  if (typeof window === "undefined") return null;
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  return SpeechRecognitionImpl ? new SpeechRecognitionImpl() : null;
}

export function useVoiceAgent({ bookingId, callId, token, apiBaseUrl }) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const activeRef = useRef(false); // whole-call flag, not one utterance
  const listenOnceRef = useRef(() => {});
  // True while a result is being sent to the agent + spoken back — guards
  // against onend (which fires right after onresult too) restarting the
  // mic while we're still mid-turn.
  const processingRef = useRef(false);
  // Permission/hardware errors shouldn't auto-retry forever.
  const hardFailureRef = useRef(false);
  // Rider's live GPS, refreshed each turn — used server-side only for
  // findCarLandmark's directional guidance. Call fails open (undefined)
  // if permission is denied or the browser has no geolocation.
  const lastPositionRef = useRef(null);

  const getCurrentPosition = useCallback(() => {
    return new Promise((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        resolve(lastPositionRef.current);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          lastPositionRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          resolve(lastPositionRef.current);
        },
        () => resolve(lastPositionRef.current),
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 15000 }
      );
    });
  }, []);

  const playBase64Audio = useCallback((base64) => {
    return new Promise((resolve) => {
      try {
        const audio = new Audio(`data:audio/wav;base64,${base64}`);
        audioRef.current = audio;
        audio.onended = () => {
          setSpeaking(false);
          resolve();
        };
        audio.onerror = () => {
          setSpeaking(false);
          resolve();
        };
        setSpeaking(true);
        audio.play().catch(() => {
          setSpeaking(false);
          resolve();
        });
      } catch {
        setSpeaking(false);
        resolve();
      }
    });
  }, []);

  const speakText = useCallback(
    async (text) => {
      try {
        const ttsRes = await fetch(`${apiBaseUrl}/api/voice-agent/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text }),
        });
        if (ttsRes.ok) {
          const ttsData = await ttsRes.json();
          if (ttsData.audioBase64) await playBase64Audio(ttsData.audioBase64);
        }
      } catch (err) {
        setError(err.message);
      }
    },
    [apiBaseUrl, token, playBase64Audio]
  );

  const sendToAgent = useCallback(
    async (text) => {
      if (!text?.trim()) return;
      setError(null);
      setTranscript((t) => [...t, { role: "user", text }]);

      try {
        const position = await getCurrentPosition();
        const chatRes = await fetch(`${apiBaseUrl}/api/voice-agent/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            bookingId,
            callId,
            text,
            userLat: position?.lat,
            userLng: position?.lng,
          }),
        });
        const chatData = await chatRes.json();
        const reply = chatData.reply || "Mujhe thodi dikkat ho rahi hai.";
        setTranscript((t) => [...t, { role: "assistant", text: reply }]);
        await speakText(reply);
      } catch (err) {
        setError(err.message);
      }
    },
    [apiBaseUrl, bookingId, callId, token, speakText, getCurrentPosition]
  );

  // Defined via a ref (not a plain recursive useCallback) so each
  // utterance's recognition handler always calls the LATEST sendToAgent
  // closure — otherwise a memoized listenOnce would keep calling a
  // stale sendToAgent from whichever render first created it, silently
  // using an old/undefined bookingId or callId.
  const listenOnce = useCallback(() => {
    if (!activeRef.current) return;
    const recognition = getRecognition();
    if (!recognition) {
      setError("SpeechRecognition is not supported in this browser.");
      return;
    }

    // hi-IN handles Hindi and Hinglish (romanized Hindi) reasonably well;
    // English speech is also recognized under this locale in Chrome.
    recognition.lang = "hi-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = async (event) => {
      processingRef.current = true;
      const text = event.results[event.results.length - 1][0].transcript;
      await sendToAgent(text);
      processingRef.current = false;
      // onend fires right after onresult too (per spec) — it sees
      // processingRef still true at that point and skips its own
      // restart, so this is the one place that restarts after a turn.
      if (activeRef.current) listenOnceRef.current();
    };
    recognition.onerror = (event) => {
      setError(event.error);
      hardFailureRef.current = ["not-allowed", "audio-capture", "service-not-allowed"].includes(
        event.error
      );
    };
    // The Web Speech API session can end on its own at any time — a
    // browser-internal timeout (commonly after ~60s of continuous use in
    // Chrome), "no-speech", "aborted", network hiccups, all of it ends up
    // here. Previously only onresult restarted listening, so any one of
    // these silent endings just stopped the mic for the rest of the call
    // (the "stops picking up my voice after a minute" symptom). Treating
    // onend as the one authoritative restart point — guarded so it never
    // fires mid-turn (processingRef) or after a real permission failure
    // (hardFailureRef) — makes listening actually continuous.
    recognition.onend = () => {
      setListening(false);
      const shouldRestart = activeRef.current && !processingRef.current && !hardFailureRef.current;
      hardFailureRef.current = false;
      if (shouldRestart) listenOnceRef.current();
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [sendToAgent]);

  listenOnceRef.current = listenOnce;

  // greetingText (if given) is spoken BEFORE listening starts — a fixed,
  // scripted line rather than waiting on the LLM, so every call opens
  // the same way regardless of what the rider says first.
  const startListening = useCallback(
    async (greetingText) => {
      activeRef.current = true;
      setTranscript([]);

      if (greetingText) {
        setTranscript((t) => [...t, { role: "assistant", text: greetingText }]);
        await speakText(greetingText);
        if (!activeRef.current) return; // hung up during the greeting
      }

      listenOnceRef.current();
    },
    [speakText]
  );

  const stopListening = useCallback(() => {
    activeRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  return { listening, speaking, transcript, error, startListening, stopListening };
}
