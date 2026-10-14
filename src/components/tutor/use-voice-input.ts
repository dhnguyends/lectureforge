"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api-client";

type State = "idle" | "recording" | "transcribing";

/**
 * Records from the microphone and transcribes with the app's own
 * speech-to-text service (local Whisper), so voice input works in every
 * browser and audio never goes to a third party.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  // Decided after mount so server and client render the same markup (no hydration mismatch).
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported("MediaRecorder" in window && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  const start = useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was denied.");
      return;
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType });
      if (blob.size < 1000) {
        setState("idle");
        return;
      }
      setState("transcribing");
      try {
        const form = new FormData();
        form.set("audio", blob, "voice");
        const res = await fetch("/api/speech-to-text", { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null;
        if (!res.ok) throw new ApiClientError(res.status, "stt", body?.error?.message ?? "Transcription failed.");
        if (body?.text) onText(body.text);
        else setError("No speech was recognised.");
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : "Can't reach the speech-to-text service.");
      } finally {
        setState("idle");
      }
    };
    recorder.current = rec;
    rec.start();
    setState("recording");
  }, [onText]);

  const stop = useCallback(() => recorder.current?.state === "recording" && recorder.current.stop(), []);

  return { supported, state, error, start, stop };
}
