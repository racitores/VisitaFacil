const search = document.querySelector('#search');
const list = document.querySelector('#clients');
const detail = document.querySelector('#detail');
const status = document.querySelector('#status');
const dateFormat = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});
const byName = new Intl.Collator('es', { sensitivity: 'base' });
let clients = [];
let selectedId;

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function normalize(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function fullAddress({ via, pisoPuerta, codigoPostal, localidad, provincia, pais }) {
  return [via, pisoPuerta, [codigoPostal, localidad].filter(Boolean).join(' '), provincia, pais]
    .filter(Boolean).join(', ');
}

function dateElement(date) {
  const time = element('time', dateFormat.format(new Date(date)));
  time.dateTime = date;
  return time;
}

function infoField(label, value, className) {
  const field = element('div', undefined, className);
  const description = element('dd');
  description.append(value);
  field.append(element('dt', label), description);
  return field;
}

function contact(value, protocol) {
  if (!value) return 'Sin registrar';
  const link = element('a', value);
  const target = protocol === 'tel' ? value.replace(/[^+\d]/g, '') : encodeURI(value);
  link.href = protocol + ':' + target;
  return link;
}

function renderDetail(client) {
  if (!client) {
    detail.replaceChildren(element('p', 'Selecciona un cliente para ver su ficha.', 'empty'));
    return;
  }

  const info = element('dl', undefined, 'info');
  info.append(
    infoField('Teléfono', contact(client.telefono, 'tel')),
    infoField('Correo electrónico', contact(client.email, 'mailto')),
    infoField('Fecha de alta', dateElement(client.fechaAlta)),
    infoField('Dirección completa', fullAddress(client.direccion), 'address')
  );

  const historyHead = element('div', undefined, 'history-head');
  const reviews = [...client.revisiones].sort((a, b) => b.fecha.localeCompare(a.fecha));
  historyHead.append(
    element('h3', 'Historial de revisiones'),
    element('span', reviews.length + (reviews.length === 1 ? ' revisión' : ' revisiones'), 'count')
  );

  const timeline = element('ol', undefined, 'timeline');
  for (const review of reviews) {
    const entry = element('li');
    entry.append(dateElement(review.fecha), element('p', review.descripcion));
    timeline.append(entry);
  }

  detail.replaceChildren(
    element('p', client.id, 'eyebrow'),
    element('h2', client.nombre),
    info,
    historyHead,
    reviews.length ? timeline : element('p', 'Este cliente aún no tiene revisiones registradas.', 'empty')
  );
}

function clientItem(client) {
  const item = element('li');
  const button = element('button', undefined, 'client-button');
  button.type = 'button';
  button.setAttribute('aria-controls', 'detail');
  button.setAttribute('aria-pressed', String(client.id === selectedId));
  const initials = client.nombre.split(/\s+/).slice(0, 2).map(word => word[0]).join('');
  const avatar = element('span', initials, 'avatar');
  avatar.setAttribute('aria-hidden', 'true');
  const label = element('span');
  label.append(element('strong', client.nombre), element('small', client.direccion.localidad));
  const chevron = element('span', '›', 'chevron');
  chevron.setAttribute('aria-hidden', 'true');
  button.append(avatar, label, chevron);
  button.addEventListener('click', () => {
    selectedId = client.id;
    list.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-pressed', 'true');
    renderDetail(client);
    if (matchMedia('(max-width: 720px)').matches) detail.focus();
  });
  item.append(button);
  return item;
}

function renderDirectory() {
  const query = normalize(search.value);
  const phoneQuery = query.replace(/\s/g, '');
  const matches = clients.filter(client => {
    const searchable = normalize([client.nombre, client.telefono, fullAddress(client.direccion)].join(' '));
    const phone = (client.telefono ?? '').replace(/[^+\d]/g, '');
    return searchable.includes(query) || (/^\+?\d+$/.test(phoneQuery) && phone.includes(phoneQuery));
  });

  const selected = matches.find(client => client.id === selectedId) ?? matches[0];
  selectedId = selected?.id;
  const count = matches.length + (matches.length === 1 ? ' cliente' : ' clientes');
  status.textContent = query && !matches.length ? 'Sin resultados para esa búsqueda.' : count;
  list.replaceChildren(...matches.map(clientItem));
  renderDetail(selected);
}

try {
  const response = await fetch(new URL('./clientes.json', import.meta.url));
  if (!response.ok) throw new Error('No se pudo leer clientes.json');
  const data = await response.json();
  clients = data.clientes.sort((a, b) => byName.compare(a.nombre, b.nombre));
  search.disabled = false;
  search.addEventListener('input', renderDirectory);
  renderDirectory();
} catch (error) {
  search.disabled = true;
  list.replaceChildren();
  status.textContent = 'No se pudo cargar el directorio.';
  detail.replaceChildren(element('p', 'Recarga la página para volver a intentarlo.', 'empty'));
  console.error(error);
}
