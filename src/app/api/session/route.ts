import { auth } from "@/lib/auth";
import { getUserKey } from "@/lib/api-key";
import { sessionConfig } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;
const jsonError = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

export async function POST(request: Request) {
  // Origin validation prevents another website from initiating sessions in a browser.
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  // Next's internal URL can use a bind address (0.0.0.0) instead of the public Host.
  const expectedOrigin =
    process.env.APP_ORIGIN ||
    `${requestUrl.protocol}//${request.headers.get("host") || requestUrl.host}`;
  if (!origin || origin !== expectedOrigin)
    return jsonError("Request origin is not allowed.", 403);
  // Each session runs on the signed-in user's own OpenAI key, on their billing.
  const authSession = await auth.api.getSession({ headers: request.headers });
  if (!authSession) return jsonError("Sign in to start a conversation.", 401);
  const key = await getUserKey(authSession.user.id);
  if (!key)
    return jsonError(
      "Add your OpenAI API key in Account settings before starting a conversation.",
      403,
    );
  if (!request.headers.get("content-type")?.startsWith("application/sdp"))
    return jsonError("Expected a connection offer.", 415);
  // Read incrementally so a client cannot allocate an unbounded request body.
  const reader = request.body?.getReader();
  if (!reader) return jsonError("Connection offer is missing.", 400);
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 32_768) {
      await reader.cancel();
      return jsonError("Connection offer is too large.", 413);
    }
    chunks.push(value);
  }
  const sdp = Buffer.concat(chunks).toString("utf8");
  if (!sdp.startsWith("v=0"))
    return jsonError("Connection offer is invalid.", 400);
  const form = new FormData();
  form.set("sdp", sdp);
  form.set(
    "session",
    JSON.stringify(
      sessionConfig(process.env.OPENAI_REALTIME_MODEL || "gpt-realtime"),
    ),
  );
  try {
    const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
    });
    if (!upstream.ok) {
      const message =
        upstream.status === 401
          ? "OpenAI rejected your saved API key. Update it in Account settings."
          : upstream.status === 429
            ? "Your OpenAI usage or rate limit was reached. Check your API billing and try again later."
            : "OpenAI could not start the session. Check your API key and model access.";
      return jsonError(
        message,
        upstream.status === 429 ? 429 : upstream.status === 401 ? 403 : 502,
      );
    }
    return new Response(await upstream.text(), {
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return jsonError(
      "The connection timed out or was interrupted. Please try again.",
      504,
    );
  }
}
