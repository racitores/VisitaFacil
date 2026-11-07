export const MAX_PARADAS = 14;

// Los índices 0 y n+1 son fijos. La matriz puede ser asimétrica y contener tramos sin conexión.
export function optimizarOrden(distancias) {
  const count = distancias.length - 2;
  const end = count + 1;
  if (count < 1 || count > MAX_PARADAS) throw new RangeError('Número de paradas fuera de rango');
  const subsets = 1 << count;
  const costs = new Float64Array(subsets * count).fill(Infinity);
  const previous = new Int8Array(subsets * count).fill(-1);
  for (let j = 0; j < count; j++) costs[(1 << j) * count + j] = distancias[0][j + 1] ?? Infinity;

  for (let mask = 1; mask < subsets; mask++) {
    for (let last = 0; last < count; last++) {
      const cost = costs[mask * count + last];
      if (!Number.isFinite(cost)) continue;
      for (let next = 0; next < count; next++) {
        const bit = 1 << next;
        if (mask & bit) continue;
        const index = (mask | bit) * count + next;
        const nextCost = cost + (distancias[last + 1][next + 1] ?? Infinity);
        if (nextCost < costs[index]) {
          costs[index] = nextCost;
          previous[index] = last;
        }
      }
    }
  }

  let mask = subsets - 1;
  let best = Infinity;
  let last = -1;
  for (let j = 0; j < count; j++) {
    const cost = costs[mask * count + j] + (distancias[j + 1][end] ?? Infinity);
    if (cost < best) {
      best = cost;
      last = j;
    }
  }
  if (last === -1) return null;

  const order = [end];
  while (last !== -1) {
    order.push(last + 1);
    const preceding = previous[mask * count + last];
    mask ^= 1 << last;
    last = preceding;
  }
  order.push(0);
  return order.reverse();
}
