import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { test } from "node:test";

// A dedicated throwaway SQLite database keeps these tests away from dev data.
// Environment must be set before the route (and its Prisma client) is imported.
const TEST_DB = "prisma/test.db";
process.env.DATABASE_URL = `file:./${TEST_DB}`;
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";
process.env.KEY_ENCRYPTION_SECRET = "test-encryption-secret-at-least-32-chars";
rmSync(TEST_DB, { force: true });
execSync("npx prisma db push", {
  env: { ...process.env },
  stdio: "ignore",
});

const modules = Promise.all([
  import("../src/app/api/session/route"),
  import("../src/lib/auth"),
  import("../src/lib/api-key"),
  import("../src/lib/db"),
]).then(([route, authModule, apiKey, db]) => ({
  POST: route.POST,
  auth: authModule.auth,
  saveUserKey: apiKey.saveUserKey,
  getUserKey: apiKey.getUserKey,
  prisma: db.prisma,
}));

const origin = "http://localhost:3000";
const password = "long-enough-test-password";

async function createSignedInUser(email: string) {
  const { auth } = await modules;
  const response = await auth.api.signUpEmail({
    body: { name: "Test User", email, password },
    returnHeaders: true,
  });
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie.length > 0, "sign-up should set a session cookie");
  return { userId: response.response.user.id, cookie };
}

function request(
  body = "v=0\r\ns=test\r\n",
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/session`, {
    method: "POST",
    headers: { origin, "content-type": "application/sdp", ...headers },
    body,
  });
}

test("session boundary requires auth, uses the user's own key, and rejects bad input", async (t) => {
  const { POST, saveUserKey } = await modules;
  const originalFetch = globalThis.fetch;
  const { userId, cookie } = await createSignedInUser("owner@example.com");
  const userKey = "sk-test-user-key-abcdefghijkl1234";
  await saveUserKey(userId, userKey);
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      `Bearer ${userKey}`,
    );
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("sdp"), "v=0\r\ns=test\r\n");
    const session = JSON.parse(String(init.body.get("session")));
    assert.equal(session.type, "realtime");
    assert.equal(session.audio.input.turn_detection.create_response, false);
    assert.equal(session.audio.input.turn_detection.interrupt_response, false);
    assert.equal(session.tools[0].name, "stay_quiet");
    return new Response("v=0\r\ns=answer\r\n", { status: 201 });
  };
  try {
    await t.test("cross-origin request never reaches OpenAI", async () => {
      assert.equal(
        (
          await POST(
            request(undefined, { origin: "https://evil.example", cookie }),
          )
        ).status,
        403,
      );
      assert.equal(calls, 0);
    });
    await t.test("signed-out request never reaches OpenAI", async () => {
      assert.equal((await POST(request())).status, 401);
      assert.equal(calls, 0);
    });
    await t.test(
      "a user without a saved key gets actionable feedback",
      async () => {
        const other = await createSignedInUser("keyless@example.com");
        const response = await POST(
          request(undefined, { cookie: other.cookie }),
        );
        assert.equal(response.status, 403);
        assert.match(await response.text(), /API key/);
        assert.equal(calls, 0);
      },
    );
    await t.test("rejects malformed and oversized offers", async () => {
      assert.equal((await POST(request("invalid", { cookie }))).status, 400);
      assert.equal(
        (await POST(request("v=0" + "a".repeat(33_000), { cookie }))).status,
        413,
      );
      assert.equal(calls, 0);
    });
    await t.test("rejects unsupported content type", async () => {
      assert.equal(
        (
          await POST(
            request(undefined, { "content-type": "application/json", cookie }),
          )
        ).status,
        415,
      );
    });
    await t.test(
      "valid SDP exchange uses the stored key and returns only the answer",
      async () => {
        const response = await POST(request(undefined, { cookie }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(await response.text(), "v=0\r\ns=answer\r\n");
        assert.equal(calls, 1);
      },
    );
    await t.test("a rejected key tells the user to update it", async () => {
      globalThis.fetch = async () =>
        new Response("sensitive upstream detail", { status: 401 });
      const response = await POST(request(undefined, { cookie }));
      assert.equal(response.status, 403);
      const text = await response.text();
      assert.doesNotMatch(text, /sensitive/);
      assert.match(text, /API key/);
    });
    await t.test("upstream rate-limit details do not leak", async () => {
      globalThis.fetch = async () =>
        new Response("sensitive upstream detail", { status: 429 });
      const response = await POST(request(undefined, { cookie }));
      assert.equal(response.status, 429);
      assert.doesNotMatch(await response.text(), /sensitive/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stored keys are encrypted at rest and recoverable only by the server", async () => {
  const { saveUserKey, getUserKey, prisma } = await modules;
  const { userId } = await createSignedInUser("crypto@example.com");
  const key = "sk-proj-another-test-key-value-9876";
  await saveUserKey(userId, key);
  const row = await prisma.userApiKey.findUnique({ where: { userId } });
  assert.ok(row);
  assert.equal(row.last4, "9876");
  assert.ok(!row.ciphertext.includes(key), "plaintext key must not be stored");
  assert.equal(await getUserKey(userId), key);
});
