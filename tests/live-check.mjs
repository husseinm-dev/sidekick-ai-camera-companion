import { chromium } from "playwright";
import assert from "node:assert/strict";
import { signUpAndAddKey } from "./browser-shared.mjs";
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.addInitScript(() => {
      window.sentEvents = [];
      window.RTCPeerConnection = class {
        connectionState = "new";
        sctp = { maxMessageSize: 65536 };
        addTrack() {}
        createDataChannel() {
          const channel = {
            readyState: "connecting",
            bufferedAmount: 0,
            send: (data) => window.sentEvents.push(JSON.parse(data)),
            close() {
              this.readyState = "closed";
              this.onclose?.();
            },
          };
          this.channel = channel;
          window.mockChannel = channel;
          return channel;
        }
        async createOffer() {
          return { type: "offer", sdp: "v=0\r\ns=test\r\n" };
        }
        async setLocalDescription() {}
        async setRemoteDescription() {
          this.connectionState = "connected";
          this.channel.readyState = "open";
          this.channel.onopen();
        }
        close() {
          this.connectionState = "closed";
          this.onconnectionstatechange?.();
        }
      };
    });
    await page.route("**/api/session", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/sdp",
        body: "v=0\r\ns=mock\r\n",
      }),
    );
    await signUpAndAddKey(
      page,
      process.env.TEST_BASE_URL || "http://localhost:3000",
    );
    await page
      .getByRole("button", { name: "Start conversation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "End conversation", exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        window.sentEvents.filter((e) =>
          e.item?.content?.some((c) => c.type === "input_image"),
        ).length >= 2,
    );
    await page
      .getByRole("button", { name: "Mute microphone", exact: true })
      .click();
    assert.equal(
      await page
        .locator("video")
        .evaluate((v) => v.srcObject.getAudioTracks()[0].enabled),
      false,
    );
    await page
      .getByRole("button", { name: "Pause vision", exact: true })
      .click();
    const count = await page.evaluate(
      () =>
        window.sentEvents.filter((e) =>
          e.item?.content?.some((c) => c.type === "input_image"),
        ).length,
    );
    await page.waitForTimeout(1200);
    assert.equal(
      await page.evaluate(
        () =>
          window.sentEvents.filter((e) =>
            e.item?.content?.some((c) => c.type === "input_image"),
          ).length,
      ),
      count,
    );
    await page
      .getByRole("button", { name: "Resume vision", exact: true })
      .click();
    // Old frames must be pruned from the model's context to cap token usage.
    await page.waitForFunction(() =>
      window.sentEvents.some((e) => e.type === "conversation.item.delete"),
    );
    await page.evaluate(() =>
      window.mockChannel.onmessage({
        data: JSON.stringify({ type: "input_audio_buffer.committed" }),
      }),
    );
    const events = await page.evaluate(() =>
      window.sentEvents.filter((e) => e.type !== "conversation.item.delete"),
    );
    assert.equal(events.at(-1).type, "response.create");
    assert.ok(events.at(-2).item.content.some((c) => c.type === "input_image"));
    const kept = await page.evaluate(() => {
      const created = window.sentEvents
        .filter((e) => e.type === "conversation.item.create" && e.item.id)
        .map((e) => e.item.id);
      const deleted = new Set(
        window.sentEvents
          .filter((e) => e.type === "conversation.item.delete")
          .map((e) => e.item_id),
      );
      return created.filter((id) => !deleted.has(id)).length;
    });
    assert.ok(kept <= 4, `Expected at most 4 live frames, found ${kept}`);
    await page.evaluate(() =>
      window.mockChannel.onmessage({
        data: JSON.stringify({
          type: "response.output_audio_transcript.done",
          item_id: "test-reply",
          transcript: "This is a simulated test reply.",
        }),
      }),
    );
    await page.getByText("This is a simulated test reply.").waitFor();
    await page
      .getByRole("button", { name: "End conversation", exact: true })
      .click();
    assert.equal(
      await page.locator("video").evaluate((v) => v.srcObject),
      null,
    );
    console.log(
      "PASS: mocked live session, automatic visual updates, frame pruning, mute, vision pause/resume, fresh frame before response, transcript, end cleanup",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
