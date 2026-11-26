import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDue, bestSuggestion, available, date } from "../server/domain.mjs";
import { groupSchedule } from "../server/grouping.mjs";
const clients = [
  { id: "a", data: { direccion: { coordenadas: [-3.7, 40.4] } } },
  { id: "b", data: { direccion: { coordenadas: [-3.71, 40.41] } } },
  { id: "c", data: { direccion: { coordenadas: [-4.1, 40.9] } } },
];
const v = {
  id: "va",
  client_id: "a",
  due_date: "2030-12-31",
  duration: 60,
  availability: { weekdays: [1, 2, 3, 4, 5] },
  status: "pool",
};
const plan = {
  id: "p",
  day: "2030-11-25",
  name: "Centro",
  origin: [-3.7, 40.4],
  destination: [-3.7, 40.4],
  capacity: 2,
  minutes: 120,
};
test("annual review handles leap day and latest intervention", () => {
  assert.equal(
    nextDue({ fechaAlta: "2024-02-29", revisiones: [] }),
    "2025-02-28",
  );
  assert.equal(
    nextDue({ fechaAlta: "2020-01-01", revisiones: [{ fecha: "2026-06-13" }] }),
    "2027-06-13",
  );
  assert.throws(() => date("2026-02-30"));
});
test("single suggestion respects completed occupancy, capacity, availability and deadlines", () => {
  const far = {
    ...plan,
    id: "far",
    origin: [-4.5, 41],
    destination: [-4.5, 41],
  };
  assert.equal(
    bestSuggestion(v, [far, plan], [], clients, "2030-11-01").planId,
    "p",
  );
  assert.equal(
    bestSuggestion(
      { ...v, availability: { excluded: [plan.day] } },
      [plan],
      [],
      clients,
      "2030-11-01",
    ),
    null,
  );
  assert.equal(
    bestSuggestion(
      v,
      [{ ...plan, capacity: 1 }],
      [{ ...v, id: "occupied", plan_id: "p", status: "completed" }],
      clients,
      "2030-11-01",
    ),
    null,
  );
  assert.equal(
    bestSuggestion({ ...v, duration: 121 }, [plan], [], clients, "2030-11-01"),
    null,
  );
  assert.equal(
    bestSuggestion(
      { ...v, due_date: "2030-11-20" },
      [plan],
      [],
      clients,
      "2030-11-01",
    ),
    null,
  );
  assert.equal(
    bestSuggestion(
      { ...v, due_date: "2030-10-20" },
      [plan],
      [],
      clients,
      "2030-11-01",
    ).overdue,
    true,
  );
});
test("dynamic grouping honors days, durations, missing coordinates, occupied days and uniqueness", () => {
  const visits = [
    v,
    { ...v, id: "vb", client_id: "b", availability: { from: "2030-11-27" } },
    { ...v, id: "vc", client_id: "c" },
    { ...v, id: "missing", client_id: "missing" },
  ];
  const result = groupSchedule({
    visits,
    clients: [...clients, { id: "missing", data: { direccion: {} } }],
    capacity: 2,
    minutes: 60,
    start: "2030-11-25",
    occupied: ["2030-11-25"],
  });
  assert.equal(result.plans.length, 3);
  assert.deepEqual(result.remaining, ["missing"]);
  assert.equal(new Set(result.plans.flatMap((p) => p.visitIds)).size, 3);
  for (const p of result.plans) {
    assert.notEqual(p.day, "2030-11-25");
    assert.equal(p.visitIds.length, 1);
    for (const id of p.visitIds)
      assert(
        available(
          visits.find((v) => v.id === id),
          p.day,
        ),
      );
  }
});
