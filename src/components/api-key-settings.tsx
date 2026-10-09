"use client";

import { useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";

// Lets a signed-in user add, replace, or remove their own OpenAI API key.
// The key is sent once over HTTPS, validated, stored encrypted, and only its
// last four characters ever come back to the browser.
export function ApiKeySettings({
  last4,
  onChange,
}: {
  last4: string | null;
  onChange: (last4: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const showForm = editing || !last4;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/openai-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: draft }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error || "Could not save the key. Try again.");
      onChange(body.last4);
      setDraft("");
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the key.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/openai-key", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove the key. Try again.");
      onChange(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <KeyRound size={15} /> Your OpenAI API key
      </h3>
      {showForm ? (
        <form onSubmit={save} className="mt-3 max-w-md">
          <input
            type="password"
            autoComplete="off"
            required
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="sk-..."
            aria-label="OpenAI API key"
            className="w-full rounded-lg border border-stone-300 p-3 text-sm"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 rounded-full bg-stone-900 px-5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Checking with OpenAI…" : "Validate and save"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                  setError("");
                }}
                className="min-h-11 rounded-full border border-stone-300 px-5 text-xs"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="mt-3 text-xs leading-5 text-stone-500">
            Create a key in the OpenAI dashboard under API keys. It needs API
            billing enabled. Sidekick stores it encrypted and never shows it
            again; conversations bill to your OpenAI account.
          </p>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="rounded-lg bg-stone-100 px-3 py-2 text-sm">
            sk-••••••••{last4}
          </code>
          <button
            onClick={() => setEditing(true)}
            className="min-h-11 rounded-full border border-stone-300 px-5 text-xs"
          >
            Replace key
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="flex min-h-11 items-center gap-1 rounded-full border border-red-200 px-5 text-xs text-red-700 disabled:opacity-60"
          >
            <Trash2 size={13} /> Remove
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
