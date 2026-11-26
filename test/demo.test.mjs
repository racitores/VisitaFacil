import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDemoStore, DEMO_STORAGE_KEY } from "../dist/demo-store.mjs";
const seed = JSON.parse(
  await readFile(new URL("../dist/clientes.json", import.meta.url)),
).clientes;
const memory = () => {
  const data = new Map([["other-app-data", "untouched"]]);
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    data,
  };
};
const options = (storage) => ({ storage, seed, clock: () => "2030-11-25" });
test("demo persists locally and reset touches only its own namespace", async () => {
  const storage = memory(),
    demo = createDemoStore(options(storage));
  let s = await demo.request("/state");
  assert.equal(s.clients.length, 89);
  assert.equal(
    s.clients.reduce((n, c) => n + c.data.revisiones.length, 0),
    75,
  );
  assert.equal(s.whatsappConfigured, false);
  const c = s.clients[0];
  await demo.request(`/clients/${c.id}`, {
    method: "PUT",
    body: { ...c.data, nombre: "Cliente cambiado solo en demo" },
  });
  const restored = createDemoStore(options(storage));
  assert.equal(
    (await restored.request("/state")).clients[0].data.nombre,
    "Cliente cambiado solo en demo",
  );
  demo.reset();
  s = await demo.request("/state");
  assert.equal(s.clients[0].data.nombre, seed[0].nombre);
  assert.equal(s.plans.length, 0);
  assert.equal(storage.getItem("other-app-data"), "untouched");
  assert(storage.getItem(DEMO_STORAGE_KEY));
  await assert.rejects(
    () => demo.request("/auth/sign-in/email", { method: "POST", body: {} }),
    /no está disponible/,
  );
});
test("demo scheduling, pool, single suggestion, completion and capacity share production rules", async () => {
  const demo = createDemoStore(options(memory()));
  let s = await demo.request("/state");
  const grouped = await demo.request("/plans/group", {
    method: "POST",
    body: {
      day: "2030-11-25",
      name: "Zona",
      technicianId: s.userId,
      capacity: 2,
      minutes: 120,
      origin: [-3.7, 40.4],
      destination: [-3.7, 40.4],
    },
  });
  assert(grouped.assigned > 0);
  s = await demo.request("/state");
  const plan = s.plans[0],
    v = s.visits.find((v) => v.plan_id === plan.id),
    other = s.visits.find((v) => v.plan_id !== plan.id);
  await assert.rejects(
    () =>
      demo.request(`/visits/${other.id}/action`, {
        method: "POST",
        body: { action: "assign", planId: plan.id },
      }),
    /capacidad/,
  );
  await demo.request(`/visits/${v.id}/action`, {
    method: "POST",
    body: { action: "release", reason: "No puede ese día" },
  });
  const { suggestion } = await demo.request(`/visits/${v.id}/suggestion`);
  assert(suggestion?.planId);
  await demo.request(`/visits/${v.id}/action`, {
    method: "POST",
    body: { action: "assign", planId: suggestion.planId },
  });
  await demo.request(`/visits/${v.id}/action`, {
    method: "POST",
    body: { action: "complete", date: "2030-11-25", work: "Limpieza en demo" },
  });
  await assert.rejects(
    () =>
      demo.request(`/visits/${v.id}/action`, {
        method: "POST",
        body: { action: "complete", date: "2030-11-25", work: "Repetida" },
      }),
    /cerrada/,
  );
  s = await demo.request("/state");
  assert.equal(s.visits.find((x) => x.id === v.id).status, "completed");
  assert.equal(
    s.clients.find((c) => c.id === v.client_id).data.revisiones.at(-1)
      .descripcion,
    "Limpieza en demo",
  );
  assert.equal((await demo.request(`/visits/${v.id}/history`)).length, 4);
});
test("failed storage writes roll back mutations and corrupted data is preserved", async () => {
  const storage = memory(),
    demo = createDemoStore(options(storage));
  const before = await demo.request("/state");
  storage.setItem = () => {
    throw Error("Quota");
  };
  await assert.rejects(
    () => demo.request("/clients", { method: "POST", body: seed[0] }),
    /guardar/,
  );
  assert.deepEqual(await demo.request("/state"), before);
  const broken = memory();
  broken.data.set(DEMO_STORAGE_KEY, "broken-json");
  assert.throws(() => createDemoStore(options(broken)), /Restablecer demo/);
  assert.equal(broken.getItem(DEMO_STORAGE_KEY), "broken-json");
});
