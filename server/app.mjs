import express from "express";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { database, transaction } from "./db.mjs";
import { createAuth } from "./auth.mjs";
import {
  businessToday,
  assert,
  date,
  point,
  clientData,
  nextDue,
  available,
  validateAvailability,
  bestSuggestion,
} from "./domain.mjs";
import { groupSchedule } from "./grouping.mjs";
import { processOutbox, sendWhatsApp, mountMessaging } from "./messaging.mjs";
const id = () => randomUUID();
const isoDay = (x) =>
  typeof x === "string" ? x.slice(0, 10) : x.toISOString().slice(0, 10);
export function createApp({
  pool: injectedPool,
  auth: injectedAuth,
  transport,
} = {}) {
  const app = express();
  let pool = injectedPool,
    auth = injectedAuth;
  app.disable("x-powered-by");
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.get("/api/health", (req, res) =>
    res.json({
      configured:
        !!(injectedPool || process.env.DATABASE_URL) &&
        !!(injectedAuth || process.env.BETTER_AUTH_SECRET),
      service: "VisitaFácil",
    }),
  );
  app.use("/api", (req, res, next) => {
    try {
      pool ??= database();
      auth ??= createAuth(pool);
      req.pool = pool;
      next();
    } catch (e) {
      next(e);
    }
  });
  app.all("/api/auth/*splat", (req, res, next) =>
    Promise.resolve(toNodeHandler(auth)(req, res)).catch(next),
  );
  mountMessaging(app, () => pool, { transport });
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", async (req, res, next) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
        assert(
          req.headers.origin === new URL(process.env.BETTER_AUTH_URL).origin,
          "Origen de petición no permitido.",
          403,
        );
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      assert(session?.user, "Inicia sesión.", 401);
      req.user = session.user;
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/companies", async (req, res) => {
    const r = await pool.query(
      "SELECT c.*,m.role FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.user_id=$1",
      [req.user.id],
    );
    res.json(r.rows);
  });
  app.post("/api/companies", async (req, res) => {
    assert(
      typeof req.body.name === "string" &&
        req.body.name.trim() &&
        req.body.name.length <= 120,
      "Nombre de empresa obligatorio.",
    );
    const companyId = id();
    await transaction(pool, async (db) => {
      await db.query("INSERT INTO companies(id,name) VALUES($1,$2)", [
        companyId,
        req.body.name.trim(),
      ]);
      await db.query("INSERT INTO memberships VALUES($1,$2,'admin')", [
        companyId,
        req.user.id,
      ]);
    });
    res.status(201).json({ id: companyId });
  });
  app.post("/api/invitations/accept", async (req, res) => {
    assert(typeof req.body.token === "string", "Invitación obligatoria.");
    await transaction(pool, async (db) => {
      const {
        rows: [invite],
      } = await db.query(
        "SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE",
        [createHash("sha256").update(req.body.token).digest("hex")],
      );
      assert(
        invite && !invite.used_at && new Date(invite.expires_at) > new Date(),
        "Invitación caducada o utilizada.",
        400,
      );
      assert(
        invite.email.toLowerCase() === req.user.email.toLowerCase(),
        "La invitación pertenece a otro correo.",
        403,
      );
      await db.query(
        "INSERT INTO memberships VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [invite.company_id, req.user.id, invite.role],
      );
      await db.query(
        "UPDATE invitations SET used_at=now() WHERE token_hash=$1",
        [invite.token_hash],
      );
    });
    res.json({ ok: true });
  });
  app.use("/api", async (req, res, next) => {
    try {
      const company = req.headers["x-company-id"];
      assert(typeof company === "string", "Selecciona una empresa.");
      const {
        rows: [member],
      } = await pool.query(
        "SELECT role FROM memberships WHERE company_id=$1 AND user_id=$2",
        [company, req.user.id],
      );
      assert(member, "Empresa no accesible.", 403);
      req.company = company;
      req.role = member.role;
      next();
    } catch (e) {
      next(e);
    }
  });
  const admin = (req) =>
    assert(req.role === "admin", "Acción reservada a administración.", 403);
  async function state(req) {
    const c = req.company;
    const [clients, plans, visits, team] = await Promise.all([
      pool.query(
        "SELECT * FROM clients WHERE company_id=$1 AND ($2='admin' OR id IN (SELECT v.client_id FROM visits v JOIN plans p ON p.id=v.plan_id WHERE v.company_id=$1 AND p.technician_id=$3)) ORDER BY data->>'nombre'",
        [c, req.role, req.user.id],
      ),
      pool.query(
        "SELECT * FROM plans WHERE company_id=$1 AND ($2='admin' OR technician_id=$3) ORDER BY day,name",
        [c, req.role, req.user.id],
      ),
      pool.query(
        "SELECT v.*,to_char(v.due_date,'YYYY-MM-DD') AS due_date FROM visits v LEFT JOIN plans p ON p.id=v.plan_id WHERE v.company_id=$1 AND ($2='admin' OR p.technician_id=$3) ORDER BY v.due_date",
        [c, req.role, req.user.id],
      ),
      pool.query(
        'SELECT m.user_id,m.role,u.name,u.email FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.company_id=$1',
        [c],
      ),
    ]);
    return {
      clients: clients.rows,
      plans: plans.rows.map((p) => ({ ...p, day: isoDay(p.day) })),
      visits: visits.rows,
      team: team.rows,
      role: req.role,
      userId: req.user.id,
      whatsappConfigured: !!(
        process.env.WHATSAPP_TOKEN &&
        process.env.WHATSAPP_PHONE_ID &&
        process.env.WHATSAPP_TEMPLATE_APPOINTMENT &&
        process.env.WHATSAPP_TEMPLATE_REMINDER
      ),
      emailConfigured: !!process.env.RESEND_API_KEY,
    };
  }
  app.get("/api/state", async (req, res) => res.json(await state(req)));
  app.post("/api/invitations", async (req, res) => {
    admin(req);
    const { email, role } = req.body;
    assert(
      typeof email === "string" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
        email.length <= 254,
      "Correo inválido.",
    );
    assert(["admin", "technician"].includes(role), "Rol inválido.");
    const token = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO invitations VALUES($1,$2,$3,$4,now()+interval '7 days',NULL)",
      [
        createHash("sha256").update(token).digest("hex"),
        req.company,
        email.toLowerCase(),
        role,
      ],
    );
    res.status(201).json({ token, expiresInDays: 7 });
  });
  app.post("/api/clients", async (req, res) => {
    admin(req);
    const data = clientData(req.body);
    const clientId = id();
    await pool.query(
      "INSERT INTO clients(id,company_id,data,whatsapp_consent) VALUES($1,$2,$3,$4)",
      [clientId, req.company, data, req.body.whatsappConsent === true],
    );
    res.status(201).json({ id: clientId });
  });
  app.put("/api/clients/:id", async (req, res) => {
    admin(req);
    const data = clientData(req.body);
    const r = await transaction(pool, async (db) => {
      await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        req.company,
      ]);
      return db.query(
        "UPDATE clients SET data=$1,whatsapp_consent=$2 WHERE company_id=$3 AND id=$4 RETURNING id",
        [data, req.body.whatsappConsent === true, req.company, req.params.id],
      );
    });
    assert(r.rowCount, "Cliente no encontrado.", 404);
    res.json({ ok: true });
  });
  app.delete("/api/clients/:id", async (req, res) => {
    admin(req);
    await transaction(pool, async (db) => {
      await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        req.company,
      ]);
      const active = await db.query(
        "SELECT id FROM visits WHERE company_id=$1 AND client_id=$2 AND status IN ('planned','proposed','confirmed')",
        [req.company, req.params.id],
      );
      assert(!active.rowCount, "Retira primero las visitas activas.");
      const r = await db.query(
        "UPDATE clients SET archived=true WHERE company_id=$1 AND id=$2 RETURNING id",
        [req.company, req.params.id],
      );
      assert(r.rowCount, "Cliente no encontrado.", 404);
      await db.query(
        "UPDATE visits SET status='cancelled',reason='Cliente archivado',version=version+1 WHERE company_id=$1 AND client_id=$2 AND status='pool'",
        [req.company, req.params.id],
      );
    });
    res.json({ ok: true });
  });
  app.post("/api/clients/import", async (req, res) => {
    admin(req);
    assert(
      Array.isArray(req.body.clientes) && req.body.clientes.length <= 1000,
      "JSON con clientes (máximo 1000).",
    );
    const rows = req.body.clientes.map(clientData);
    await transaction(pool, async (db) => {
      for (const data of rows)
        await db.query(
          "INSERT INTO clients(id,company_id,data) VALUES($1,$2,$3)",
          [id(), req.company, data],
        );
    });
    res.json({ imported: rows.length });
  });
  app.post("/api/visits/generate", async (req, res) => {
    admin(req);
    const until = date(req.body.until);
    const result = await transaction(pool, async (db) => {
      await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        req.company,
      ]);
      const { rows } = await db.query(
        "SELECT * FROM clients WHERE company_id=$1 AND NOT archived",
        [req.company],
      );
      let count = 0;
      for (const client of rows) {
        const due = nextDue(client.data);
        if (due > until) continue;
        const r = await db.query(
          "INSERT INTO visits(id,company_id,client_id,due_date) VALUES($1,$2,$3,$4) ON CONFLICT(company_id,client_id,due_date) DO NOTHING",
          [id(), req.company, client.id, due],
        );
        count += r.rowCount;
      }
      return count;
    });
    res.json({ created: result });
  });
  app.post("/api/plans", async (req, res) => {
    admin(req);
    const b = req.body;
    date(b.day);
    point(b.origin);
    point(b.destination);
    assert(
      typeof b.name === "string" && b.name.trim() && b.name.length <= 120,
      "Nombre del grupo obligatorio.",
    );
    assert(
      Number.isInteger(b.capacity) && b.capacity >= 1 && b.capacity <= 30,
      "Capacidad de 1 a 30.",
    );
    assert(
      Number.isInteger(b.minutes) && b.minutes >= 30 && b.minutes <= 1440,
      "Duración de jornada inválida.",
    );
    const member = await pool.query(
      "SELECT user_id FROM memberships WHERE company_id=$1 AND user_id=$2",
      [req.company, b.technicianId],
    );
    assert(member.rowCount, "Técnico ajeno a la empresa.");
    const planId = id();
    await pool.query(
      "INSERT INTO plans(id,company_id,day,name,technician_id,capacity,minutes,origin,destination) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        planId,
        req.company,
        b.day,
        b.name.trim(),
        b.technicianId,
        b.capacity,
        b.minutes,
        JSON.stringify(b.origin),
        JSON.stringify(b.destination),
      ],
    );
    res.status(201).json({ id: planId });
  });
  app.post("/api/plans/group", async (req, res) => {
    admin(req);
    const b = req.body;
    date(b.day);
    point(b.origin);
    point(b.destination);
    assert(b.day >= businessToday(), "El primer día ya ha pasado.");
    assert(
      typeof b.name === "string" && b.name.trim() && b.name.length <= 100,
      "Nombre del grupo obligatorio.",
    );
    assert(
      Number.isInteger(b.capacity) && b.capacity >= 1 && b.capacity <= 14,
      "Capacidad de 1 a 14 para usar el planificador de rutas.",
    );
    assert(
      Number.isInteger(b.minutes) && b.minutes >= 30 && b.minutes <= 1440,
      "Minutos de trabajo inválidos.",
    );
    const result = await transaction(pool, async (db) => {
      await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        req.company,
      ]);
      const member = await db.query(
        "SELECT user_id FROM memberships WHERE company_id=$1 AND user_id=$2",
        [req.company, b.technicianId],
      );
      assert(member.rowCount, "Técnico ajeno a la empresa.");
      const { rows: visits } = await db.query(
        "SELECT *,to_char(due_date,'YYYY-MM-DD') AS due_date FROM visits WHERE company_id=$1 AND status='pool' ORDER BY visits.due_date,id",
        [req.company],
      );
      const { rows: clients } = await db.query(
        "SELECT * FROM clients WHERE company_id=$1 AND NOT archived",
        [req.company],
      );
      const { rows: existing } = await db.query(
        "SELECT to_char(day,'YYYY-MM-DD') AS day FROM plans WHERE company_id=$1 AND technician_id=$2",
        [req.company, b.technicianId],
      );
      const proposal = groupSchedule({
        visits,
        clients,
        capacity: b.capacity,
        minutes: b.minutes,
        start: b.day,
        occupied: existing.map((p) => p.day),
      });
      for (const [index, p] of proposal.plans.entries()) {
        const planId = id();
        await db.query(
          "INSERT INTO plans(id,company_id,day,name,technician_id,capacity,minutes,origin,destination) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            planId,
            req.company,
            p.day,
            `${b.name.trim()} ${index + 1}`,
            b.technicianId,
            b.capacity,
            b.minutes,
            JSON.stringify(b.origin),
            JSON.stringify(b.destination),
          ],
        );
        for (const visitId of p.visitIds) {
          await db.query(
            "UPDATE visits SET plan_id=$1,status='planned',version=version+1,reason='' WHERE id=$2 AND company_id=$3",
            [planId, visitId, req.company],
          );
          await db.query(
            "INSERT INTO events(company_id,visit_id,actor,action,detail) VALUES($1,$2,$3,$4,$5)",
            [req.company, visitId, req.user.id, "group", { planId }],
          );
        }
      }
      return {
        created: proposal.plans.length,
        assigned: proposal.plans.reduce((n, p) => n + p.visitIds.length, 0),
        remaining: proposal.remaining.length,
      };
    });
    res.json(result);
  });
  app.get("/api/visits/:id/suggestion", async (req, res) => {
    admin(req);
    const s = await state(req);
    const visit = s.visits.find((v) => v.id === req.params.id);
    assert(
      visit && visit.status === "pool",
      "Visita no disponible en bolsa.",
      404,
    );
    res.json({
      suggestion: bestSuggestion(
        visit,
        s.plans,
        s.visits,
        s.clients,
        businessToday(),
      ),
    });
  });
  app.post("/api/visits/:id/action", async (req, res) => {
    const b = req.body;
    assert(
      [
        "assign",
        "release",
        "cancel",
        "complete",
        "availability",
        "confirm",
      ].includes(b.action),
      "Acción inválida.",
    );
    if (b.action !== "complete") admin(req);
    await transaction(pool, async (db) => {
      // One tenant lock serializes scheduling, archival and completion consistently.
      await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        req.company,
      ]);
      const {
        rows: [visit],
      } = await db.query(
        "SELECT *,to_char(due_date,'YYYY-MM-DD') AS due_date FROM visits WHERE company_id=$1 AND id=$2 FOR UPDATE",
        [req.company, req.params.id],
      );
      assert(visit, "Visita no encontrada.", 404);
      assert(
        !["completed", "cancelled"].includes(visit.status),
        "La visita está cerrada.",
        409,
      );
      if (b.action === "availability") {
        const a = validateAvailability(b.availability);
        assert(
          Number.isInteger(b.duration) && b.duration >= 5 && b.duration <= 480,
          "Duración de 5 a 480 minutos.",
        );
        assert(
          visit.status === "pool",
          "Retira la visita a la bolsa para cambiar disponibilidad.",
        );
        await db.query(
          "UPDATE visits SET availability=$1,duration=$2 WHERE id=$3",
          [a, b.duration, visit.id],
        );
      }
      if (b.action === "confirm") {
        assert(
          ["planned", "proposed"].includes(visit.status),
          "La visita no admite confirmación.",
        );
        await db.query("UPDATE visits SET status='confirmed' WHERE id=$1", [
          visit.id,
        ]);
      }
      if (b.action === "assign") {
        const {
          rows: [plan],
        } = await db.query(
          "SELECT * FROM plans WHERE company_id=$1 AND id=$2",
          [req.company, b.planId],
        );
        assert(plan, "Grupo no encontrado.", 404);
        const day = isoDay(plan.day);
        assert(day >= businessToday(), "El día ya ha pasado.");
        assert(available(visit, day), "El día no cumple la disponibilidad.");
        const {
          rows: [load],
        } = await db.query(
          "SELECT count(*)::int AS total,coalesce(sum(duration),0)::int AS minutes FROM visits WHERE company_id=$1 AND plan_id=$2 AND id<>$3",
          [req.company, plan.id, visit.id],
        );
        assert(
          load.total < plan.capacity &&
            load.minutes + visit.duration <= plan.minutes,
          "El grupo no tiene capacidad.",
          409,
        );
        await db.query(
          "UPDATE visits SET plan_id=$1,status='planned',version=version+1,reason='' WHERE id=$2",
          [plan.id, visit.id],
        );
      }
      if (["release", "cancel"].includes(b.action)) {
        assert(
          typeof b.reason === "string" &&
            b.reason.trim() &&
            b.reason.length <= 1000,
          "Indica el motivo.",
        );
        await db.query(
          "UPDATE visits SET plan_id=NULL,status=$1,reason=$2,version=version+1 WHERE id=$3",
          [b.action === "release" ? "pool" : "cancelled", b.reason, visit.id],
        );
      }
      if (b.action === "complete") {
        assert(visit.plan_id, "La visita debe estar asignada.");
        const {
          rows: [plan],
        } = await db.query("SELECT * FROM plans WHERE id=$1", [visit.plan_id]);
        assert(
          req.role === "admin" || plan.technician_id === req.user.id,
          "Visita no asignada a este técnico.",
          403,
        );
        date(b.date);
        assert(
          b.date <= businessToday(),
          "La intervención no puede ser futura.",
        );
        assert(
          typeof b.work === "string" && b.work.trim() && b.work.length <= 5000,
          "Describe el trabajo realizado.",
        );
        const {
          rows: [client],
        } = await db.query("SELECT * FROM clients WHERE id=$1 FOR UPDATE", [
          visit.client_id,
        ]);
        client.data.revisiones.push({
          fecha: b.date,
          descripcion: b.work.trim(),
        });
        await db.query("UPDATE clients SET data=$1 WHERE id=$2", [
          client.data,
          client.id,
        ]);
        await db.query(
          "UPDATE visits SET status='completed',work=$1,version=version+1 WHERE id=$2",
          [b.work.trim(), visit.id],
        );
      }
      if (!["availability", "confirm"].includes(b.action))
        await db.query(
          "UPDATE outbox SET state='obsolete' WHERE visit_id=$1 AND state IN ('pending','failed')",
          [visit.id],
        );
      await db.query(
        "INSERT INTO events(company_id,visit_id,actor,action,detail) VALUES($1,$2,$3,$4,$5)",
        [
          req.company,
          visit.id,
          req.user.id,
          b.action,
          { reason: b.reason ?? "", planId: b.planId ?? null },
        ],
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/visits/:id/history", async (req, res) => {
    admin(req);
    const r = await pool.query(
      "SELECT * FROM events WHERE company_id=$1 AND visit_id=$2 ORDER BY id",
      [req.company, req.params.id],
    );
    res.json(r.rows);
  });
  app.post("/api/visits/:id/propose", async (req, res) => {
    admin(req);
    assert(
      process.env.WHATSAPP_TOKEN &&
        process.env.WHATSAPP_PHONE_ID &&
        process.env.WHATSAPP_TEMPLATE_APPOINTMENT,
      "WhatsApp no está configurado.",
      503,
    );
    await transaction(pool, async (db) => {
      await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        req.company,
      ]);
      const {
        rows: [v],
      } = await db.query(
        "SELECT v.*,c.whatsapp_consent FROM visits v JOIN clients c ON c.id=v.client_id WHERE v.company_id=$1 AND v.id=$2 FOR UPDATE OF v",
        [req.company, req.params.id],
      );
      assert(
        v && ["planned", "proposed"].includes(v.status),
        "La visita debe estar planificada.",
      );
      assert(v.whatsapp_consent, "El cliente no ha autorizado WhatsApp.");
      await db.query(
        "INSERT INTO outbox(id,company_id,visit_id,version,kind) VALUES($1,$2,$3,$4,'appointment') ON CONFLICT DO NOTHING",
        [id(), req.company, v.id, v.version],
      );
      await db.query("UPDATE visits SET status='proposed' WHERE id=$1", [v.id]);
    });
    const delivery = await processOutbox(pool, transport ?? sendWhatsApp, {
      companyId: req.company,
      reminders: false,
    });
    res.json({ queued: true, ...delivery });
  });
  app.post("/api/messages/:id/reconcile", async (req, res) => {
    admin(req);
    const b = req.body;
    assert(
      b.checked === true && ["sent", "failed"].includes(b.result),
      "Confirma la comprobación del mensaje en Meta.",
    );
    if (b.result === "sent")
      assert(
        typeof b.providerId === "string" &&
          b.providerId.length > 0 &&
          b.providerId.length < 300,
        "Identificador del mensaje obligatorio.",
      );
    await transaction(pool, async (db) => {
      await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        req.company,
      ]);
      const r = await db.query(
        "UPDATE outbox SET state=$1,provider_id=$2,error=NULL WHERE id=$3 AND company_id=$4 AND state='uncertain' RETURNING visit_id",
        [b.result, b.providerId ?? null, req.params.id, req.company],
      );
      assert(r.rowCount, "El mensaje no necesita conciliación.", 409);
      await db.query(
        "INSERT INTO events(company_id,visit_id,actor,action,detail) VALUES($1,$2,$3,$4,$5)",
        [
          req.company,
          r.rows[0].visit_id,
          req.user.id,
          "message_reconciled",
          { messageId: req.params.id, result: b.result },
        ],
      );
    });
    res.json({ ok: true });
  });
  app.post("/api/messages/:id/retry", async (req, res) => {
    admin(req);
    await transaction(pool, async (db) => {
      await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        req.company,
      ]);
      const r = await db.query(
        "UPDATE outbox SET state='pending',attempts=0,available_at=now(),error=NULL WHERE id=$1 AND company_id=$2 AND state='failed' RETURNING visit_id",
        [req.params.id, req.company],
      );
      assert(r.rowCount, "El mensaje no admite reintento.", 409);
    });
    res.json(
      await processOutbox(pool, transport ?? sendWhatsApp, {
        companyId: req.company,
        reminders: false,
      }),
    );
  });
  app.get("/api/messages/reviews", async (req, res) => {
    admin(req);
    const r = await pool.query(
      "SELECT e.* FROM events e WHERE e.company_id=$1 AND (e.action='review' OR e.detail->>'reviewRequired'='true') AND NOT EXISTS (SELECT 1 FROM events resolved WHERE resolved.company_id=e.company_id AND resolved.action='review_resolved' AND resolved.detail->>'eventId'=e.id::text) ORDER BY e.id DESC LIMIT 100",
      [req.company],
    );
    res.json(r.rows);
  });
  app.post("/api/messages/reviews/:id/resolve", async (req, res) => {
    admin(req);
    const r = await pool.query(
      "SELECT id,visit_id FROM events WHERE company_id=$1 AND id::text=$2",
      [req.company, req.params.id],
    );
    assert(r.rowCount, "Respuesta no encontrada.", 404);
    await pool.query(
      "INSERT INTO events(company_id,visit_id,actor,action,detail) VALUES($1,$2,$3,$4,$5)",
      [
        req.company,
        r.rows[0].visit_id,
        req.user.id,
        "review_resolved",
        { eventId: String(r.rows[0].id) },
      ],
    );
    res.json({ ok: true });
  });
  app.get("/api/messages", async (req, res) => {
    admin(req);
    const r = await pool.query(
      "SELECT id,visit_id,kind,state,attempts,error,provider_id FROM outbox WHERE company_id=$1 ORDER BY available_at DESC LIMIT 100",
      [req.company],
    );
    res.json(r.rows);
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Ruta no encontrada." }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status =
      err.status ??
      (err.code === "23505" ? 409 : err.code === "23503" ? 400 : 500);
    if (status >= 500) console.error("API error", err.code ?? err.name);
    res
      .status(status)
      .json({
        error:
          status === 500 ? "No se pudo completar la operación." : err.message,
      });
  });
  return app;
}
