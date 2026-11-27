export const businessToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function assert(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
export function date(value) {
  assert(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "Fecha inválida.",
  );
  return value;
}
export function point(value) {
  assert(
    Array.isArray(value) &&
      value.length === 2 &&
      value.every(Number.isFinite) &&
      Math.abs(value[0]) <= 180 &&
      Math.abs(value[1]) <= 90,
    "Introduce coordenadas válidas: longitud, latitud.",
  );
  return value;
}
export function clientData(data) {
  assert(
    data &&
      typeof data.nombre === "string" &&
      data.nombre.trim().length > 0 &&
      data.nombre.length <= 200,
    "Nombre obligatorio (máximo 200 caracteres).",
  );
  assert(
    data.direccion &&
      typeof data.direccion.via === "string" &&
      data.direccion.via.trim(),
    "Dirección obligatoria.",
  );
  date(data.fechaAlta);
  assert(Array.isArray(data.revisiones ?? []), "Historial inválido.");
  for (const review of data.revisiones ?? []) {
    date(review.fecha);
    assert(
      typeof review.descripcion === "string" &&
        review.descripcion.length <= 5000,
      "Descripción inválida.",
    );
  }
  if (data.direccion.coordenadas) point(data.direccion.coordenadas);
  if (data.direccion.coordenadasDemo) point(data.direccion.coordenadasDemo);
  return {
    ...data,
    nombre: data.nombre.trim(),
    revisiones: data.revisiones ?? [],
  };
}
export function nextDue(data) {
  const latest = [data.fechaAlta, ...data.revisiones.map((x) => x.fecha)]
    .sort()
    .at(-1);
  const d = new Date(`${latest}T12:00:00Z`),
    month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
export function available(visit, day) {
  const a = visit.availability ?? {};
  return (
    (!a.from || day >= a.from) &&
    (!a.to || day <= a.to) &&
    (!a.weekdays?.length ||
      a.weekdays.includes(new Date(`${day}T12:00:00Z`).getUTCDay())) &&
    !(a.excluded ?? []).includes(day)
  );
}
export function validateAvailability(a = {}) {
  assert(
    a && typeof a === "object" && !Array.isArray(a),
    "Disponibilidad inválida.",
  );
  for (const k of ["from", "to"]) if (a[k]) date(a[k]);
  assert(
    !a.from || !a.to || a.from <= a.to,
    "El intervalo de disponibilidad está invertido.",
  );
  if (a.weekdays)
    assert(
      Array.isArray(a.weekdays) &&
        a.weekdays.every((x) => Number.isInteger(x) && x >= 0 && x <= 6),
      "Días de semana inválidos.",
    );
  if (a.excluded) {
    assert(Array.isArray(a.excluded), "Fechas excluidas inválidas.");
    a.excluded.forEach(date);
  }
  return a;
}
export function km(a, b) {
  const rad = (x) => (x * Math.PI) / 180,
    dlat = rad(b[1] - a[1]),
    dlon = rad(b[0] - a[0]);
  return (
    12742 *
    Math.asin(
      Math.sqrt(
        Math.sin(dlat / 2) ** 2 +
          Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dlon / 2) ** 2,
      ),
    )
  );
}
export function coordinates(client) {
  return (
    client.data.direccion.coordenadas ?? client.data.direccion.coordenadasDemo
  );
}
export function orderedRoute(plan, visits, clients) {
  const remaining = visits.map((v) => ({
    id: v.id,
    coordinates: coordinates(clients.find((c) => c.id === v.client_id)),
  }));
  if (remaining.some((x) => !x.coordinates)) return null;
  const route = [plan.origin],
    ids = [];
  while (remaining.length) {
    remaining.sort(
      (a, b) =>
        km(route.at(-1), a.coordinates) - km(route.at(-1), b.coordinates) ||
        a.id.localeCompare(b.id),
    );
    const next = remaining.shift();
    route.push(next.coordinates);
    ids.push(next.id);
  }
  route.push(plan.destination);
  return {
    ids,
    km: route.slice(1).reduce((sum, p, i) => sum + km(route[i], p), 0),
  };
}
export function bestSuggestion(visit, plans, visits, clients, today) {
  let best = null;
  for (const plan of plans) {
    const day =
      typeof plan.day === "string"
        ? plan.day.slice(0, 10)
        : plan.day.toISOString().slice(0, 10);
    const assigned = visits.filter(
      (v) => v.plan_id === plan.id && v.status !== "cancelled",
    );
    if (
      day < today ||
      (day > visit.due_date && visit.due_date >= today) ||
      !available(visit, day) ||
      assigned.length >= plan.capacity ||
      assigned.reduce((n, v) => n + v.duration, 0) + visit.duration >
        plan.minutes
    )
      continue;
    const before = orderedRoute(plan, assigned, clients),
      after = orderedRoute(plan, [...assigned, visit], clients);
    if (!before || !after) continue;
    const extraKm = Math.max(0, after.km - before.km);
    if (
      !best ||
      extraKm < best.extraKm ||
      (extraKm === best.extraKm && day < best.day)
    )
      best = {
        planId: plan.id,
        day,
        overdue: day > visit.due_date,
        name: plan.name,
        extraKm,
        orderedVisitIds: after.ids,
        method:
          "Distancia geográfica aproximada; sin tráfico ni tiempos por carretera.",
      };
  }
  return best;
}

export function excludeVisitDay(visit,day){date(day);return {...(visit.availability??{}),excluded:[...new Set([...(visit.availability?.excluded??[]),day])]};}
