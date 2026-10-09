// Shared setup for the simulated browser checks: creates a throwaway account
// against the running app's local database and "saves" a mocked API key so the
// conversation UI unlocks. No OpenAI call is ever made.
export async function signUpAndAddKey(page, baseUrl) {
  await page.route("**/api/openai-key", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: true, last4: "MOCK" }),
    }),
  );
  await page.goto(baseUrl);
  await page.getByLabel("Name").fill("Test Runner");
  await page
    .getByLabel("Email")
    .fill(
      `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    );
  await page.getByLabel("Password").fill("playwright-test-pass");
  await page.getByRole("button", { name: "Create my account" }).click();
  await page
    .getByText("One step left", { exact: false })
    .waitFor({ timeout: 20000 });
  await page
    .getByLabel("OpenAI API key")
    .fill("sk-mock-key-for-browser-tests-0000");
  await page.getByRole("button", { name: "Validate and save" }).click();
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .waitFor({ timeout: 20000 });
}
