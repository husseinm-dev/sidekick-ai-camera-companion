import { chromium } from "playwright";
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
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/api/session", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error:
          "Add your OpenAI API key in Account settings before starting a conversation.",
      }),
    }),
  );
  await signUpAndAddKey(
    page,
    process.env.TEST_BASE_URL || "http://localhost:3000",
  );
  await page.getByRole("button", { name: "Learn the build" }).click();
  await page
    .getByRole("heading", { name: "Follow one question through the app" })
    .waitFor();
  await page.getByRole("button", { name: "Learn the build" }).click();
  await page.screenshot({ path: "/tmp/sidekick-desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await page
    .getByText("Add your OpenAI API key in Account settings", { exact: false })
    .waitFor({ timeout: 20000 });
  const error = await page
    .getByText("Add your OpenAI API key in Account settings", { exact: false })
    .textContent();
  if (!error.includes("API key"))
    throw Error("Missing-key guidance not displayed: " + error);
  if (
    !(await page
      .getByRole("button", { name: "Start conversation", exact: true })
      .isVisible())
  )
    throw Error("Session did not reset");
  if (
    !(await page.locator("video").evaluate((video) => video.srcObject === null))
  )
    throw Error("Camera not released after failure");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/sidekick-mobile.png", fullPage: true });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile overflow");
  if (failures.length) throw Error(failures.join("\n"));
  console.log(
    "PASS: signup, key onboarding, desktop/mobile layout, learning toggle, missing-key feedback, media cleanup, no page errors",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
