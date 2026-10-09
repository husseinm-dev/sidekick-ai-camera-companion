"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, LogIn, UserRoundPlus } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function AuthPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const result = signup
      ? await authClient.signUp.email({
          name: name.trim() || email.split("@")[0],
          email: email.trim(),
          password,
        })
      : await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (result.error) {
      setError(
        result.error.message ||
          "That didn't work. Check your details and try again.",
      );
      return;
    }
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-7xl px-5 pb-10 sm:px-10">
      <header className="flex items-center justify-between border-b border-black/10 py-6">
        <div className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Eye className="h-8 w-8" /> sidekick
          <span className="text-lime-700">.</span>
        </div>
      </header>
      <section className="grid gap-10 py-10 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="eyebrow mb-4">A LITTLE MORE PERSPECTIVE</p>
          <h1 className="max-w-2xl text-4xl leading-[1.08] font-medium tracking-[-0.055em] sm:text-6xl">
            Your world.
            <br />
            <span className="text-stone-500">Someone to explore it with.</span>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-6 text-stone-600">
            Point your camera, speak naturally, and hear answers about what’s in
            front of you. Sidekick runs on your own OpenAI API key, so your
            usage stays on your own account.
          </p>
          <ol className="mt-6 max-w-md list-inside list-decimal space-y-2 text-sm leading-6 text-stone-600">
            <li>Create a free Sidekick account.</li>
            <li>Add your OpenAI API key — it’s stored encrypted.</li>
            <li>Start a conversation and look around.</li>
          </ol>
        </div>
        <form
          onSubmit={submit}
          className="mx-auto w-full max-w-md rounded-[28px] border border-stone-200 bg-[#fcfcf8] p-6 sm:p-8"
        >
          <div className="mb-6 flex rounded-full bg-stone-200/70 p-1 text-sm">
            {(
              [
                ["signup", "Create account"],
                ["signin", "Sign in"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError("");
                }}
                aria-pressed={mode === value}
                className={`min-h-11 flex-1 rounded-full transition ${mode === value ? "bg-white font-medium shadow-sm" : "text-stone-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {signup && (
            <label className="block text-sm">
              Name
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What should Sidekick call you?"
                className="mt-2 mb-4 w-full rounded-lg border border-stone-300 p-3"
              />
            </label>
          )}
          <label className="block text-sm">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 mb-4 w-full rounded-lg border border-stone-300 p-3"
            />
          </label>
          <label className="block text-sm">
            Password
            <input
              type="password"
              required
              minLength={10}
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={signup ? "At least 10 characters" : undefined}
              className="mt-2 w-full rounded-lg border border-stone-300 p-3"
            />
          </label>
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#d5f57a] px-6 text-sm font-semibold text-[#263518] transition hover:bg-[#e2ff9b] disabled:opacity-60"
          >
            {signup ? <UserRoundPlus size={17} /> : <LogIn size={17} />}
            {busy ? "One moment" : signup ? "Create my account" : "Sign in"}
          </button>
          <p className="mt-4 text-xs leading-5 text-stone-500">
            No subscription. Conversations bill to your own OpenAI account
            through the API key you add after signing in.
          </p>
        </form>
      </section>
      <footer className="mt-7 flex flex-wrap justify-between gap-3 text-xs text-stone-500">
        <span>Built to explore. Built to learn.</span>
        <span>OpenAI voice + vision · No recordings saved by this app</span>
      </footer>
    </main>
  );
}
