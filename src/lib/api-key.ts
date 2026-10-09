import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export function isPlausibleOpenAIKey(key: string) {
  return /^sk-[A-Za-z0-9_-]{20,300}$/.test(key);
}

// One inexpensive authenticated call proves the key works before it is saved.
export async function validateOpenAIKey(
  key: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { ok: true };
    if (response.status === 401)
      return {
        ok: false,
        error: "OpenAI rejected this API key. Check it and try again.",
        status: 400,
      };
    return {
      ok: false,
      error: "OpenAI could not verify the key right now. Try again shortly.",
      status: 502,
    };
  } catch {
    return {
      ok: false,
      error: "Could not reach OpenAI to verify the key. Try again shortly.",
      status: 504,
    };
  }
}

export async function saveUserKey(userId: string, key: string) {
  const sealed = encryptSecret(key);
  const data = { ...sealed, last4: key.slice(-4) };
  await prisma.userApiKey.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
  return data.last4;
}

export async function getUserKey(userId: string) {
  const record = await prisma.userApiKey.findUnique({ where: { userId } });
  if (!record) return null;
  try {
    return decryptSecret(record);
  } catch {
    // KEY_ENCRYPTION_SECRET changed or the record is corrupt; the user must re-add the key.
    return null;
  }
}

export async function getUserKeyInfo(userId: string) {
  const record = await prisma.userApiKey.findUnique({
    where: { userId },
    select: { last4: true, updatedAt: true },
  });
  return record ?? null;
}

export async function deleteUserKey(userId: string) {
  await prisma.userApiKey.deleteMany({ where: { userId } });
}
