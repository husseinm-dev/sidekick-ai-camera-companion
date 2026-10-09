"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "connecting" | "live";
type Line = { id: string; role: "you" | "sidekick"; text: string };
type RealtimeEvent = {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
  response?: {
    status?: string;
    status_details?: { error?: { message?: string } };
    output?: { type?: string; name?: string; call_id?: string }[];
  };
};

const FRAME_INTERVAL = 2500;
// Only the most recent frames stay in the conversation. Older ones are deleted so
// each reply re-reads a small, fresh visual context instead of an ever-growing one:
// unpruned frames made token usage grow quadratically and hit account rate limits.
const MAX_LIVE_FRAMES = 4;
// Hard seatbelt only; the idle detector below normally ends quiet sessions much sooner.
const SESSION_LIMIT = 30 * 60 * 1000;
// Go idle after this long without an exchange that was actually meant for Sidekick.
const IDLE_AFTER = 2 * 60 * 1000;
const IDLE_CHECK_INTERVAL = 10_000;
// Speech shorter than this is treated as a stray noise, not a question.
const NOISE_MIN_MS = 300;
// Speech must be sustained this long to interrupt Sidekick mid-answer.
const INTERRUPT_MIN_MS = 500;

export function useCompanion() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const resources = useRef<{
    stream?: MediaStream;
    peer?: RTCPeerConnection;
    channel?: RTCDataChannel;
    abort?: AbortController;
    frameTimer?: ReturnType<typeof setInterval>;
    limitTimer?: ReturnType<typeof setTimeout>;
    connectTimer?: ReturnType<typeof setTimeout>;
    idleTimer?: ReturnType<typeof setInterval>;
    goodbyeTimer?: ReturnType<typeof setTimeout>;
  }>({});
  const generation = useRef(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [cameraOn, setCameraOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activity, setActivity] = useState("Ready when you are");
  const [lines, setLines] = useState<Line[]>([]);
  const [frames, setFrames] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [sharing, setSharing] = useState(true);
  const sharingRef = useRef(true);
  const responseActive = useRef(false);
  const pendingReply = useRef(false);
  const speechStartedAt = useRef(0);
  const speechMs = useRef(Number.POSITIVE_INFINITY);
  const assistantSpeaking = useRef(false);
  const lastEngaged = useRef(0);
  const goingIdle = useRef(false);
  const frameIds = useRef<string[]>([]);

  const stop = useCallback(() => {
    // Invalidate unfinished permission prompts, fetches, and old connection events.
    generation.current += 1;
    const r = resources.current;
    resources.current = {};
    r.abort?.abort();
    clearInterval(r.frameTimer);
    clearTimeout(r.limitTimer);
    clearTimeout(r.connectTimer);
    clearInterval(r.idleTimer);
    clearTimeout(r.goodbyeTimer);
    r.channel?.close();
    r.peer?.close();
    r.stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    responseActive.current = false;
    pendingReply.current = false;
    speechMs.current = Number.POSITIVE_INFINITY;
    assistantSpeaking.current = false;
    goingIdle.current = false;
    frameIds.current = [];
    setPhase("idle");
    setCameraOn(false);
    setMuted(false);
    setAudioBlocked(false);
    setActivity("Ready when you are");
  }, []);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        stop();
        setNotice(
          "Session stopped because you left the app. Start again when you’re ready.",
        );
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
    };
  }, [stop]);

  function send(event: object) {
    const channel = resources.current.channel;
    if (channel?.readyState !== "open") return false;
    channel.send(JSON.stringify(event));
    return true;
  }

  function captureFrame() {
    const { channel, peer } = resources.current;
    const video = videoRef.current;
    // Skip, rather than queue, frames when the connection is congested.
    if (
      !sharingRef.current ||
      !video ||
      video.readyState < 2 ||
      !video.videoWidth ||
      channel?.readyState !== "open" ||
      channel.bufferedAmount > 64_000
    )
      return false;
    const canvas = document.createElement("canvas");
    const scale = Math.min(
      1,
      640 / Math.max(video.videoWidth, video.videoHeight),
    );
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const itemId = `frame_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const event = {
      type: "conversation.item.create",
      item: {
        id: itemId,
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Live camera frame at ${new Date().toISOString()}. Visual context only; wait for me to speak.`,
          },
          {
            type: "input_image",
            image_url: canvas.toDataURL("image/jpeg", 0.55),
          },
        ],
      },
    };
    const payload = JSON.stringify(event);
    const maxMessage = peer?.sctp?.maxMessageSize || 65_536;
    if (new TextEncoder().encode(payload).length > maxMessage) return false;
    try {
      channel.send(payload);
      // Trim old frames from the model's context to keep every reply cheap.
      frameIds.current.push(itemId);
      while (frameIds.current.length > MAX_LIVE_FRAMES) {
        const oldest = frameIds.current.shift();
        if (oldest)
          channel.send(
            JSON.stringify({
              type: "conversation.item.delete",
              item_id: oldest,
            }),
          );
      }
      setFrames((count) => count + 1);
      return true;
    } catch {
      return false;
    }
  }

  function addLine(
    id: string,
    role: Line["role"],
    text: string,
    append = false,
  ) {
    setLines((previous) => {
      const existing = previous.find((line) => line.id === id);
      if (existing)
        return previous.map((line) =>
          line.id === id
            ? { ...line, text: append ? line.text + text : text }
            : line,
        );
      return [...previous, { id, role, text }].slice(-50);
    });
  }

  function requestReply() {
    if (responseActive.current) {
      pendingReply.current = true;
      return;
    }
    captureFrame();
    if (send({ type: "response.create" })) {
      responseActive.current = true;
      setActivity("Thinking with you");
    }
  }

  // Says a short goodbye, then disconnects so an unattended session stops using the API.
  function goIdle() {
    if (goingIdle.current) return;
    goingIdle.current = true;
    pendingReply.current = false;
    setActivity("Wrapping up");
    const sent = send({
      type: "response.create",
      response: {
        tool_choice: "none",
        instructions:
          "The user hasn't spoken to you in a couple of minutes. Say one short, warm line: you don't think they're talking to you right now, so you'll go idle to save their usage, and they can start a new conversation whenever they're ready. Do not ask a question.",
      },
    });
    if (sent) responseActive.current = true;
    // Disconnect even if the goodbye audio never arrives.
    resources.current.goodbyeTimer = setTimeout(finishIdle, 20_000);
    if (!sent) finishIdle();
  }

  function finishIdle() {
    stop();
    setNotice(
      "Sidekick went idle to save your usage. Start a new conversation whenever you're ready.",
    );
  }

  // A real interruption stops Sidekick mid-answer; brief noises are ignored upstream.
  function interruptAssistant() {
    if (responseActive.current) send({ type: "response.cancel" });
    if (assistantSpeaking.current) send({ type: "output_audio_buffer.clear" });
    responseActive.current = false;
    pendingReply.current = false;
  }

  async function start() {
    if (resources.current.peer || resources.current.abort) return;
    stop();
    const attempt = generation.current;
    const current = () => generation.current === attempt;
    const abort = new AbortController();
    resources.current.abort = abort;
    setPhase("connecting");
    setError("");
    setNotice("");
    setFrames(0);
    setLines([]);
    setSharing(true);
    sharingRef.current = true;
    setActivity("Opening your camera and microphone");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Open this app over HTTPS to use your iPhone camera. Localhost works on this computer only.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!current()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      resources.current.stream = stream;
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (current()) {
            stop();
            setError("Camera or microphone access ended. Please reconnect.");
          }
        };
      });
      if (!videoRef.current)
        throw new Error("The camera preview is unavailable.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (!current()) return;
      setCameraOn(true);
      const peer = new RTCPeerConnection();
      resources.current.peer = peer;
      // Only audio is sent as a WebRTC media track. Vision uses automatic frame events.
      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
      peer.ontrack = (event) => {
        if (!current() || !audioRef.current) return;
        audioRef.current.srcObject =
          event.streams[0] || new MediaStream([event.track]);
        void audioRef.current.play().catch(() => {
          if (current()) setAudioBlocked(true);
        });
      };
      peer.onconnectionstatechange = () => {
        if (
          current() &&
          ["failed", "disconnected", "closed"].includes(peer.connectionState)
        ) {
          stop();
          setError(
            "The live connection was interrupted. Tap Start to reconnect.",
          );
        }
      };
      const channel = peer.createDataChannel("oai-events");
      resources.current.channel = channel;
      channel.onclose = () => {
        if (current()) {
          stop();
          setError("The conversation connection closed. Please reconnect.");
        }
      };
      channel.onerror = () => {
        if (current()) {
          stop();
          setError(
            "There was a problem with the live connection. Please reconnect.",
          );
        }
      };
      channel.onmessage = (message) => {
        if (!current()) return;
        let event: RealtimeEvent;
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }
        if (event.type === "input_audio_buffer.speech_started") {
          speechStartedAt.current = Date.now();
          speechMs.current = Number.POSITIVE_INFINITY;
          if (!assistantSpeaking.current) setActivity("Listening to you");
        }
        if (event.type === "input_audio_buffer.speech_stopped")
          speechMs.current = speechStartedAt.current
            ? Date.now() - speechStartedAt.current
            : Number.POSITIVE_INFINITY;
        // Committed means the spoken turn is in context. Queue a fresh frame after it,
        // then request a response. Automatic server replies are disabled for this reason.
        if (event.type === "input_audio_buffer.committed") {
          const duration = speechMs.current;
          if (goingIdle.current) {
            // Sustained speech during the goodbye cancels going idle.
            if (duration >= INTERRUPT_MIN_MS) {
              goingIdle.current = false;
              clearTimeout(resources.current.goodbyeTimer);
              lastEngaged.current = Date.now();
              interruptAssistant();
              requestReply();
            }
          } else if (duration < NOISE_MIN_MS) {
            // A stray noise or dropped word is not a question; don't answer it.
          } else if (assistantSpeaking.current || responseActive.current) {
            // Only sustained speech interrupts an answer in progress.
            if (duration >= INTERRUPT_MIN_MS) {
              interruptAssistant();
              requestReply();
            }
          } else {
            requestReply();
          }
        }
        if (
          event.type ===
            "conversation.item.input_audio_transcription.completed" &&
          event.transcript
        )
          addLine(
            event.item_id || crypto.randomUUID(),
            "you",
            event.transcript,
          );
        if (
          event.type === "response.output_audio_transcript.delta" &&
          event.delta
        )
          addLine(
            event.item_id || "current-reply",
            "sidekick",
            event.delta,
            true,
          );
        if (
          event.type === "response.output_audio_transcript.done" &&
          event.transcript
        )
          addLine(
            event.item_id || "current-reply",
            "sidekick",
            event.transcript,
          );
        if (event.type === "output_audio_buffer.started") {
          assistantSpeaking.current = true;
          setActivity("Sidekick is speaking");
        }
        if (event.type === "output_audio_buffer.stopped") {
          assistantSpeaking.current = false;
          if (goingIdle.current) {
            clearTimeout(resources.current.goodbyeTimer);
            finishIdle();
            return;
          }
          setActivity("Listening to you");
        }
        if (event.type === "response.done") {
          responseActive.current = false;
          const quietCalls = (event.response?.output || []).filter(
            (item) =>
              item.type === "function_call" && item.name === "stay_quiet",
          );
          if (quietCalls.length) {
            // Keep the conversation valid, but stay silent and don't count this
            // as the user engaging with Sidekick.
            for (const call of quietCalls)
              send({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: call.call_id,
                  output: JSON.stringify({ acknowledged: true }),
                },
              });
            pendingReply.current = false;
            setActivity("Standing by — say something to Sidekick anytime");
          } else if (!goingIdle.current) {
            lastEngaged.current = Date.now();
          }
          if (event.response?.status === "failed") {
            setError(
              event.response.status_details?.error?.message ||
                "The reply failed. Please try again.",
            );
            setActivity("Listening to you");
          }
          if (pendingReply.current) {
            pendingReply.current = false;
            if (!goingIdle.current) requestReply();
          }
        }
        if (event.type === "error") {
          // A cancellation race (the reply finished as we tried to stop it) is harmless,
          // and so is deleting a frame the server already dropped.
          const message = event.error?.message || "";
          if (/cancel|does not exist/i.test(message)) return;
          stop();
          setError(
            /rate limit/i.test(message)
              ? "Your OpenAI account's per-minute limit was reached. Wait a moment and start again; adding credits to your OpenAI account raises this limit."
              : message || "OpenAI reported a session error. Please reconnect.",
          );
        }
      };
      resources.current.connectTimer = setTimeout(() => {
        if (current()) {
          stop();
          setError("Connection timed out. Check your network and try again.");
        }
      }, 35_000);
      channel.onopen = () => {
        if (!current()) return;
        clearTimeout(resources.current.connectTimer);
        setPhase("live");
        setActivity("Listening to you");
        lastEngaged.current = Date.now();
        captureFrame();
        resources.current.frameTimer = setInterval(
          captureFrame,
          FRAME_INTERVAL,
        );
        // Quiet or not-directed-at-Sidekick sessions end with a spoken goodbye.
        resources.current.idleTimer = setInterval(() => {
          if (
            current() &&
            !goingIdle.current &&
            !responseActive.current &&
            !assistantSpeaking.current &&
            Date.now() - lastEngaged.current > IDLE_AFTER
          )
            goIdle();
        }, IDLE_CHECK_INTERVAL);
        resources.current.limitTimer = setTimeout(() => {
          if (current()) {
            stop();
            setNotice(
              "That was a long session, so Sidekick took a break. Start a new one to keep exploring.",
            );
          }
        }, SESSION_LIMIT);
      };
      setActivity("Connecting to OpenAI");
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!current()) return;
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
        signal: abort.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error || "Could not connect to OpenAI. Please try again.",
        );
      }
      const sdp = await response.text();
      if (!current()) return;
      await peer.setRemoteDescription({ type: "answer", sdp });
    } catch (e) {
      if (!current()) return;
      stop();
      setError(
        e instanceof Error ? e.message : "Unable to start this session.",
      );
    }
  }

  function toggleMute() {
    const tracks = resources.current.stream?.getAudioTracks();
    if (!tracks?.length) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach((track) => {
      track.enabled = enabled;
    });
    setMuted(!enabled);
  }

  function toggleSharing() {
    sharingRef.current = !sharingRef.current;
    setSharing(sharingRef.current);
    send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: sharingRef.current
              ? "Live camera sharing resumed. Use new frames as they arrive."
              : "Camera sharing is paused. You cannot see my current surroundings until I resume. Older images are historical only.",
          },
        ],
      },
    });
    if (sharingRef.current) captureFrame();
  }

  async function enableAudio() {
    try {
      await audioRef.current?.play();
      setAudioBlocked(false);
    } catch {
      setError(
        "Audio playback is blocked. Check Safari sound permissions and try again.",
      );
    }
  }

  function ask(text: string) {
    if (responseActive.current || phase !== "live") return;
    send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    addLine(crypto.randomUUID(), "you", text);
    requestReply();
  }

  return {
    videoRef,
    audioRef,
    phase,
    cameraOn,
    muted,
    sharing,
    error,
    notice,
    activity,
    lines,
    frames,
    audioBlocked,
    start,
    stop,
    toggleMute,
    toggleSharing,
    enableAudio,
    ask,
  };
}
