"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Camera,
  Eye,
  KeyRound,
  LogOut,
  Mic,
  MicOff,
  ScanEye,
  Settings2,
  Square,
  Video,
  Volume2,
} from "lucide-react";
import { useCompanion } from "@/hooks/use-companion";
import { authClient } from "@/lib/auth-client";
import { ApiKeySettings } from "@/components/api-key-settings";

export function Companion({
  user,
  initialKeyLast4,
}: {
  user: { name: string; email: string };
  initialKeyLast4: string | null;
}) {
  const router = useRouter();
  const { videoRef, audioRef, ...ai } = useCompanion();
  const [settings, setSettings] = useState(false);
  const [learning, setLearning] = useState(false);
  const [keyLast4, setKeyLast4] = useState(initialKeyLast4);
  const busy = ai.phase === "connecting";
  const live = ai.phase === "live";
  const hasKey = Boolean(keyLast4);

  async function signOut() {
    ai.stop();
    await authClient.signOut();
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-7xl px-5 pb-10 sm:px-10">
      <header className="flex items-center justify-between border-b border-black/10 py-6">
        <div className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Eye className="h-8 w-8" /> sidekick
          <span className="text-lime-700">.</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLearning(!learning)}
            aria-expanded={learning}
            className="flex min-h-11 items-center gap-2 rounded-full px-3 text-xs hover:bg-black/5"
          >
            <BookOpen size={16} />
            <span className="hidden sm:inline">Learn the build</span>
          </button>
          <button
            onClick={() => setSettings(!settings)}
            aria-expanded={settings}
            aria-label="Account settings"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 hover:bg-black/5"
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>
      {settings && (
        <section className="mt-5 space-y-6 rounded-2xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">Account</h2>
              <p className="mt-1 text-sm text-stone-500">
                Signed in as {user.name} · {user.email}
              </p>
            </div>
            <button
              onClick={signOut}
              className="flex min-h-11 items-center gap-2 rounded-full border border-stone-300 px-5 text-xs"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
          <ApiKeySettings last4={keyLast4} onChange={setKeyLast4} />
        </section>
      )}
      {learning && (
        <section className="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="font-medium">Follow one question through the app</h2>
          <ol className="mt-3 list-inside list-decimal space-y-2 text-sm leading-6 text-stone-600">
            <li>React displays the camera and updates the controls.</li>
            <li>
              Next.js securely opens an OpenAI session using your encrypted API
              key.
            </li>
            <li>WebRTC carries your voice and the AI’s spoken replies.</li>
            <li>
              The app automatically sends a camera frame every few seconds.
            </li>
            <li>
              When you finish speaking, it adds a fresh frame and requests an
              answer.
            </li>
          </ol>
          <p className="mt-4 text-sm text-stone-600">
            TypeScript checks our code’s assumptions; Tailwind styles this
            interface.
          </p>
        </section>
      )}
      <section className="grid gap-8 py-10 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="eyebrow mb-4">A LITTLE MORE PERSPECTIVE</p>
          <h1 className="max-w-2xl text-4xl leading-[1.08] font-medium tracking-[-0.055em] sm:text-6xl">
            Your world.
            <br />
            <span className="text-stone-500">Someone to explore it with.</span>
          </h1>
        </div>
        <p className="max-w-72 text-sm leading-6 text-stone-600">
          Point your camera. Follow your curiosity.
          <br />A voice companion for what’s in front of you.
        </p>
      </section>
      {ai.error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {ai.error}
        </p>
      )}
      {ai.notice && (
        <p role="status" className="mt-4 rounded-xl bg-stone-200 p-4 text-sm">
          {ai.notice}
        </p>
      )}
      {!hasKey && (
        <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="flex items-center gap-2 font-medium">
            <KeyRound size={16} /> One step left: add your OpenAI API key
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-stone-600">
            Sidekick runs on your own key, so conversations bill to your OpenAI
            account and nobody else can spend on your behalf.
          </p>
          <div className="mt-4">
            <ApiKeySettings last4={keyLast4} onChange={setKeyLast4} />
          </div>
        </section>
      )}
      <section className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <div className="camera-panel relative flex min-h-[480px] flex-col overflow-hidden rounded-[28px] bg-[#202921] text-white sm:min-h-[560px]">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label="Live camera preview"
            className={`absolute inset-0 h-full w-full object-cover ${ai.cameraOn ? "" : "invisible"}`}
          />
          <audio ref={audioRef} autoPlay />
          <div className="relative z-10 flex justify-between p-6">
            <span className="rounded-full bg-black/35 px-3 py-2 text-xs backdrop-blur-md">
              <span
                className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-lime-300" : "bg-stone-400"}`}
              />
              {live
                ? ai.sharing
                  ? "Live · camera sharing on"
                  : "Live · camera sharing paused"
                : busy
                  ? "Connecting"
                  : "Camera is off"}
            </span>
            <Video size={20} />
          </div>
          {!ai.cameraOn && (
            <div className="relative m-auto flex flex-col items-center px-8 text-center">
              <div className="viewfinder mb-8 flex h-24 w-24 items-center justify-center">
                <ScanEye size={40} strokeWidth={1} />
              </div>
              <h2 className="text-2xl font-medium tracking-tight">
                What caught your eye?
              </h2>
              <p className="mt-3 max-w-64 text-sm leading-6 text-white/60">
                Start a conversation, look around, and ask whatever comes to
                mind.
              </p>
            </div>
          )}
          <div className="relative z-10 mt-auto flex flex-col items-center gap-3 bg-gradient-to-t from-black/65 to-transparent p-6 pt-12">
            {live && (
              <div className="mb-2 flex gap-3">
                <button
                  aria-label={
                    ai.muted ? "Unmute microphone" : "Mute microphone"
                  }
                  aria-pressed={ai.muted}
                  onClick={ai.toggleMute}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 backdrop-blur-md"
                >
                  {ai.muted ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
                <button
                  onClick={ai.toggleSharing}
                  aria-pressed={!ai.sharing}
                  className="flex min-h-12 items-center gap-2 rounded-full bg-black/45 px-4 text-xs backdrop-blur-md"
                >
                  <Camera size={17} />
                  {ai.sharing ? "Pause vision" : "Resume vision"}
                </button>
              </div>
            )}
            <button
              onClick={live || busy ? ai.stop : () => ai.start()}
              disabled={!live && !busy && !hasKey}
              className="flex min-h-12 items-center gap-3 rounded-full bg-[#d5f57a] px-6 py-3 text-sm font-semibold text-[#263518] transition hover:bg-[#e2ff9b] disabled:opacity-60"
            >
              {live || busy ? <Square size={17} /> : <AudioLines size={19} />}
              {busy
                ? "Cancel connection"
                : live
                  ? "End conversation"
                  : hasKey
                    ? "Start conversation"
                    : "Add your API key to start"}
            </button>
            <p className="max-w-sm text-center text-[11px] leading-5 text-white/70">
              {live
                ? `${ai.frames} visual frames sent · ${ai.muted ? "Microphone muted" : "Microphone on"}`
                : "Starting shares your microphone and automatic camera frames with OpenAI."}
            </p>
          </div>
        </div>
        <aside className="flex min-h-[480px] flex-col rounded-[28px] border border-stone-200 bg-[#fcfcf8] p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <p className="eyebrow">THE CONVERSATION</p>
            <AudioLines
              size={20}
              className={live ? "text-lime-700" : "text-stone-400"}
            />
          </div>
          <p role="status" className="mt-3 text-xs text-stone-500">
            {ai.activity}
          </p>
          {ai.lines.length ? (
            <div
              role="log"
              aria-label="Conversation transcript"
              className="my-6 max-h-80 flex-1 space-y-5 overflow-y-auto"
            >
              {ai.lines.map((line) => (
                <div key={line.id}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-stone-400">
                    {line.role === "you" ? "You" : "Sidekick"}
                  </p>
                  <p className="text-sm leading-6">{line.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="my-9">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#edf0e4]">
                <Eye size={23} />
              </div>
              <h2 className="text-2xl leading-tight tracking-tight">
                “Hey, can you see
                <br />
                what I’m looking at?”
              </h2>
              <p className="mt-4 text-sm leading-6 text-stone-500">
                Just speak naturally. Sidekick uses the shared camera view to
                help you explore, understand, and notice more.
              </p>
            </div>
          )}
          <div className="space-y-2 border-t border-stone-200 pt-5">
            <p className="mb-3 text-[10px] font-semibold tracking-widest text-stone-400">
              A LITTLE INSPIRATION
            </p>
            {[
              "What am I looking at?",
              "Can you read this for me?",
              "What changed in front of me?",
            ].map((text) => (
              <button
                key={text}
                onClick={() => ai.ask(text)}
                disabled={!live}
                className="flex w-full items-center justify-between rounded-xl border border-stone-200 px-3 py-3 text-left text-xs text-stone-600 enabled:hover:bg-stone-100 disabled:cursor-default"
              >
                {text}
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
          <div className="mt-auto pt-6">
            <p className="text-[11px] leading-5 text-stone-500">
              Continuous camera, sampled vision: a fresh frame every few
              seconds, and only the latest few are kept. Fast motion may be
              missed. If nothing seems meant for Sidekick for a couple of
              minutes, it says so and goes idle to save your usage.
            </p>
          </div>
        </aside>
      </section>
      {ai.audioBlocked && (
        <button
          onClick={ai.enableAudio}
          className="mt-4 flex min-h-12 items-center gap-2 rounded-xl bg-lime-200 px-5 text-sm"
        >
          <Volume2 size={18} />
          Tap to hear Sidekick
        </button>
      )}
      <footer className="mt-7 flex flex-wrap justify-between gap-3 text-xs text-stone-500">
        <span>Built to explore. Built to learn.</span>
        <span>OpenAI voice + vision · No recordings saved by this app</span>
      </footer>
    </main>
  );
}
