import {defaultWeeklySettings,validateWeeklySettings,weekWindow,buildWeeklyDraft,validateWeeklyApproval} from "./planificacion-semanal.mjs";
import {
  excludeVisitDay,
  businessToday,
  assert,
  date,
  point,
  clientData,
  nextDue,
  available,
  validateAvailability,
  bestSuggestion,
} from "./planificacion-domain.mjs";
import { groupSchedule } from "./planificacion-grupos.mjs";
export const DEMO_STORAGE_KEY = "visitafacil-demo-v1";
const company = "demo-local",
  technician = "demo-technician",
  copy = (value) => structuredClone(value);
const uid = () => crypto.randomUUID();
export function createDemoStore({ storage, seed, clock = businessToday, seedRevision=1 }) {
  let state;
  const fresh = () => ({
    version: 1,
    demoSeedRevision:seedRevision,
    company: { id: company, name: "Empresa de demostración" },
    clients: seed.map((data) => ({
      id: uid(),
      company_id: company,
      data: clientData(copy(data)),
      archived: false,
      whatsapp_consent: false,
    })),
    plans: [],
    visits: [],
    events: [],
    team: [
      {
        user_id: technician,
        name: "Técnico de demostración",
        email: "tecnico@example.com",
        role: "admin",
      },
    ],
    role: "admin",
    userId: technician,
    whatsappConfigured: false,
    emailConfigured: false,
  });
  const save = () => {
    try {
      storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    } catch {
      throw new Error(
        "No se pueden guardar los cambios de la demo. Comprueba el almacenamiento del navegador.",
      );
    }
  };
  function generate(until) {
    let created = 0;
    for (const c of state.clients.filter((c) => !c.archived)) {
      const due = nextDue(c.data);
      if (
        due > until ||
        state.visits.some((v) => v.client_id === c.id && v.due_date === due)
      )
        continue;
      state.visits.push({
        id: uid(),
        company_id: company,
        client_id: c.id,
        due_date: due,
        status: "pool",
        plan_id: null,
        duration: Number.isInteger(c.data.demoPlan?.duration)?c.data.demoPlan.duration:60,
        availability: copy(c.data.demoPlan?.availability??{}),
        reason: "",
        version: 1,
      });
      created++;
    }
    return { created };
  }
function ensureDemoTeam(){if(seedRevision<2)return;for(const t of [{user_id:technician,name:"Ana · Centro",email:"ana@example.com",role:"admin"},{user_id:"demo-tech-norte",name:"Luis · Norte",email:"luis@example.com",role:"technician"},{user_id:"demo-tech-sur",name:"Marta · Sur",email:"marta@example.com",role:"technician"}])if(!state.team.some(x=>x.user_id===t.user_id))state.team.push(t);}
function demoUntil(){return seedRevision>=2?"2027-01-31":clock().slice(0,4)+"-12-31";}
function seedScenario(){if(seedRevision<2)return;for(const [i,v] of state.visits.filter(v=>v.status==="pool").entries()){const c=state.clients.find(c=>c.id===v.client_id);if(!c.data.demoPlan?.preset)continue;let day;const d=new Date(`${v.due_date}T12:00:00Z`);for(let n=0;n<7;n++,d.setUTCDate(d.getUTCDate()-1)){const candidate=d.toISOString().slice(0,10);if(candidate<clock())break;if(d.getUTCDay()!==0&&d.getUTCDay()!==6&&available(v,candidate)){day=candidate;break;}}if(!day)continue;const tech=state.team[i%state.team.length].user_id;let p=state.plans.find(p=>p.day===day&&p.technician_id===tech);if(!p)p=addPlan({day,name:"Demo · Visitas ya acordadas",technicianId:tech,capacity:6,minutes:480,origin:[-3.7038,40.4168],destination:[-3.7038,40.4168]});try{assign(v,p.id);if(c.data.demoPlan.confirmed)v.status="confirmed";}catch{/* A full preset day leaves this fixture in the pool. */}}}
  function reset() {
    const old = state;
    try {
      state = fresh();
      ensureDemoTeam();generate(demoUntil());seedScenario();
      save();
    } catch (e) {
      state = old;
      throw e;
    }
    return { ok: true };
  }
  function load() {
    let saved;
    try {
      saved = storage.getItem(DEMO_STORAGE_KEY);
    } catch {
      throw new Error(
        "El navegador no permite acceder al almacenamiento de la demo.",
      );
    }
    if (!saved) {
      reset();
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      assert(
        parsed.version === 1 &&
          parsed.company?.id === company &&
          ["clients", "plans", "visits", "events", "team"].every((key) =>
            Array.isArray(parsed[key]),
          ),
        "Formato inválido.",
      );
      state = parsed;
    } catch {
      throw new Error(
        "Los datos locales de la demo no se pueden leer. Pulsa Restablecer demo para empezar de nuevo.",
      );
    }
    if(seedRevision>=2&&(state.demoSeedRevision??1)<seedRevision){
      for(const data of seed)if(!state.clients.some(c=>c.data.id===data.id))state.clients.push({id:uid(),company_id:company,data:clientData(copy(data)),archived:false,whatsapp_consent:false});
      ensureDemoTeam();generate(demoUntil());seedScenario();state.demoSeedRevision=seedRevision;save();
    }
  }
  load();
  const visit = (id) => {
    const v = state.visits.find((v) => v.id === id);
    assert(v, "Visita no encontrada.");
    return v;
  };
  const client = (id) => {
    const c = state.clients.find((c) => c.id === id);
    assert(c, "Cliente no encontrado.");
    return c;
  };
  const event = (v, action, detail = {}) =>
    state.events.push({
      id: uid(),
      company_id: company,
      visit_id: v.id,
      actor: technician,
      action,
      detail,
      created_at: new Date().toISOString(),
    });
  function planInput(b) {
    date(b.day);
    assert(b.day >= clock(), "El día ya ha pasado.");
    point(b.origin);
    point(b.destination);
    assert(
      typeof b.name === "string" && b.name.trim() && b.name.length <= 120,
      "Nombre del grupo obligatorio.",
    );
    assert(
      state.team.some(t=>t.user_id===b.technicianId),
      "Selecciona el técnico de demostración.",
    );
    assert(
      Number.isInteger(b.capacity) && b.capacity >= 1 && b.capacity <= 14,
      "Capacidad de 1 a 14 visitas.",
    );
    assert(
      Number.isInteger(b.minutes) && b.minutes >= 30 && b.minutes <= 1440,
      "Minutos de trabajo inválidos.",
    );
  }
  function addPlan(b) {
    assert(
      !state.plans.some(
        (p) => p.day === b.day && p.technician_id === b.technicianId,
      ),
      "Ese técnico ya tiene una jornada en ese día.",
    );
    const p = {
      id: uid(),
      company_id: company,
      day: b.day,
      name: b.name.trim(),
      technician_id: b.technicianId,
      capacity: b.capacity,
      minutes: b.minutes,
      origin: copy(b.origin),
      destination: copy(b.destination),
    };
    state.plans.push(p);
    return p;
  }
  function assign(v, planId) {
    const p = state.plans.find((p) => p.id === planId);
    assert(p, "Grupo no encontrado.");
    assert(
      p.day >= clock() && available(v, p.day),
      "El día no cumple la disponibilidad.",
    );
    const assigned = state.visits.filter(
      (other) => other.plan_id === p.id && other.id !== v.id,
    );
    assert(
      assigned.length < p.capacity &&
        assigned.reduce((n, v) => n + v.duration, 0) + v.duration <= p.minutes,
      "El grupo no tiene capacidad.",
    );
    v.plan_id = p.id;
    v.status = "planned";
    v.reason = "";
    v.version++;
  }
  async function request(path, { method = "GET", body: b = {} } = {}) {
    if (path === "/state") return copy(state);
    if(path==="/weekly/config"&&method==="GET")return copy(state.weeklySettings??defaultWeeklySettings(technician));
    if(path==="/weekly/runs"&&method==="GET")return copy([...(state.weeklyRuns??[])].sort((a,b)=>b.week_start.localeCompare(a.week_start)).slice(0,12));
    if (path === "/companies")
      return [copy({ ...state.company, role: "admin" })];
    if (path === "/auth/sign-out") return { ok: true };
    const parts = path.split("/").filter(Boolean),
      id = parts[1];
    if (parts[0] === "visits" && parts[2] === "history")
      return copy(state.events.filter((e) => e.visit_id === id));
    if (parts[0] === "visits" && parts[2] === "suggestion") {
      const v = visit(id);
      assert(v.status === "pool", "La visita debe estar en bolsa.");
      return {
        suggestion: bestSuggestion(
          v,
          state.plans,
          state.visits,
          state.clients,
          clock(),
        ),
      };
    }
    assert(method !== "GET", "Esta función no está disponible en la demo.");
    const previous = copy(state);
    try {
      let result;
      if(path==='/weekly/config'&&method==='PUT'){
        state.weeklySettings=validateWeeklySettings({...b,enabled:false},state.team.map(t=>t.user_id));result=copy(state.weeklySettings);
      }else if(path==='/weekly/draft'){
        const config=validateWeeklySettings(state.weeklySettings??{},state.team.map(t=>t.user_id));const window=weekWindow(clock(),config.weeksAhead);generate(window.end);
        const payload=buildWeeklyDraft({...state,settings:config,today:clock()});state.weeklyRuns??=[];
        let run=state.weeklyRuns.find(r=>r.week_start===window.start);
        if(!run){run={id:uid(),company_id:company,week_start:window.start,week_end:window.end,revision:0};state.weeklyRuns.push(run);}
        Object.assign(run,{payload,config:copy(config),status:'draft',revision:run.revision+1,updated_at:new Date().toISOString()});result=copy(run);
      }else if(parts[0]==='weekly'&&parts[1]==='runs'&&parts[3]==='approve'){
        const run=(state.weeklyRuns??[]).find(r=>r.id===parts[2]);assert(run,'Borrador no encontrado.');assert(run.revision===b.revision,'El borrador ha cambiado. Actualiza la pantalla.');
        if(run.status==='approved')return {applied:0,alreadyApproved:true};
        validateWeeklyApproval({...state,payload:run.payload,memberIds:state.team.map(t=>t.user_id),today:clock()});let applied=0;
        for(const g of run.payload.groups){let planId=g.existingPlanId;if(!planId)planId=addPlan({...g,technicianId:g.technicianId}).id;for(const item of g.visits){const v=visit(item.visitId);assign(v,planId);event(v,'weekly_assigned',{runId:run.id,revision:run.revision,late:item.late});applied++;}}
        run.status='approved';result={applied};
      }else if (path === "/visits/generate") {
        date(b.until);
        result = generate(b.until);
      } else if (path === "/clients/import") {
        assert(
          Array.isArray(b.clientes) && b.clientes.length <= 1000,
          "JSON de clientes inválido.",
        );
        const rows = b.clientes.map(clientData);
        let imported = 0;
        for (const data of rows) {
          if (data.id && state.clients.some((c) => c.data.id === data.id))
            continue;
          state.clients.push({
            id: uid(),
            company_id: company,
            data: copy(data),
            archived: false,
            whatsapp_consent: false,
          });
          imported++;
        }
        result = { imported };
      } else if (path === "/clients" && method === "POST") {
        const c = {
          id: uid(),
          company_id: company,
          data: clientData(copy(b)),
          archived: false,
          whatsapp_consent: false,
        };
        state.clients.push(c);
        result = { id: c.id };
      } else if (parts[0] === "clients" && id && method === "PUT") {
        client(id).data = clientData(copy(b));
        result = { ok: true };
      } else if (parts[0] === "clients" && id && method === "DELETE") {
        const c = client(id);
        assert(
          !state.visits.some(
            (v) =>
              v.client_id === id &&
              ["planned", "proposed", "confirmed"].includes(v.status),
          ),
          "Retira primero las visitas activas.",
        );
        c.archived = true;
        for (const v of state.visits.filter(
          (v) => v.client_id === id && v.status === "pool",
        )) {
          v.status = "cancelled";
          v.reason = "Cliente archivado";
          v.version++;
          event(v, "cancel", { reason: v.reason });
        }
        result = { ok: true };
      } else if (path === "/plans") {
        planInput(b);
        result = { id: addPlan(b).id };
      } else if (path === "/plans/group") {
        planInput(b);
        const proposal = groupSchedule({
          visits: state.visits.filter((v) => v.status === "pool"),
          clients: state.clients.filter((c) => !c.archived),
          capacity: b.capacity,
          minutes: b.minutes,
          start: b.day,
          occupied: state.plans.filter(p=>p.technician_id===b.technicianId).map((p) => p.day),
        });
        for (const [i, p] of proposal.plans.entries()) {
          const plan = addPlan({
            ...b,
            day: p.day,
            name: `${b.name} ${i + 1}`,
          });
          for (const id of p.visitIds) {
            const v = visit(id);
            assign(v, plan.id);
            event(v, "group", { planId: plan.id });
          }
        }
        result = {
          created: proposal.plans.length,
          assigned: proposal.plans.reduce((n, p) => n + p.visitIds.length, 0),
          remaining: proposal.remaining.length,
        };
      } else if (parts[0] === "visits" && parts[2] === "action") {
        const v = visit(id);
        assert(
          !["completed", "cancelled"].includes(v.status),
          "La visita está cerrada.",
        );
        if (b.action === "assign") assign(v, b.planId);
        else if (b.action === "availability") {
          assert(v.status === "pool", "Devuelve primero la visita a la bolsa.");
          assert(
            Number.isInteger(b.duration) &&
              b.duration >= 5 &&
              b.duration <= 480,
            "Duración de 5 a 480 minutos.",
          );
          v.availability = copy(validateAvailability(b.availability));
          v.duration = b.duration;
        } else if (["release", "cancel"].includes(b.action)) {
          assert(
            typeof b.reason === "string" && b.reason.trim(),
            "Indica el motivo.",
          );
          if(b.action==="release"&&v.plan_id&&b.excludeDay!==false){const p=state.plans.find(p=>p.id===v.plan_id);if(p)v.availability=excludeVisitDay(v,p.day);}
          v.plan_id = null;
          v.status = b.action === "release" ? "pool" : "cancelled";
          v.reason = b.reason;
          v.version++;
        } else if (b.action === "confirm") {
          assert(v.status === "planned", "La visita debe estar planificada.");
          v.status = "confirmed";
        } else if (b.action === "complete") {
          assert(v.plan_id, "La visita debe estar asignada.");
          date(b.date);
          assert(b.date <= clock(), "La intervención no puede ser futura.");
          assert(
            typeof b.work === "string" &&
              b.work.trim() &&
              b.work.length <= 5000,
            "Describe el trabajo realizado.",
          );
          client(v.client_id).data.revisiones.push({
            fecha: b.date,
            descripcion: b.work.trim(),
          });
          v.status = "completed";
          v.work = b.work.trim();
          v.version++;
        } else throw new Error("Acción no disponible en la demo.");
        event(v, b.action, {
          reason: b.reason ?? "",
          planId: b.planId ?? null,
        });
        result = { ok: true };
      } else
        throw new Error(
          "Esta función requiere una cuenta real y no está disponible en la demo.",
        );
      save();
      return copy(result);
    } catch (e) {
      state = previous;
      throw e;
    }
  }
  return { request, reset };
}
