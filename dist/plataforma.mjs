import { actualizarParadas, localizarDireccion } from "./ruta.mjs";
const $ = (s) => document.querySelector(s);
const escape = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const labels = {
  pool: "En bolsa",
  planned: "Planificada",
  proposed: "Propuesta enviada o pendiente de envío",
  confirmed: "Confirmada",
  completed: "Realizada",
  cancelled: "Cancelada",
};
let companyId = "",
  companies = [],
  state,
  tab = "agenda",
  editing,
  agendaDay = "",
  pendingMessage = "";
function notice(text, error = false) {
  $("#notice").textContent = text;
  $("#notice").classList.toggle("error", error);
}
async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(companyId ? { "X-Company-Id": companyId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Respuesta inválida del servidor." }));
  if (!response.ok)
    throw new Error(
      data.error?.message ??
        data.error ??
        data.message ??
        "No se pudo completar la operación.",
    );
  return data;
}
async function guard(fn) {
  try {
    await fn();
  } catch (e) {
    notice(e.message, true);
  }
}
function show(id) {
  for (const s of ["access", "reset", "companies", "workspace"])
    $(`#${s}`).hidden = s !== id;
  $("#route-container").hidden = true;
}
async function loadCompanies() {
  companies = await api("/companies");
  $("#logout").hidden = false;
  if (!companies.length) return chooseCompany();
  if (!companies.some((c) => c.id === companyId)) companyId = companies[0].id;
  $("#company-select").innerHTML = companies
    .map((c) => `<option value="${escape(c.id)}">${escape(c.name)}</option>`)
    .join("");
  $("#company-select").value = companyId;
  await refresh();
}
function chooseCompany() {
  show("companies");
  $("#company-list").innerHTML = companies
    .map(
      (c) =>
        `<button data-company="${escape(c.id)}">${escape(c.name)}</button>`,
    )
    .join(" ");
}
async function refresh() {
  state = await api("/state");
  show("workspace");
  render();
}
const client = (v) => state.clients.find((c) => c.id === v?.client_id);
const admin = () => state.role === "admin";
function visitCard(v) {
  const c = client(v);
  return `<article class="card"><h3>${escape(c?.data.nombre)}</h3><span class="badge">${escape(labels[v.status])}</span><p>${escape(c?.data.direccion.via)} · ${escape(c?.data.direccion.localidad)}</p><p>Vence: ${escape(v.due_date)} · ${v.duration} min</p>${v.reason ? `<p>${escape(v.reason)}</p>` : ""}<div class="actions">${admin() && !["completed", "cancelled"].includes(v.status) ? `<button data-action="assign" data-id="${v.id}">Asignar a día y grupo</button>${v.status === "pool" ? `<button data-action="suggest" data-id="${v.id}">Mejor opción</button><button data-action="availability" data-id="${v.id}">Disponibilidad</button>` : `<button data-action="confirm" data-id="${v.id}">Confirmar manualmente</button><button data-action="release" data-id="${v.id}">Devolver a bolsa</button><button data-action="propose" data-id="${v.id}" ${!state.whatsappConfigured ? "disabled" : ""}>Proponer por WhatsApp</button>`}<button data-action="cancel" data-id="${v.id}" class="danger">Cancelar revisión</button>` : ""}${v.plan_id && !["completed", "cancelled"].includes(v.status) ? `<button data-action="complete" data-id="${v.id}">Registrar intervención</button>` : ""}${admin() ? `<button data-action="history" data-id="${v.id}">Historial</button>` : ""}</div></article>`;
}
function render() {
  $("#tabs")
    .querySelectorAll("button")
    .forEach((b) => {
      b.setAttribute("aria-current", String(b.dataset.tab === tab));
      b.hidden =
        !admin() &&
        ["pool", "team", "messages", "clients"].includes(b.dataset.tab);
    });
  if (!admin() && tab !== "agenda") tab = "agenda";
  $("#route-container").hidden = true;
  const content = $("#content");
  if (tab === "clients") {
    content.innerHTML = `<div class="section-head"><h1>Clientes</h1><div class="actions"><button data-action="new-client">Añadir cliente</button><label>Importar JSON <input id="import" type="file" accept="application/json"></label></div></div><label>Buscar <input id="client-search" type="search" placeholder="Nombre, teléfono o dirección"></label><div id="client-cards" class="cards"></div>`;
    renderClients("");
  } else if (tab === "agenda") {
    if (!agendaDay)
      agendaDay =
        state.plans.find((p) => p.day >= today())?.day ??
        state.plans[0]?.day ??
        "";
    content.innerHTML = `<div class="section-head"><h1>Agenda</h1>${admin() ? '<button data-action="new-plan">Crear día y grupo</button>' : ""}</div>${admin() ? `<section class="panel"><h2>Preparar revisiones</h2><form id="generate-form" class="grid-form"><label>Vencimientos hasta <input name="until" type="date" value="${today()}" required></label><button>Detectar revisiones y enviar a bolsa</button></form><p class="muted">Incluye atrasadas. No duplica una revisión ya generada.</p><button data-action="auto-plan">Agrupar la bolsa por zonas y días</button></section>` : ""}<label>Mostrar día<select id="agenda-day"><option value="all">Todas las fechas</option>${[...new Set(state.plans.map((p) => p.day))].map((day) => `<option value="${escape(day)}" ${agendaDay === day ? "selected" : ""}>${escape(day)}</option>`).join("")}</select></label><div class="cards">${
      state.plans
        .filter((p) => agendaDay === "all" || p.day === agendaDay)
        .map((p) => {
          const visits = state.visits.filter((v) => v.plan_id === p.id);
          return `<article class="card"><h2>${escape(p.day)} · ${escape(p.name)}</h2><p>${escape(state.team.find((t) => t.user_id === p.technician_id)?.name)} · ${visits.length}/${p.capacity} visitas · ${visits.reduce((n, v) => n + v.duration, 0)}/${p.minutes} min</p><button data-action="route" data-id="${p.id}">Calcular ruta de este grupo</button>${visits.map(visitCard).join("") || "<p>Sin visitas asignadas.</p>"}</article>`;
        })
        .join("") ||
      '<p class="empty">Crea la primera jornada para empezar a asignar visitas.</p>'
    }</div>`;
  } else if (tab === "pool") {
    const visits = state.visits.filter((v) => v.status === "pool");
    content.innerHTML = `<h1>Bolsa de visitas <span class="badge">${visits.length}</span></h1><p>Visitas pendientes de día o que necesitan una nueva cita. La sugerencia devuelve una sola opción compatible; avisa si la revisión ya está vencida.</p><div class="cards">${visits.map(visitCard).join("") || '<p class="empty">No hay visitas pendientes de asignar.</p>'}</div>`;
  } else if (tab === "team") {
    content.innerHTML = `<h1>Equipo</h1><div class="cards">${state.team.map((t) => `<article class="card"><h3>${escape(t.name)}</h3><p>${escape(t.email)}</p><span class="badge">${t.role === "admin" ? "Administración" : "Técnico"}</span></article>`).join("")}</div><section class="panel"><h2>Invitar a una persona</h2><form id="invite-form" class="grid-form"><label>Correo <input name="email" type="email" required></label><label>Rol <select name="role"><option value="technician">Técnico</option><option value="admin">Administración</option></select></label><button>Crear invitación</button></form><p id="invite-result"></p><p class="muted">Comparte el código con esa persona. Deberá crear su cuenta con el correo invitado y aceptar la invitación. Caduca a los siete días.</p></section>`;
  } else if (tab === "messages") {
    content.innerHTML = `<h1>Citas por WhatsApp</h1><p>${state.whatsappConfigured ? "Integración configurada. Las propuestas se ponen en cola tras tu aprobación." : "Pendiente de conectar WhatsApp Business y sus plantillas. No se enviarán mensajes."}</p><button data-action="process-messages" ${state.whatsappConfigured ? "" : "disabled"}>Procesar cola pendiente</button><div id="message-list"></div>`;
    guard(async () => {
      const [list, reviews] = await Promise.all([
        api("/messages"),
        api("/messages/reviews"),
      ]);
      $("#message-list").innerHTML =
        reviews
          .map(
            (r) =>
              `<article class="card"><h3>Respuesta pendiente de revisar</h3><p>${escape(r.detail.text ?? "Respuesta a una cita anterior")}</p><p>${escape(state.clients.find((c) => c.id === r.detail.clientId)?.data.nombre ?? client(state.visits.find((v) => v.id === r.visit_id))?.data.nombre)}</p><button data-action="resolve" data-id="${r.id}">Marcar revisada</button></article>`,
          )
          .join("") +
          list
            .map(
              (m) =>
                `<article class="card"><strong>${escape(m.kind === "appointment" ? "Propuesta" : "Recordatorio")}</strong> · ${escape(m.state)}<p>${escape(client(state.visits.find((v) => v.id === m.visit_id))?.data.nombre)}</p><p>${escape(m.error ?? "")}</p>${m.state === "failed" ? `<button data-action="retry" data-id="${m.id}">Reintentar envío</button>` : ""}${m.state === "uncertain" ? `<button data-action="reconcile" data-id="${m.id}">Conciliar con Meta</button>` : ""}</article>`,
            )
            .join("") || "<p>Sin mensajes.</p>";
    });
  }
}
function renderClients(query) {
  const q = query.toLocaleLowerCase("es");
  $("#client-cards").innerHTML =
    state.clients
      .filter(
        (c) =>
          !c.archived &&
          JSON.stringify(c.data).toLocaleLowerCase("es").includes(q),
      )
      .map(
        (c) =>
          `<article class="card"><h3>${escape(c.data.nombre)}</h3><p>${escape(c.data.telefono)} · ${escape(c.data.email)}</p><p>${escape(c.data.direccion.via)}, ${escape(c.data.direccion.pisoPuerta)}<br>${escape(c.data.direccion.codigoPostal)} ${escape(c.data.direccion.localidad)}, ${escape(c.data.direccion.provincia)}</p><p>${escape(c.data.equipo ?? "Equipo sin registrar")}</p><p class="muted">Alta: ${escape(c.data.fechaAlta)} · WhatsApp: ${c.whatsapp_consent ? "autorizado" : "sin consentimiento"}</p><details><summary>Intervenciones (${c.data.revisiones.length})</summary>${c.data.revisiones.map((r) => `<p class="review-log">${escape(r.fecha)} · ${escape(r.descripcion)}</p>`).join("")}</details><div class="actions"><button data-action="edit-client" data-id="${c.id}">Editar</button><button data-action="archive" data-id="${c.id}">Archivar</button></div></article>`,
      )
      .join("") ||
    '<p class="empty">No hay clientes. Puedes añadirlos o importar el JSON.</p>';
}
function reviewFields(r = { fecha: today(), descripcion: "" }) {
  return `<div class="history-row"><label>Fecha<input data-review-date type="date" value="${escape(r.fecha)}" required></label><label>Trabajo realizado<textarea data-review-work required maxlength="5000">${escape(r.descripcion)}</textarea></label><button type="button" class="remove-review">Quitar intervención</button></div>`;
}
function field(name, label, value = "", type = "text", required = true) {
  return `<label>${escape(label)} <input name="${name}" type="${type}" value="${escape(value)}" ${required ? "required" : ""}></label>`;
}
function select(name, label, options) {
  return `<label>${label}<select name="${name}">${options.map(([v, t]) => `<option value="${escape(v)}">${escape(t)}</option>`).join("")}</select></label>`;
}
function modal(title, fields, save) {
  $("#editor-title").textContent = title;
  $("#editor-fields").innerHTML = fields;
  editing = save;
  $("#editor").showModal();
}
function pointInput(value) {
  const p = String(value).split(",").map(Number);
  if (p.length !== 2 || !p.every(Number.isFinite))
    throw new Error("Usa longitud, latitud.");
  return p;
}
function endpoints() {
  try {
    return (
      JSON.parse(localStorage.getItem("visitafacil-base")) ?? {
        origin: "Avenida de Cuba 34, Benalmádena, 29631 Málaga",
        destination: "",
      }
    );
  } catch {
    return { origin: "", destination: "" };
  }
}
const technicianOptions = () => state.team.map((t) => [t.user_id, t.name]);
async function action(name, id) {
  const v = state.visits.find((v) => v.id === id);
  if (name === "new-client" || name === "edit-client") {
    const row = state.clients.find((c) => c.id === id),
      c = row?.data ?? { direccion: {}, fechaAlta: today(), revisiones: [] };
    modal(
      row ? "Editar cliente" : "Nuevo cliente",
      field("nombre", "Nombre", c.nombre) +
        field("telefono", "Teléfono", c.telefono, "tel", false) +
        field("email", "Correo", c.email, "email", false) +
        field("via", "Calle y número", c.direccion.via) +
        field(
          "pisoPuerta",
          "Piso / puerta",
          c.direccion.pisoPuerta,
          "text",
          false,
        ) +
        field("codigoPostal", "Código postal", c.direccion.codigoPostal) +
        field("localidad", "Localidad", c.direccion.localidad) +
        field("provincia", "Provincia", c.direccion.provincia ?? "Madrid") +
        field(
          "coordinates",
          "Longitud, latitud (para rutas)",
          (c.direccion.coordenadas ?? c.direccion.coordenadasDemo ?? []).join(
            ",",
          ),
          "text",
          false,
        ) +
        '<button id="locate-client" type="button">Localizar esta dirección</button><p id="client-location" class="muted"></p>' +
        field("fechaAlta", "Fecha de alta", c.fechaAlta, "date") +
        field(
          "equipo",
          "Equipo / marca / modelo / número de serie",
          c.equipo,
          "text",
          false,
        ) +
        `<fieldset><legend>Historial de intervenciones</legend><div id="review-fields">${c.revisiones.map(reviewFields).join("")}</div><button type="button" id="add-review">Añadir intervención al historial</button></fieldset><label><input type="checkbox" name="consent" ${row?.whatsapp_consent ? "checked" : ""}> El cliente ha autorizado recibir citas por WhatsApp</label>`,
      async (f) => {
        const data = {
          ...c,
          nombre: f.nombre,
          telefono: f.telefono,
          email: f.email,
          fechaAlta: f.fechaAlta,
          equipo: f.equipo,
          revisiones: [
            ...$("#review-fields").querySelectorAll(".history-row"),
          ].map((row) => ({
            fecha: row.querySelector("[data-review-date]").value,
            descripcion: row.querySelector("[data-review-work]").value,
          })),
          whatsappConsent: f.consent === "on",
          direccion: {
            ...c.direccion,
            via: f.via,
            pisoPuerta: f.pisoPuerta,
            codigoPostal: f.codigoPostal,
            localidad: f.localidad,
            provincia: f.provincia,
            pais: "España",
          },
        };
        delete data.direccion.coordenadasDemo;
        delete data.direccion.coordenadas;
        if (f.coordinates)
          data.direccion.coordenadas = pointInput(f.coordinates);
        await api(`/clients${row ? "/" + id : ""}`, {
          method: row ? "PUT" : "POST",
          body: data,
        });
      },
    );
  } else if (name === "new-plan" || name === "auto-plan") {
    const base = endpoints();
    modal(
      name === "new-plan" ? "Crear jornada" : "Agrupar visitas por proximidad",
      field("day", "Primer día", today(), "date") +
        field("name", "Nombre del grupo", "Ruta") +
        select("technicianId", "Técnico", technicianOptions()) +
        field("capacity", "Visitas por día", 6, "number") +
        field(
          "minutes",
          "Minutos de trabajo por día (sin desplazamientos)",
          480,
          "number",
        ) +
        field("origin", "Origen: dirección o latitud, longitud", base.origin) +
        field(
          "destination",
          "Destino: dirección o latitud, longitud",
          base.destination,
          "text",
          false,
        ) +
        '<button type="button" id="plan-gps">Usar mi ubicación como origen</button><p class="muted">Base inicial: Avenida de Cuba 34, Benalmádena. Al guardar se recuerda el último origen y destino. Puedes usar el planificador para buscar una dirección.</p>',
      async (f) => {
        const origin = await localizarDireccion(f.origin, undefined, true);
        const destination = f.destination
          ? await localizarDireccion(f.destination, undefined, true)
          : origin;
        localStorage.setItem(
          "visitafacil-base",
          JSON.stringify({ origin: f.origin, destination: f.destination }),
        );
        const result = await api(
          name === "new-plan" ? "/plans" : "/plans/group",
          {
            method: "POST",
            body: {
              ...f,
              capacity: Number(f.capacity),
              minutes: Number(f.minutes),
              origin: origin.point,
              destination: destination.point,
            },
          },
        );
        agendaDay = "";
        pendingMessage =
          name === "auto-plan"
            ? `${result.assigned} visitas asignadas; ${result.remaining} siguen en bolsa. Origen: ${origin.label}`
            : `Jornada guardada. Origen: ${origin.label}`;
      },
    );
  } else if (name === "assign") {
    const plans = state.plans.filter((p) => p.day >= today());
    if (!plans.length) throw new Error("Crea primero un día y grupo.");
    modal(
      "Asignar visita",
      select(
        "planId",
        "Día y grupo",
        plans.map((p) => [p.id, `${p.day} · ${p.name}`]),
      ),
      (f) =>
        api(`/visits/${id}/action`, {
          method: "POST",
          body: { action: "assign", planId: f.planId },
        }),
    );
  } else if (name === "suggest") {
    const { suggestion: s } = await api(`/visits/${id}/suggestion`);
    if (!s)
      return notice(
        "No hay un grupo compatible. Revisa disponibilidad, coordenadas o capacidad.",
      );
    modal(
      "Mejor opción",
      `<p><strong>${escape(s.day)} · ${escape(s.name)}</strong></p>${s.overdue ? '<p class="danger">Revisión vencida: se recuperará fuera de plazo.</p>' : ""}<p>Desvío estimado: ${s.extraKm.toFixed(1)} km.</p><p>${escape(s.method)}</p>`,
      () =>
        api(`/visits/${id}/action`, {
          method: "POST",
          body: { action: "assign", planId: s.planId },
        }),
    );
  } else if (name === "availability") {
    modal(
      "Disponibilidad",
      field("from", "Desde", v.availability.from ?? today(), "date", false) +
        field("to", "Hasta", v.availability.to ?? "", "date", false) +
        field(
          "weekdays",
          "Días: 1 lunes, 2 martes… 0 domingo",
          (v.availability.weekdays ?? []).join(","),
          "text",
          false,
        ) +
        field(
          "excluded",
          "Fechas excluidas, separadas por coma",
          (v.availability.excluded ?? []).join(","),
          "text",
          false,
        ) +
        field("duration", "Duración estimada (min)", v.duration, "number"),
      (f) =>
        api(`/visits/${id}/action`, {
          method: "POST",
          body: {
            action: "availability",
            duration: Number(f.duration),
            availability: {
              ...(f.from ? { from: f.from } : {}),
              ...(f.to ? { to: f.to } : {}),
              weekdays: f.weekdays ? f.weekdays.split(",").map(Number) : [],
              excluded: f.excluded
                ? f.excluded.split(",").map((x) => x.trim())
                : [],
            },
          },
        }),
    );
  } else if (["release", "cancel"].includes(name)) {
    modal(
      name === "release"
        ? "Devolver a bolsa"
        : "Cancelar revisión definitivamente",
      field("reason", "Motivo"),
      (f) =>
        api(`/visits/${id}/action`, {
          method: "POST",
          body: { action: name, reason: f.reason },
        }),
    );
  } else if (name === "complete") {
    modal(
      "Registrar intervención",
      field("date", "Fecha", today(), "date") +
        '<label>Trabajo realizado<textarea name="work" required maxlength="5000"></textarea></label>',
      (f) =>
        api(`/visits/${id}/action`, {
          method: "POST",
          body: { action: "complete", ...f },
        }),
    );
  } else if (name === "confirm") {
    modal(
      "Confirmar cita manualmente",
      `<p>Confirma que ${escape(client(v).data.nombre)} ha aceptado el día asignado.</p>`,
      () =>
        api(`/visits/${id}/action`, {
          method: "POST",
          body: { action: "confirm" },
        }),
    );
  } else if (name === "propose") {
    modal(
      "Revisar propuesta de cita",
      `<p>Se enviará una propuesta de cita a <strong>${escape(client(v).data.nombre)}</strong>, ${escape(client(v).data.telefono)}.</p><p>Día: ${escape(state.plans.find((p) => p.id === v.plan_id)?.day)}. Podrá confirmar o solicitar otro día.</p>`,
      () => api(`/visits/${id}/propose`, { method: "POST", body: {} }),
    );
  } else if (name === "archive") {
    modal(
      "Archivar cliente",
      "<p>Se conservarán su historial y las intervenciones. Las revisiones sin asignar se cancelarán.</p>",
      () => api(`/clients/${id}`, { method: "DELETE" }),
    );
  } else if (name === "history") {
    const events = await api(`/visits/${id}/history`);
    modal(
      "Historial de la visita",
      events
        .map(
          (e) =>
            `<p>${escape(new Date(e.created_at).toLocaleString("es-ES"))} · ${escape(e.action)} · ${escape(JSON.stringify(e.detail))}</p>`,
        )
        .join("") || "<p>Sin cambios registrados.</p>",
      async () => {},
    );
  } else if (name === "process-messages") {
    const r = await api("/messages/process", { method: "POST", body: {} });
    render();
    notice(
      `${r.sent} mensajes aceptados por Meta; ${r.failed} con incidencia.`,
    );
  } else if (name === "resolve") {
    await api(`/messages/reviews/${id}/resolve`, { method: "POST", body: {} });
    render();
  } else if (name === "retry") {
    modal(
      "Reintentar mensaje",
      "<p>Se volverá a enviar el mensaje si la cita y el consentimiento siguen vigentes.</p>",
      () => api(`/messages/${id}/retry`, { method: "POST", body: {} }),
    );
  } else if (name === "reconcile") {
    modal(
      "Conciliar resultado con Meta",
      "<p>Comprueba primero el mensaje en Meta. Si fue aceptado, introduce su identificador. Solo marca rechazado si has comprobado que no se envió.</p>" +
        select("result", "Resultado comprobado", [
          ["sent", "Aceptado por Meta"],
          ["failed", "No se envió"],
        ]) +
        field("providerId", "Identificador de Meta", "", "text", false),
      (f) =>
        api(`/messages/${id}/reconcile`, {
          method: "POST",
          body: { ...f, checked: true },
        }),
    );
  } else if (name === "route") {
    const p = state.plans.find((p) => p.id === id);
    $("#route-container").hidden = false;
    $("#route-origin").value = `${p.origin[1]}, ${p.origin[0]}`;
    $("#route-destination").value = `${p.destination[1]}, ${p.destination[0]}`;
    actualizarParadas(
      state.visits
        .filter((v) => v.plan_id === id && v.status !== "cancelled")
        .map((v) => ({ ...client(v).data, id: v.id })),
    );
    $("#route-container").scrollIntoView({ behavior: "smooth" });
  }
}
$("#auth-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guard(async () => {
    const f = Object.fromEntries(new FormData(e.target));
    const action = e.submitter.value;
    if (action === "forgot") {
      await api("/auth/request-password-reset", {
        method: "POST",
        body: {
          email: f.email,
          redirectTo: location.origin + "/plataforma.html",
        },
      });
      return notice(
        "Si existe la cuenta y está configurado el correo, recibirás un enlace.",
      );
    }
    await api(
      action === "signup" ? "/auth/sign-up/email" : "/auth/sign-in/email",
      {
        method: "POST",
        body: {
          email: f.email,
          password: f.password,
          name: f.name || f.email.split("@")[0],
        },
      },
    );
    $("#auth-form").reset();
    notice("Sesión iniciada.");
    await loadCompanies();
  });
});
$("#reset-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guard(async () => {
    await api("/auth/reset-password", {
      method: "POST",
      body: {
        newPassword: new FormData(e.target).get("password"),
        token: new URLSearchParams(location.search).get("token"),
      },
    });
    history.replaceState(null, "", location.pathname);
    show("access");
    notice("Contraseña actualizada. Ya puedes iniciar sesión.");
  });
});
$("#logout").addEventListener("click", () =>
  guard(async () => {
    await api("/auth/sign-out", { method: "POST", body: {} });
    state = null;
    companyId = "";
    companies = [];
    $("#logout").hidden = true;
    $("#content").replaceChildren();
    actualizarParadas([]);
    show("access");
    notice("Sesión cerrada.");
  }),
);
$("#company-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guard(async () => {
    const result = await api("/companies", {
      method: "POST",
      body: Object.fromEntries(new FormData(e.target)),
    });
    companyId = result.id;
    await loadCompanies();
  });
});
$("#accept-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guard(async () => {
    await api("/invitations/accept", {
      method: "POST",
      body: Object.fromEntries(new FormData(e.target)),
    });
    await loadCompanies();
  });
});
$("#company-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-company]");
  if (b)
    guard(async () => {
      companyId = b.dataset.company;
      await loadCompanies();
    });
});
$("#switch-company").addEventListener("click", chooseCompany);
$("#company-select").addEventListener("change", (e) =>
  guard(async () => {
    companyId = e.target.value;
    await refresh();
  }),
);
$("#tabs").addEventListener("click", (e) => {
  if (e.target.dataset.tab) {
    tab = e.target.dataset.tab;
    render();
  }
});
$("#content").addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (b) guard(() => action(b.dataset.action, b.dataset.id));
});
$("#content").addEventListener("input", (e) => {
  if (e.target.id === "client-search") renderClients(e.target.value);
});
$("#content").addEventListener("change", (e) => {
  if (e.target.id === "agenda-day") {
    agendaDay = e.target.value;
    render();
  }
  if (e.target.id === "import")
    guard(async () => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 1900000) throw new Error("El archivo supera 1,9 MB.");
      const result = await api("/clients/import", {
        method: "POST",
        body: JSON.parse(await file.text()),
      });
      await refresh();
      notice(`${result.imported} clientes importados.`);
    });
});
$("#content").addEventListener("submit", (e) => {
  e.preventDefault();
  guard(async () => {
    const f = Object.fromEntries(new FormData(e.target));
    if (e.target.id === "generate-form") {
      const r = await api("/visits/generate", { method: "POST", body: f });
      await refresh();
      notice(`${r.created} revisiones añadidas a la bolsa.`);
    }
    if (e.target.id === "invite-form") {
      const r = await api("/invitations", { method: "POST", body: f });
      $("#invite-result").textContent = `Código de invitación: ${r.token}`;
    }
  });
});
$("#editor-form").addEventListener("submit", (e) => {
  e.preventDefault();
  guard(async () => {
    const button = e.target.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      pendingMessage = "";
      await editing(Object.fromEntries(new FormData(e.target)));
      $("#editor").close();
      await refresh();
      notice(pendingMessage || "Cambios guardados.");
    } finally {
      button.disabled = false;
    }
  });
});
$("#editor-cancel").addEventListener("click", () => $("#editor").close());
$("#editor").addEventListener("click", (e) => {
  if (e.target.id === "locate-client")
    guard(async () => {
      const form = $("#editor-form");
      const value = (name) => form.elements[name].value;
      const address = [
        value("via").replace(/,\s*(?=\d)/, " "),
        `${value("codigoPostal")} ${value("localidad")}`,
        value("provincia"),
        "España",
      ].join(", ");
      const result = await localizarDireccion(address);
      form.elements.coordinates.value = result.point.join(",");
      $("#client-location").textContent = result.label;
    });
  if (e.target.id === "add-review")
    $("#review-fields").insertAdjacentHTML("beforeend", reviewFields());
  if (e.target.classList.contains("remove-review"))
    e.target.closest(".history-row").remove();
  if (e.target.id === "plan-gps") {
    if (!navigator.geolocation)
      return notice("Este navegador no ofrece GPS.", true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        $("#editor-form [name=origin]").value =
          `${p.coords.latitude},${p.coords.longitude}`;
      },
      () =>
        notice(
          "No se pudo obtener la ubicación. Revisa el permiso de GPS.",
          true,
        ),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }
});
await guard(async () => {
  const health = await api("/health");
  if (!health.configured) {
    show("access");
    notice(
      "La plataforma está pendiente de conectar su base de datos y configurar el acceso en Vercel.",
      true,
    );
    $("#auth-form")
      .querySelectorAll("button")
      .forEach((b) => (b.disabled = true));
    return;
  }
  if (new URLSearchParams(location.search).get("token")) return show("reset");
  const session = await api("/auth/get-session");
  if (session?.user) await loadCompanies();
  else show("access");
});

$("#refresh").addEventListener("click", () => guard(refresh));
