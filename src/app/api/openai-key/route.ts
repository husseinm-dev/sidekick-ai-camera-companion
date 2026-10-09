import { auth } from "@/lib/auth";
import {
  deleteUserKey,
  getUserKeyInfo,
  isPlausibleOpenAIKey,
  saveUserKey,
  validateOpenAIKey,
} from "@/lib/api-key";

export const runtime = "nodejs";
export const maxDuration = 15;

const jsonError = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

async function requireUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return jsonError("Sign in first.", 401);
  const info = await getUserKeyInfo(user.id);
  return Response.json(
    info
      ? { configured: true, last4: info.last4, updatedAt: info.updatedAt }
      : { configured: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const user = await requireUser(request);
  if (!user) return jsonError("Sign in first.", 401);
  let key: unknown;
  try {
    ({ key } = await request.json());
  } catch {
    return jsonError("Send a JSON body with your API key.", 400);
  }
  if (typeof key !== "string" || !isPlausibleOpenAIKey(key.trim()))
    return jsonError(
      "That doesn't look like an OpenAI API key. It starts with sk-.",
      400,
    );
  const trimmed = key.trim();
  const verdict = await validateOpenAIKey(trimmed);
  if (!verdict.ok) return jsonError(verdict.error, verdict.status);
  const last4 = await saveUserKey(user.id, trimmed);
  return Response.json(
    { configured: true, last4 },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: Request) {
  const user = await requireUser(request);
  if (!user) return jsonError("Sign in first.", 401);
  await deleteUserKey(user.id);
  return Response.json(
    { configured: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
