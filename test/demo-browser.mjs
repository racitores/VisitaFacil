import { chromium } from "playwright";
import express from "express";
import assert from "node:assert/strict";
const app = express();
let apiCalls = 0;
app.use("/api", (req, res) => {
  apiCalls++;
  res.status(503).json({ error: "Backend unavailable in demo test" });
});
app.use(express.static("dist"));
const server = app.listen(31929);
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://localhost:31929/?demo=1");
  await page.getByText("DEMO · Datos ficticios", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await page.locator("#client-cards .card").first().waitFor();
  assert.equal(await page.locator("#client-cards .card").count(), 89);
  await page.locator("[data-action=edit-client]").first().click();
  await page.locator("#editor [name=equipo]").fill("Solo en mi navegador");
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await page.getByText("Solo en mi navegador", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page
    .getByRole("button", { name: "Agrupar la bolsa por zonas y días" })
    .click();
  await page.locator("#editor [name=origin]").fill("40.4,-3.7");
  await page.locator("#editor [name=destination]").fill("40.4,-3.7");
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator("[data-action=release]").first().click();
  await page
    .locator("#editor [name=reason]")
    .fill("Cliente no puede el día propuesto");
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Bolsa", exact: true }).click();
  await page
    .getByText("Cliente no puede el día propuesto", { exact: true })
    .waitFor();
  await page.locator("[data-action=suggest]").first().click();
  await page.locator("#editor").waitFor({ state: "visible" });
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.locator("[data-action=complete]").first().click();
  await page
    .locator("#editor [name=work]")
    .fill("Intervención de demostración");
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  assert.equal(
    await page.getByRole("button", { name: "Equipo", exact: true }).isVisible(),
    false,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Mensajes", exact: true })
      .isVisible(),
    false,
  );
  assert.equal(apiCalls, 0, "Demo must never call the application API");
  assert.deepEqual(errors, []);
  assert.equal(
    await page
      .locator("body")
      .evaluate((el) => el.scrollWidth > window.innerWidth + 1),
    false,
  );
  await page
    .getByRole("button", { name: "Restablecer demo", exact: true })
    .click();
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  assert.equal(await page.locator("[data-action=route]").count(), 0);
  assert.equal(apiCalls, 0);
  console.log(
    "PASS demo móvil sin backend: 89 clientes, persistencia, agrupación, bolsa, sugerencia e intervención; cero peticiones a /api.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
