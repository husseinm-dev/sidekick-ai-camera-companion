# Sidekick — AI Camera Companion

Point your phone's camera at the world and talk to an AI about what it sees, in real time.

Sidekick is a mobile-first web app built with **Next.js 16, React 19, TypeScript, Tailwind CSS 4, and the OpenAI Realtime API**. Create an account, add your own OpenAI API key (stored encrypted, billed to you), then start a session: the camera runs continuously, the app streams your voice over WebRTC, and it periodically sends visual frames so the AI can answer questions like *"What am I looking at?"* out loud.

> **How the "video" works:** OpenAI Realtime accepts image inputs within a conversation, not a native video stream. The camera preview is smooth video, but the AI sees sampled frames (one every few seconds, plus a fresh frame when you finish a question) and may miss fast events. Only the latest few frames stay in the model's context to keep token usage and cost low. This is a prototype toward a wearable companion, not full human-like vision.

## Features

- **Real-time voice conversation** over a live WebRTC connection to OpenAI Realtime.
- **Continuous visual context** — automatic frame sampling with pruning of older frames so token usage stays flat instead of growing quadratically.
- **Bring your own API key** — each user's key is validated with OpenAI, stored AES-256-GCM encrypted, masked in the UI, removable anytime, and only decrypted server-side. Usage bills to each user's own OpenAI account.
- **Accounts and sessions** via [better-auth](https://www.better-auth.com/) with secure HTTP-only cookies, backed by Prisma + SQLite.
- **Noise-aware turn handling** — brief sounds don't trigger replies or interrupt the AI mid-answer; only sustained speech does. A `stay_quiet` tool lets the model skip side conversations not directed at it.
- **Spending guards** — after ~2 minutes without a real exchange, Sidekick says goodbye and disconnects; a 30-minute hard cap backs this up. Unattended sessions stop spending money.
- **Mobile-friendly controls** — rear-camera preference, inline video, microphone mute, pause/resume visual sharing, explicit session end, and an audio playback recovery button for Safari.
- **Robust cleanup** on connection failure, cancellation, page hiding, or timeout.
- **Learning panel** — an in-app "Learn the build" walkthrough explaining how the pieces fit together.

## Privacy

The app does not save recordings or transcripts to a database. Media is sent to OpenAI while connected; OpenAI's data handling is governed by your API account settings and policies. Transcripts remain in page memory until a new session or reload. Pausing vision stops future frame uploads (it does not erase already-shared context), and muting audio leaves visual sharing enabled.

## Setup

**Requirements:** Node.js 20.9+ (Node 22 recommended — `.nvmrc` selects it if you use nvm) and an OpenAI account with API billing/model access (a ChatGPT subscription alone is not API access).

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the two secrets (generate each with `openssl rand -base64 32`). Never use a `NEXT_PUBLIC_` prefix for secrets.

   ```dotenv
   OPENAI_REALTIME_MODEL=gpt-realtime
   BETTER_AUTH_SECRET=generate-a-random-32-byte-value
   KEY_ENCRYPTION_SECRET=generate-another-random-32-byte-value
   ```

3. Create the local SQLite database and generate the Prisma client:

   ```sh
   npx prisma migrate dev
   npx prisma generate
   ```

4. Start the dev server and open the printed local address:

   ```sh
   npm run dev
   ```

5. In the app: create an account, add your OpenAI project API key under **Account settings** (it is validated with OpenAI, stored encrypted, and never shown again), then tap **Start conversation** and allow camera and microphone access. If Safari blocks playback, tap **Tap to hear Sidekick**.

## Testing on your phone

Camera and microphone access require a **trusted HTTPS origin** — `http://192.168...` over local Wi-Fi does not satisfy the secure-context requirement, and `localhost` on your phone refers to the phone itself. Either deploy to an HTTPS host with the environment variables configured, or use an HTTPS development tunnel.

A one-terminal launcher is included for [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). Install `cloudflared` (either on your `PATH` or placed at `.tools/cloudflared`), make sure `.env.local` is configured, then run:

```sh
npm run phone
```

This builds the app, starts a temporary HTTPS tunnel, sets the correct public origin automatically, and prints a link to open in your phone's browser. Press Ctrl+C to stop both the app and the tunnel. Each run creates a new link; accounts and encrypted keys persist in the local database. The launcher never prints secrets, and it picks a free port automatically.

Useful variants:

- `npm run phone -- --check` — verify prerequisites without starting a server or making an API call.
- `npm run phone -- --smoke-test` — briefly start the HTTPS service, verify the page and the sign-in gate without calling OpenAI, then stop.

Keep the app in the foreground: this version ends the session when hidden and after the time caps. There is no background wake word — "Hey AI" is just part of a spoken question during an active session. A phone-in-pocket, screen-locked wearable requires additional native iOS and hardware work (see [docs/HARDWARE.md](docs/HARDWARE.md)).

If your HTTPS host forwards requests internally over HTTP, set `APP_ORIGIN` to your exact public URL (no trailing slash), e.g. `https://your-app.example`.

## Project map

| File                                       | Responsibility                                 |
| ------------------------------------------ | ---------------------------------------------- |
| `src/app/page.tsx`                         | Session-aware entry: auth panel or companion   |
| `src/components/companion.tsx`             | Interface and controls                         |
| `src/components/auth-panel.tsx`            | Sign-up and sign-in                            |
| `src/components/api-key-settings.tsx`      | Add, replace, or remove the user's API key     |
| `src/hooks/use-companion.ts`               | Camera, WebRTC, frames, idle logic, cleanup    |
| `src/app/api/session/route.ts`             | Auth check, per-user key, and SDP exchange     |
| `src/app/api/openai-key/route.ts`          | Key validation and encrypted storage           |
| `src/app/api/auth/[...all]/route.ts`       | better-auth endpoints                          |
| `src/lib/auth.ts` / `src/lib/db.ts`        | Auth server config and Prisma client           |
| `src/lib/api-key.ts` / `src/lib/crypto.ts` | Key lifecycle and AES-256-GCM sealing          |
| `src/lib/session.ts`                       | AI behavior, voice, tools, and turn detection  |
| `prisma/schema.prisma`                     | Users, sessions, and encrypted keys            |
| `src/app/globals.css`                      | Tailwind and global styling                    |
| `docs/HARDWARE.md`                         | Glasses-camera options and integration limits  |

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The automated server tests mock OpenAI and make no paid calls. They run against a throwaway SQLite database and cover request origin, the sign-in gate, per-user encrypted keys, body validation, secret handling, and upstream errors.

### Simulated browser checks

Start the app, then in another terminal:

```sh
npx playwright install chromium
npm run test:browser
```

Both scripts use a fake camera/microphone, create a throwaway local account, and intercept the OpenAI key-validation and session routes, so they use neither your real devices nor paid API calls. Set `TEST_BASE_URL` if the dev server uses a port other than 3000, or `CHROME_PATH` to point at an installed Chrome executable. The scripts verify sign-up, key onboarding, desktop/mobile layout, connection-error cleanup, automatic visual updates, mute, pause/resume, and transcript handling.

Real speech quality, latency, interruption behavior, and phone hardware compatibility still require an end-to-end session with a configured API key.

## Limits and next steps

- The frame cadence and keep-only-recent-frames window are application choices, not an OpenAI video capability. They keep per-minute token usage inside typical account rate limits; low-tier OpenAI accounts (40K tokens/minute) would otherwise hit rate-limit errors within a minute. Congestion or oversized frames cause skipped visual updates.
- Older frames can be truncated as the model's context fills. There is no durable memory across sessions.
- The idle goodbye and 30-minute cap curb accidental spending, but client timers are not a billing security boundary. API audio and image usage are paid by each user's own key.
- Side-conversation detection relies on the model's judgment via the `stay_quiet` tool; it can occasionally answer speech that wasn't for it, or stay quiet when it was.
- No web search is wired in, so the assistant must not claim current online facts.
- External cameras are not implemented. A private Wi-Fi camera feed needs accessible protocols and an integration bridge; it does not automatically appear as a browser camera.
- This is a prototype: distributed rate limiting, email verification, and server-enforced spending controls remain worthwhile before a large public launch.
- Next.js handles the web experience and server. A wearable app will likely add a native iOS component for device SDKs and background behavior.

## Official references

- [OpenAI Realtime model capabilities](https://developers.openai.com/api/docs/models/gpt-realtime)
- [OpenAI WebRTC connection guide](https://developers.openai.com/api/docs/guides/voice-webrtc)
- [Images in Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [Browser camera permissions and HTTPS](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
