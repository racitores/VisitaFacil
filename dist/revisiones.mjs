import { actualizarParadas } from './ruta.mjs';
import { vencimientosAnuales } from './vencimientos.mjs';

const month = document.querySelector('#review-month');
const year = document.querySelector('#review-year');
const list = document.querySelector('#review-list');
const status = document.querySelector('#review-status');
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

  function render() {
    const prefix = year.value + '-' + month.value.padStart(2, '0') + '-';
    const matches = dueDates.filter(item => item.fecha.startsWith(prefix));
    status.textContent = matches.length
      ? matches.length + (matches.length === 1 ? ' cliente pendiente' : ' clientes pendientes')
      : 'No hay revisiones pendientes para este mes.';
    const included = new Set(matches.map(({ cliente }) => cliente.id));
    function updateRoute() {
      actualizarParadas(matches.map(({ cliente }) => cliente).filter(cliente => included.has(cliente.id)));
    }
    function selectClient(id, checked) {
      if (checked) included.add(id);
      else included.delete(id);
      updateRoute();
    }
    list.replaceChildren(...matches.map(item => reviewItem(item, selectClient)));
    updateRoute();
  }

  month.addEventListener('change', render);
  year.addEventListener('change', render);
  render();
  month.disabled = false;
  year.disabled = false;
} catch (error) {
  status.textContent = 'No se pudo cargar el listado. Recarga la página para volver a intentarlo.';
  console.error(error);
}
