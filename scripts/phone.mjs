// Starts the web app and its HTTPS tunnel together. No OpenAI calls are made here.
import { spawn, spawnSync } from "node:child_process";
import { lookup, resolve4 } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const children = new Set();
let stopping = false;
let tunnelLog = "";

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  const force = setTimeout(() => {
    for (const child of children) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already stopped */
      }
    }
    process.exit(code);
  }, 3000);
  if (!children.size) {
    clearTimeout(force);
    process.exit(code);
  }
  for (const child of children)
    child.once("exit", () => {
      if (!children.size) {
        clearTimeout(force);
        process.exit(code);
      }
    });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

function launch(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    stdio: "inherit",
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", (error) => {
    console.error(`Could not start ${command}: ${error.message}`);
    stop(1);
  });
  return child;
}

function usableNode(candidate) {
  if (!candidate || !existsSync(candidate)) return false;
  const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
  const [major, minor] = (result.stdout || "")
    .trim()
    .replace(/^v/, "")
    .split(".")
    .map(Number);
  return result.status === 0 && (major > 20 || (major === 20 && minor >= 9));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

// Try the OS resolver first. Some macOS resolver caches return ENOTFOUND for a
// new tunnel even when DNS already has it. Resolve the same hostname directly
// as a fallback; HTTPS still verifies the original hostname's certificate.
function resolveHost(hostname, options, callback) {
  lookup(hostname, options, (error, address, family) => {
    if (!error || error.code !== "ENOTFOUND")
      return callback(error, address, family);
    resolve4(hostname, (dnsError, addresses) => {
      if (dnsError || !addresses?.length) return callback(dnsError || error);
      if (options.all)
        callback(
          null,
          addresses.map((address) => ({ address, family: 4 })),
        );
      else callback(null, addresses[0], 4);
    });
  });
}

function checkRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = url.startsWith("https:") ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        method: options.method || "GET",
        headers: options.headers,
        lookup: resolveHost,
        signal: AbortSignal.timeout(5000),
      },
      (response) => {
        response.resume();
        resolve({
          status: response.statusCode,
          ok: response.statusCode >= 200 && response.statusCode < 300,
        });
      },
    );
    req.once("error", reject);
    req.end(options.body);
  });
}

async function waitForPage(url, timeout = 45_000) {
  const until = Date.now() + timeout;
  let lastFailure = "not ready";
  while (Date.now() < until && !stopping) {
    try {
      const response = await checkRequest(url);
      if (response.ok) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error.cause?.code || error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Could not reach ${url}: ${lastFailure}. Check your network and try again.`,
  );
}

async function main() {
  const node = [
    process.env.NODE_BINARY,
    process.execPath,
    "/opt/homebrew/opt/node@22/bin/node",
    "/usr/local/opt/node@22/bin/node",
    join(
      homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node",
    ),
  ].find(usableNode);
  if (!node)
    throw new Error(
      "Node.js 20.9+ is required. Install Node 22, then run npm run phone again.",
    );
  const localTunnel = join(root, ".tools/cloudflared");
  const cloudflared = existsSync(localTunnel) ? localTunnel : "cloudflared";
  if (
    spawnSync(cloudflared, ["--version"], { encoding: "utf8" }).status !== 0
  ) {
    throw new Error(
      "cloudflared is missing. See the phone-testing instructions in README.md.",
    );
  }
  // Use Next's loader instead of printing or manually parsing secret values.
  require("@next/env").loadEnvConfig(root, false);
  if (!process.env.BETTER_AUTH_SECRET || !process.env.KEY_ENCRYPTION_SECRET)
    throw new Error(
      "Add BETTER_AUTH_SECRET and KEY_ENCRYPTION_SECRET to .env.local first (see .env.example), then run npm run phone again.",
    );
  if (process.argv.includes("--check")) {
    console.log(
      "Ready: compatible Node, cloudflared, and server secrets found. Sign in on the phone and add your OpenAI key in the app.",
    );
    return;
  }

  console.log("\nPreparing your iPhone app…");
  const next = require.resolve("next/dist/bin/next");
  const build = launch(node, [next, "build"], {
    env: { ...process.env, NODE_ENV: "production" },
  });
  const result = await new Promise((resolve) => build.once("exit", resolve));
  if (result !== 0)
    throw new Error("The app build failed. See the message above.");

  const port = await freePort();
  const localUrl = `http://127.0.0.1:${port}`;
  console.log("\nCreating your temporary HTTPS link…");
  // Pass only the environment this process needs: no API key goes to cloudflared.
  const tunnelEnv = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "SSL_CERT_FILE", "SSL_CERT_DIR"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  const tunnel = launch(
    cloudflared,
    ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", localUrl],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: tunnelEnv,
    },
  );
  const publicUrl = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "Cloudflare did not provide a link. Check your internet connection.",
          ),
        ),
      45_000,
    );
    const capture = (chunk) => {
      output = (output + chunk.toString()).slice(-16000);
      tunnelLog = output;
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    tunnel.stdout.on("data", capture);
    tunnel.stderr.on("data", capture);
    tunnel.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Cloudflare stopped before creating the link."));
    });
  });
  tunnel.once("exit", () => {
    if (!stopping) {
      console.error("The HTTPS tunnel stopped. Run npm run phone again.");
      stop(1);
    }
  });
  const app = launch(
    node,
    [next, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        APP_ORIGIN: publicUrl,
      },
    },
  );
  app.once("exit", () => {
    if (!stopping) {
      console.error("The app stopped. Run npm run phone again.");
      stop(1);
    }
  });
  await waitForPage(localUrl);
  await waitForPage(publicUrl);

  if (process.argv.includes("--smoke-test")) {
    // A signed-out request must stop at our auth gate, before any paid API call.
    const response = await checkRequest(`${publicUrl}/api/session`, {
      method: "POST",
      headers: { origin: publicUrl, "content-type": "application/sdp" },
      body: "v=0",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 401)
      throw new Error(
        `Expected the sign-in gate (401), got ${response.status}.`,
      );
    console.log(
      "PASS: public HTTPS page works and session creation requires a signed-in user. No OpenAI API call made.",
    );
    stop();
    return;
  }
  console.log(
    `\nOpen this link in Safari on your iPhone:\n\n  ${publicUrl}\n\nCreate an account (or sign in), add your OpenAI API key under Account settings,\nthen tap Start conversation and allow camera + microphone.\nKeep this terminal open and your Mac awake. Control+C stops everything.\nEach run creates a new link; your account and key are stored locally on this Mac.\n`,
  );
}
main().catch((error) => {
  console.error(`\n${error.message}\n`);
  if (tunnelLog) console.error(tunnelLog.split("\n").slice(-8).join("\n"));
  stop(1);
});
