import { MAX_PARADAS, optimizarOrden } from './optimizacion.mjs';
import { coordenadasCliente } from './zonas.mjs';

const form = document.querySelector('#route-form');
const origin = document.querySelector('#route-origin');
const destination = document.querySelector('#route-destination');
const gps = document.querySelector('#route-gps');
const gpsStatus = document.querySelector('#route-gps-status');
const remember = document.querySelector('#route-remember');
const submit = document.querySelector('#route-submit');
const count = document.querySelector('#route-count');
const status = document.querySelector('#route-status');
const result = document.querySelector('#route-result');
const storageKey = 'caldera-ruta';
const km = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const geocoded = new Map();
let stops = [];
let activeRequest;
let gpsRequest = 0;
let lastRoutingRequest = -Infinity;

function readEndpoints() {
  try {
    return JSON.parse(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

const saved = readEndpoints();
remember.checked = saved?.remember !== false;
const initial = new URLSearchParams(location.hash.slice(1)).get('base')?.trim();
if (initial) {
  origin.value = destination.value = initial.slice(0, 200);
  history.replaceState(history.state, '', location.pathname + location.search + '#planificador');
  saveEndpoints();
} else {
  origin.value = saved?.origin ?? '';
  destination.value = saved?.destination ?? '';
}

function saveEndpoints() {
  try {
    if (remember.checked) {
      localStorage.setItem(storageKey, JSON.stringify({ origin: origin.value, destination: destination.value }));
    } else {
      localStorage.setItem(storageKey, JSON.stringify({ remember: false }));
    }
  } catch {
    // Se mantienen los valores del formulario durante esta sesión.
  }
}

function invalidate() {
  activeRequest?.abort();
  activeRequest = undefined;
  result.replaceChildren();
  status.textContent = '';
  submit.disabled = stops.length === 0 || stops.length > MAX_PARADAS;
}

export function actualizarParadas(clientes) {
  stops = clientes;
  count.textContent = clientes.length > MAX_PARADAS
    ? 'Carga una jornada o selecciona un máximo de ' + MAX_PARADAS + ' visitas.'
    : clientes.length + (clientes.length === 1 ? ' visita seleccionada' : ' visitas seleccionadas');
  invalidate();
}

async function requestJson(url, signal, error) {
  try {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    if (response.ok) return await response.json();
  } catch {
    signal.throwIfAborted();
  }
  throw new Error(error);
}

function validPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
    && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\bav(?:da|enida)?\b/g, 'avenida').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function searchAddress(query, signal) {
  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams({ q: query, limit: '8' });
  return requestJson(url, signal, 'No se pudo consultar el servicio de direcciones. Puedes introducir coordenadas.');
}

export async function localizarDireccion(address, signal = AbortSignal.timeout(15000), allowApproximation = false) {
  signal.throwIfAborted();
  const entered = address.trim();
  const coord = entered.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (coord) {
    const point = [Number(coord[2]), Number(coord[1])];
    if (!validPoint(point)) throw new Error('Coordenadas fuera de rango: ' + entered);
    return { point, label: entered };
  }

  const key = JSON.stringify([entered, allowApproximation]);
  if (geocoded.has(key)) return geocoded.get(key);

  const query = entered.replace(/\bav(?:da)?\.?\s+/i, 'Avenida ');
  const [firstPart, ...area] = query.split(',');
  const house = firstPart.match(/\b(\d+[a-z]?)\s*$/i);
  const streetName = house ? firstPart.slice(0, house.index).trim() : firstPart;
  const street = normalize(streetName);
  const postcode = query.match(/\b\d{5}\b/)?.[0];

  function matchesArea({ geometry, properties: p }) {
    return validPoint(geometry?.coordinates) && p && (!postcode || !p.postcode || p.postcode === postcode);
  }

  function matchesStreet(value) {
    const matchedStreet = normalize(value);
    return street && matchedStreet && (matchedStreet === street
      || matchedStreet.endsWith(' ' + street) || street.endsWith(' ' + matchedStreet));
  }

  const data = await searchAddress(query, signal);
  let match = data.features?.find(feature => {
    if (!matchesArea(feature)) return false;
    const p = feature.properties;
    return house
      ? normalize(p.housenumber) === normalize(house[1]) && matchesStreet(p.street)
      : !area.length || matchesStreet(p.street || p.name) || normalize(p.name).includes(street);
  });

  let approximate = false;
  if (!match && house && allowApproximation && area.length) {
    const place = area.map(value => value.replace(/\b\d{5}\b/, '').trim()).filter(Boolean)[0];
    if (place) {
      const nearby = await searchAddress(streetName + ', ' + place, signal);
      match = nearby.features?.find(feature => matchesArea(feature)
        && feature.properties.type === 'street' && matchesStreet(feature.properties.name));
      approximate = Boolean(match);
    }
  }
  if (!match) {
    throw new Error('No se encontró una ubicación precisa para «' + entered + '». Revisa la dirección o introduce sus coordenadas.');
  }
  const p = match.properties;
  const label = [[p.street, p.housenumber].filter(Boolean).join(' ') || p.name, p.postcode, p.city || p.district]
    .filter(Boolean).join(', ');
  const found = {
    point: match.geometry.coordinates,
    label: (label || entered) + (approximate ? ' · punto aproximado de la calle (portal sin verificar)' : '')
  };
  geocoded.set(key, found);
  return found;
}

function clientAddress({ via, codigoPostal, localidad, provincia, pais }) {
  return [via.replace(/,\s*(?=\d)/, ' '), [codigoPostal, localidad].filter(Boolean).join(' '), provincia, pais].filter(Boolean).join(', ');
}

function node(tag, content) {
  const item = document.createElement(tag);
  item.textContent = content;
  return item;
}

function renderRoute(points, order, distances, durations) {
  let meters = 0;
  let seconds = 0;
  const items = document.createElement('ol');
  items.className = 'route-stops';
  const comparison = points.slice(1).reduce((total, _, index) => (
    total + (distances[index][index + 1] ?? Infinity)
  ), 0);

  for (const [i, index] of order.entries()) {
    const point = points[index];
    const item = document.createElement('li');
    item.append(node('strong', point.name), node('div', point.label));
    if (i > 0) {
      const from = order[i - 1];
      const leg = distances[from][index];
      meters += leg;
      seconds += durations[from][index];
      item.append(node('small', km.format(leg / 1000) + ' km desde la parada anterior'));
    }
    items.append(item);
  }

  const summary = node('p', km.format(meters / 1000) + ' km · ' + Math.round(seconds / 60) + ' min de conducción estimados');
  summary.className = 'route-total';
  const parts = [summary];
  if (Number.isFinite(comparison) && comparison - meters >= 50) {
    parts.push(node('p', km.format((comparison - meters) / 1000) + ' km menos que en el orden del listado.'));
  }
  result.replaceChildren(...parts, items);
}

gps.addEventListener('click', () => {
  if (!navigator.geolocation) {
    gpsStatus.textContent = 'Este navegador no puede usar la ubicación. Introduce el origen a mano.';
    return;
  }
  const request = ++gpsRequest;
  gps.disabled = true;
  gpsStatus.textContent = 'Buscando tu ubicación…';

  navigator.geolocation.getCurrentPosition(({ coords }) => {
    if (request !== gpsRequest) return;
    origin.value = coords.latitude.toFixed(5) + ', ' + coords.longitude.toFixed(5);
    invalidate();
    saveEndpoints();
    gps.disabled = false;
    gpsStatus.textContent = 'Ubicación añadida como origen.';
  }, error => {
    if (request !== gpsRequest) return;
    gps.disabled = false;
    gpsStatus.textContent = error.code === 1
      ? 'Permite el acceso a la ubicación o introduce el origen a mano.'
      : 'No se pudo obtener tu ubicación. Inténtalo de nuevo o introduce el origen a mano.';
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
});

form.addEventListener('input', event => {
  if (event.target === remember) {
    saveEndpoints();
    return;
  }
  if (event.target === origin) {
    gpsRequest++;
    gps.disabled = false;
    gpsStatus.textContent = '';
  }
  invalidate();
});

origin.addEventListener('change', saveEndpoints);
destination.addEventListener('change', saveEndpoints);

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  const start = origin.value.trim();
  const finish = destination.value.trim() || start;
  if (!start) {
    status.textContent = 'Introduce una dirección o unas coordenadas de origen.';
    return;
  }
  saveEndpoints();
  invalidate();
  const controller = new AbortController();
  const { signal } = controller;
  activeRequest = controller;
  submit.disabled = true;
  status.textContent = 'Localizando las paradas y calculando la ruta…';

  try {
    const first = await localizarDireccion(start, signal, true);
    const last = finish === start ? first : await localizarDireccion(finish, signal, true);
    const points = [{ ...first, name: 'Origen' }];
    for (const client of stops) {
      const address = clientAddress(client.direccion);
      const point = coordenadasCliente(client);
      const place = client.direccion;
      const label = place.coordenadas
        ? place.via + ', ' + place.codigoPostal + ' ' + place.localidad
        : 'Punto aproximado en ' + place.localidad;
      const location = point ? { point, label } : await localizarDireccion(address, signal);
      points.push({ ...location, name: client.nombre });
    }
    points.push({ ...last, name: 'Destino' });
    const coordinates = points.map(({ point }) => point.join(',')).join(';');
    const url = 'https://routing.openstreetmap.de/routed-car/table/v1/driving/' + coordinates
      + '?annotations=distance,duration&generate_hints=false';
    const wait = 1050 - (performance.now() - lastRoutingRequest);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    signal.throwIfAborted();
    lastRoutingRequest = performance.now();
    const data = await requestJson(url, signal, 'El servicio de rutas no está disponible. Inténtalo de nuevo en unos segundos.');
    signal.throwIfAborted();
    if (data.code !== 'Ok' || !data.distances || !data.durations) {
      throw new Error('No se pudieron obtener las distancias por carretera de estas paradas.');
    }
    const order = optimizarOrden(data.distances);
    if (!order) throw new Error('No hay una ruta por carretera que conecte todas las paradas.');
    renderRoute(points, order, data.distances, data.durations);
    status.textContent = 'Ruta calculada.';
  } catch (error) {
    if (!signal.aborted) status.textContent = error.message;
  } finally {
    if (activeRequest === controller) {
      activeRequest = undefined;
      submit.disabled = false;
    }
  }
});
