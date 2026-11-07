import { actualizarParadas } from './ruta.mjs';
import { MAX_PARADAS } from './optimizacion.mjs';
import { agruparVisitas } from './zonas.mjs';
import { vencimientosAnuales } from './vencimientos.mjs';

const month = document.querySelector('#review-month');
const year = document.querySelector('#review-year');
const list = document.querySelector('#review-list');
const status = document.querySelector('#review-status');
const limit = document.querySelector('#zone-limit');
const zoneStatus = document.querySelector('#zone-status');
const zoneMissing = document.querySelector('#zone-missing');
const zoneList = document.querySelector('#zone-list');
const routeTitle = document.querySelector('#route-title');
const routeScope = document.querySelector('#route-scope');
const routeReset = document.querySelector('#route-reset');
const reviewDetails = document.querySelector('#review-details');
const dateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' });
const currentPeriod = new Intl.DateTimeFormat('es-ES', {
  month: 'numeric', year: 'numeric', timeZone: 'Europe/Madrid'
}).formatToParts(new Date());
const currentMonth = Number(currentPeriod.find(part => part.type === 'month').value);
const currentYear = Number(currentPeriod.find(part => part.type === 'year').value);

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function reviewItem({ cliente, ultimaRevision, fecha }, onSelection) {
  const item = element('li', undefined, 'review-row');
  const summary = element('div');
  const name = element('h3', cliente.nombre);
  const place = cliente.direccion;
  const address = [place.via, place.pisoPuerta, place.codigoPostal + ' ' + place.localidad]
    .filter(Boolean).join(', ');
  const contacts = element('p', undefined, 'review-contact');
  if (cliente.telefono) {
    const phone = element('a', cliente.telefono);
    phone.href = 'tel:' + cliente.telefono.replace(/[^+\d]/g, '');
    contacts.append(phone);
  }
  if (cliente.email) {
    const email = element('a', cliente.email);
    email.href = 'mailto:' + encodeURI(cliente.email);
    contacts.append(email);
  }
  summary.append(name, element('p', address), contacts);

  const due = element('div', undefined, 'review-due');
  const time = element('time', dateFormat.format(new Date(fecha)));
  time.dateTime = fecha;
  const lastDate = dateFormat.format(new Date(ultimaRevision || cliente.fechaAlta));
  due.append(
    element('span', 'Vence', 'eyebrow'),
    time,
    element('small', (ultimaRevision ? 'Última revisión · ' : 'Alta · ') + lastDate)
  );

  const checkbox = element('input');
  checkbox.type = 'checkbox';
  checkbox.checked = true;
  checkbox.setAttribute('aria-label', 'Incluir a ' + cliente.nombre + ' en la ruta');
  checkbox.addEventListener('change', () => onSelection(cliente.id, checkbox.checked));
  item.append(checkbox, summary, due);
  return item;
}

function renderZones(clientes) {
  const { grupos, sinCoordenadas } = agruparVisitas(clientes, Number(limit.value));
  zoneStatus.textContent = grupos.length
    ? grupos.length + (grupos.length === 1 ? ' jornada propuesta' : ' jornadas propuestas')
    : 'No hay visitas con ubicación para agrupar.';
  zoneMissing.textContent = sinCoordenadas.length
    ? 'Sin coordenadas para agrupar: ' + sinCoordenadas.map(({ nombre }) => nombre).join(', ')
      + '. Puedes incluirlos en una ruta manual desde el listado.'
    : '';
  zoneMissing.hidden = !sinCoordenadas.length;
  zoneList.replaceChildren(...grupos.map((grupo, index) => {
    const dia = 'Día ' + (index + 1);
    const municipios = [...new Set(grupo.map(({ direccion }) => direccion.localidad))].join(', ');
    const item = element('li', undefined, 'zone-card');
    const visits = grupo.length + (grupo.length === 1 ? ' visita' : ' visitas');
    const clients = element('ul', undefined, 'zone-clients');
    for (const cliente of grupo) {
      clients.append(element('li', cliente.nombre + ' · ' + cliente.direccion.localidad));
    }
    const button = element('button', 'Cargar ruta', 'zone-button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Cargar ruta del ' + dia.toLowerCase());
    button.addEventListener('click', () => {
      actualizarParadas(grupo);
      routeScope.textContent = dia + ' · ' + municipios;
      routeReset.hidden = false;
      routeTitle.focus();
      routeTitle.scrollIntoView({ block: 'start' });
    });
    item.append(element('h3', dia + ' · ' + visits), element('p', municipios), clients, button);
    return item;
  }));
}

try {
  const response = await fetch(new URL('./clientes.json', import.meta.url));
  if (!response.ok) throw new Error('No se pudo leer clientes.json');
  const { clientes } = await response.json();
  const dueDates = vencimientosAnuales(clientes);
  const years = [...new Set([currentYear, ...dueDates.map(item => Number(item.fecha.slice(0, 4)))])]
    .sort((a, b) => a - b);
  for (let i = 1; i <= 12; i++) {
    month.add(new Option(monthFormat.format(new Date(Date.UTC(2000, i - 1, 1))), i));
  }
  for (const value of years) year.add(new Option(value, value));
  month.value = currentMonth;
  year.value = currentYear;
  for (let i = 1; i <= MAX_PARADAS; i++) limit.add(new Option(i, i));
  limit.value = '5';
  let selected = [];

  function resetRoute() {
    actualizarParadas(selected);
    routeScope.textContent = 'Selección del mes';
    routeReset.hidden = true;
  }

  function updatePlan() {
    renderZones(selected);
    resetRoute();
  }

  function render() {
    const prefix = year.value + '-' + month.value.padStart(2, '0') + '-';
    const matches = dueDates.filter(item => item.fecha.startsWith(prefix));
    status.textContent = matches.length
      ? matches.length + (matches.length === 1 ? ' cliente pendiente' : ' clientes pendientes')
      : 'No hay revisiones pendientes para este mes.';
    const included = new Set(matches.map(({ cliente }) => cliente.id));
    function updateRoute() {
      selected = matches.map(({ cliente }) => cliente).filter(cliente => included.has(cliente.id));
      updatePlan();
    }
    function selectClient(id, checked) {
      if (checked) included.add(id);
      else included.delete(id);
      updateRoute();
    }
    reviewDetails.open = matches.length <= 8;
    list.replaceChildren(...matches.map(item => reviewItem(item, selectClient)));
    updateRoute();
  }

  month.addEventListener('change', render);
  year.addEventListener('change', render);
  limit.addEventListener('change', updatePlan);
  routeReset.addEventListener('click', () => {
    resetRoute();
    routeTitle.focus();
  });
  render();
  limit.disabled = false;
  month.disabled = false;
  year.disabled = false;
} catch (error) {
  status.textContent = 'No se pudo cargar el listado. Recarga la página para volver a intentarlo.';
  console.error(error);
}
