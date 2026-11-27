import {buildDemoSeed} from "../dist/demo-seed.mjs";
import {queryClients} from "../dist/client-directory.mjs";
import {nextDue} from "../dist/planificacion-domain.mjs";
import {defaultWeeklySettings} from "../dist/planificacion-semanal.mjs";
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
  s=await demo.request("/state");
  assert(s.visits.find(x=>x.id===v.id).availability.excluded.includes(plan.day));
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

test("expanded demo preserves old data, supplies 120 clients per month and combines pagination filters with weekly drafts",async function seedAndDirectory(){
 const demoSeed=buildDemoSeed(seed);
 assert.equal(demoSeed.length,360);assert.equal(new Set(demoSeed.map(c=>c.id)).size,360);
 for(const month of ["2026-11","2026-12","2027-01"])assert.equal(demoSeed.filter(c=>nextDue(c).startsWith(month)).length,120);
 assert(demoSeed.every(c=>c.direccion.coordenadas.length===2&&c.revisiones.length===2));
 const storage=memory(),old=createDemoStore(options(storage));let oldState=await old.request("/state");
 const original=oldState.clients[0];await old.request(`/clients/${original.id}`,{method:"PUT",body:{...original.data,nombre:"Conservar edición"}});
 const newer=createDemoStore({storage,seed:demoSeed,seedRevision:2,clock:()=>"2026-11-27"});
 const state=await newer.request("/state");assert.equal(state.clients.length,449);assert.equal(state.team.length,3);
 assert.equal(state.clients.find(c=>c.id===original.id).data.nombre,"Conservar edición");
 assert.equal((await createDemoStore({storage,seed:demoSeed,seedRevision:2,clock:()=>"2026-11-27"}).request("/state")).clients.length,449);
 const fresh=createDemoStore({storage:memory(),seed:demoSeed,seedRevision:2,clock:()=>"2026-11-27"});
 const s=await fresh.request("/state");assert(s.plans.length>0);assert(s.visits.some(v=>v.duration!==60));assert(s.visits.some(v=>v.status==="confirmed"));
 let r=queryClients(s.clients,s.visits,{month:"2027-01",locality:"Madrid",pageSize:10,page:2});assert.equal(r.page,2);assert.equal(r.rows.length,10);assert(r.rows.every(c=>nextDue(c.data).startsWith("2027-01")&&c.data.direccion.localidad==="Madrid"));
 const first=queryClients(s.clients,s.visits,{month:"2027-01",locality:"Madrid",pageSize:10,page:1});assert(!first.rows.some(c=>r.rows.some(x=>x.id===c.id)));
 r=queryClients(s.clients,s.visits,{query:"alvaro"});assert(r.total>0);assert(r.rows.every(c=>c.data.nombre.startsWith("Álvaro")));
 r=queryClients(s.clients,s.visits,{status:"assigned"});assert(r.total>0);assert(r.rows.every(c=>s.visits.some(v=>v.client_id===c.id&&["planned","confirmed"].includes(v.status))));
 await fresh.request("/weekly/config",{method:"PUT",body:{...defaultWeeklySettings(s.userId),weeksAhead:1,capacity:6,minutes:480,technicianIds:s.team.map(t=>t.user_id),origin:[-3.7,40.4],destination:[-3.7,40.4]}});
 const run=await fresh.request("/weekly/draft",{method:"POST"});assert(run.payload.assignedCount>0);
 const before=s.plans.length;assert.equal((await fresh.request("/state")).plans.length,before);
 const approval=await fresh.request(`/weekly/runs/${run.id}/approve`,{method:"POST",body:{revision:run.revision}});assert.equal(approval.applied,run.payload.assignedCount);
 assert.equal((await fresh.request(`/weekly/runs/${run.id}/approve`,{method:"POST",body:{revision:run.revision}})).applied,0);
});
