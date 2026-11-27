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
  await page.clock.setFixedTime(new Date("2026-11-27T10:00:00Z"));
  await page.goto("http://localhost:31929/?demo=1");
  await page.getByText("DEMO · Datos ficticios", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await page.locator("#client-cards .card").first().waitFor();
  assert.equal(await page.locator("#client-cards .card").count(), 25);
  await page.locator("[data-directory-action=next]").click();
  await page.getByText("360 de 360 clientes · página 2 de 15",{exact:true}).waitFor();
  await page.locator("[data-directory-filter=month]").fill("2027-01");
  await page.locator("[data-directory-filter=month]").dispatchEvent("change");
  await page.getByText("120 de 360 clientes · página 1 de 5",{exact:true}).waitFor();
  await page.locator("[data-directory-filter=locality]").selectOption("Madrid");
  await page.getByText("72 de 360 clientes · página 1 de 3",{exact:true}).waitFor();
  await page.locator("[data-directory-action=clear]").click();
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
  await page.locator(".card").filter({hasText:"Cliente no puede el día propuesto"}).locator("[data-action=suggest]").click();
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
  await page.getByRole("button",{name:"Semanal",exact:true}).click();
  await page.locator("[data-action=weekly-settings]").click();
  await page.locator("#editor [name=weeksAhead]").fill("2");
  await page.locator("#editor [name=capacity]").fill("2");
  await page.locator("#editor [name=origin]").fill("40.4,-3.7");
  await page.locator("#editor [name=destination]").fill("40.4,-3.7");
  await page.locator("#editor [name=weeklyTechnicians]").selectOption(["demo-technician","demo-tech-norte","demo-tech-sur"]);
  assert(await page.locator("#editor [name=enabled]").isDisabled());
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({state:"hidden"});
  await page.locator("[data-action=weekly-generate]").click();
  await page.locator(".weekly-run").first().waitFor();
  await page.locator("[data-action=weekly-approve]").first().click();
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({state:"hidden"});
  await page.getByText("Aprobado",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Agenda",exact:true}).click();
  await page
    .getByRole("button", { name: "Restablecer demo", exact: true })
    .click();
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  assert((await page.locator("[data-action=route]").count()) > 0);
  assert.equal(apiCalls, 0);
  console.log(
    "PASS demo móvil sin backend: 360 clientes con páginas, persistencia, agrupación, bolsa, sugerencia e intervención; cero peticiones a /api.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
