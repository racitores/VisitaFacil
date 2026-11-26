import { chromium } from "playwright";
import { setupDatabase } from "./helpers.mjs";
import { createApp } from "../server/app.mjs";
import express from "express";
import assert from "node:assert/strict";
process.env.BETTER_AUTH_URL = "http://localhost:31928";
process.env.BETTER_AUTH_SECRET = "browser-test-secret-not-for-production-12345";
const database = await setupDatabase();
const app = createApp({ pool: database.pool });
app.use(express.static("dist"));
const server = app.listen(31928);
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://localhost:31928/");
  await page
    .getByRole("textbox", { name: "Nombre", exact: true })
    .fill("Prueba navegador");
  await page
    .getByRole("textbox", { name: "Correo", exact: true })
    .fill("browser@example.com");
  await page.locator("[name=password]").first().fill("browser-password-123");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await page.locator("#company-form [name=name]").fill("Empresa navegador");
  await page.locator("#company-form button").click();
  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await page.locator("#import").setInputFiles("dist/clientes.json");
  await page.getByText("89 clientes importados.", { exact: true }).waitFor();
  await page.locator('[data-action="edit-client"]').first().click();
  await page
    .locator("#editor [name=equipo]")
    .fill("Caldera de prueba · modelo piloto");
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page
    .getByText("Caldera de prueba · modelo piloto", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.locator("#generate-form [name=until]").fill("2026-12-31");
  await page
    .getByRole("button", { name: "Detectar revisiones y enviar a bolsa" })
    .click();
  await page
    .getByRole("button", { name: "Agrupar la bolsa por zonas y días" })
    .click();
  await page.locator("#editor [name=capacity]").fill("6");
  await page.locator("#editor [name=origin]").fill("40.4,-3.7");
  await page.locator("#editor [name=destination]").fill("40.4,-3.7");
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator("[data-action=route]").first().waitFor();
  const cards = await page.locator("[data-action=route]").count();
  assert(cards > 0);
  await page.locator("[data-action=release]").first().click();
  await page
    .locator("#editor [name=reason]")
    .fill("El cliente llama y no puede");
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Bolsa", exact: true }).click();
  await page
    .getByText("El cliente llama y no puede", { exact: true })
    .waitFor();
  await page.locator("[data-action=suggest]").first().click();
  await page.locator("#editor").waitFor({ state: "visible" });
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.locator("[data-action=complete]").first().click();
  await page
    .locator("#editor [name=work]")
    .fill("Revisión y limpieza de prueba");
  await page.locator("#editor button[type=submit]").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  assert.equal(
    await page
      .locator("body")
      .evaluate((el) => el.scrollWidth > window.innerWidth + 1),
    false,
    "mobile overflow",
  );
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/visitafacil-mobile.png",
    fullPage: false,
  });
  console.log(
    `PASS navegador móvil: alta, empresa, importación de 89 clientes, ${cards} grupos, bolsa, sugerencia, reasignación e intervención. Sin errores JS ni desbordamiento.`,
  );
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await page.locator("#access").waitFor({ state: "visible" });
  await page.getByText("Ver demostración", { exact: true }).click();
  await page
    .getByRole("link", { name: "Directorio de demostración", exact: true })
    .click();
  await page.locator("#clients li").first().waitFor();
  await page.goto("http://localhost:31928/revisiones.html");
  await page.locator("#route-form").waitFor();
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await database.close();
}
