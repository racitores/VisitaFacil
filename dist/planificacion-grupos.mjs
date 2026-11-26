import { agruparVisitas } from "./zonas.mjs";
import { available, coordinates } from "./planificacion-domain.mjs";
const dayAfter = (day) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
// Reuse the existing dynamic geographic partition. Capacity, durations and
// customer availability are applied before any proposal is persisted.
export function groupSchedule({
  visits,
  clients,
  capacity,
  minutes,
  start,
  occupied = [],
}) {
  const eligible = visits.filter((v) =>
    coordinates(clients.find((c) => c.id === v.client_id)),
  );
  const rows = eligible.map((v) => ({
    ...clients.find((c) => c.id === v.client_id).data,
    id: v.id,
  }));
  const { grupos } = agruparVisitas(rows, capacity);
  const used = new Set(occupied),
    plans = [],
    remaining = new Set(visits.map((v) => v.id));
  let cursor = start;
  for (const group of grupos) {
    let pending = group.map((c) => visits.find((v) => v.id === c.id));
    for (
      let searched = 0;
      pending.length && searched < 90;
      searched++, cursor = dayAfter(cursor)
    ) {
      const weekday = new Date(`${cursor}T12:00:00Z`).getUTCDay();
      if (used.has(cursor) || weekday === 0 || weekday === 6) continue;
      let duration = 0;
      const selected = [];
      for (const v of pending) {
        if (
          !available(v, cursor) ||
          selected.length >= capacity ||
          duration + v.duration > minutes
        )
          continue;
        // Overdue reviews may be recovered; future reviews stay before their due day.
        if (v.due_date >= start && cursor > v.due_date) continue;
        selected.push(v);
        duration += v.duration;
      }
      if (!selected.length) continue;
      plans.push({ day: cursor, visitIds: selected.map((v) => v.id) });
      used.add(cursor);
      selected.forEach((v) => remaining.delete(v.id));
      pending = pending.filter((v) => !selected.includes(v));
    }
  }
  return { plans, remaining: [...remaining] };
}
