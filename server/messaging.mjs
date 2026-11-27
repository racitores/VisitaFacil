import {runWeeklyScheduler} from "./weekly.mjs";
import { businessToday } from "./domain.mjs";
import express from "express";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { transaction } from "./db.mjs";
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function mountMessaging(
  app,
  getPool,
  { transport = sendWhatsApp } = {},
) {
  app.get("/api/whatsapp/webhook", (req, res) => {
    if (
      process.env.WHATSAPP_VERIFY_TOKEN &&
      equal(req.query["hub.verify_token"], process.env.WHATSAPP_VERIFY_TOKEN) &&
      req.query["hub.mode"] === "subscribe"
    )
      return res.status(200).send(req.query["hub.challenge"]);
    res.sendStatus(403);
  });
  app.post(
    "/api/whatsapp/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res, next) => {
      try {
        if (!process.env.WHATSAPP_APP_SECRET || !Buffer.isBuffer(req.body))
          return res.sendStatus(503);
        const signature =
          "sha256=" +
          createHmac("sha256", process.env.WHATSAPP_APP_SECRET)
            .update(req.body)
            .digest("hex");
        if (!equal(req.headers["x-hub-signature-256"], signature))
          return res.sendStatus(403);
        const body = JSON.parse(req.body.toString());
        for (const entry of body.entry ?? [])
          for (const change of entry.changes ?? []) {
            if (
              change.value?.metadata?.phone_number_id !==
              process.env.WHATSAPP_PHONE_ID
            )
              continue;
            for (const message of change.value?.messages ?? [])
              await reply(getPool(), message);
          }
        res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );
  app.get("/api/cron/messages", async (req, res, next) => {
    try {
      if (
        !process.env.CRON_SECRET ||
        !equal(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`)
      )
        return res.sendStatus(401);
      const planning=await runWeeklyScheduler(getPool());
      const configured=!!(process.env.WHATSAPP_TOKEN&&process.env.WHATSAPP_PHONE_ID&&process.env.WHATSAPP_TEMPLATE_REMINDER);
      const messages=configured?await processOutbox(getPool(),transport,{budgetMs:15000}):{sent:0,failed:0};
      res.json({...messages,planning,whatsappConfigured:configured});
    } catch (e) {
      next(e);
    }
  });
}
export async function reply(pool, message) {
  if (!message.id || !message.from) return;
  const optout =
    /^(baja|stop|no whatsapp|dejar de recibir mensajes)[.! ]*$/i.test(
      (message.text?.body ?? "").trim(),
    );
  if (optout)
    return transaction(pool, async (db) => {
      const { rows: clients } = await db.query(
        "SELECT * FROM clients WHERE regexp_replace(data->>'telefono','[^0-9]','','g')=$1 ORDER BY company_id,id",
        [String(message.from).replace(/\D/g, "")],
      );
      for (const company of [...new Set(clients.map((c) => c.company_id))])
        await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
          company,
        ]);
      const receipt = await db.query(
        "INSERT INTO webhook_receipts(id) VALUES($1) ON CONFLICT DO NOTHING",
        [message.id],
      );
      if (!receipt.rowCount) return;
      for (const c of clients) {
        await db.query(
          "UPDATE clients SET whatsapp_consent=false WHERE id=$1",
          [c.id],
        );
        await db.query(
          "UPDATE outbox SET state='obsolete' WHERE visit_id IN (SELECT id FROM visits WHERE client_id=$1) AND state IN ('pending','failed')",
          [c.id],
        );
        await db.query(
          "INSERT INTO events(company_id,actor,action,detail) VALUES($1,$2,$3,$4)",
          [c.company_id, "whatsapp", "stop", { clientId: c.id }],
        );
      }
    });
  return transaction(pool, async (db) => {
    const payload =
      message.interactive?.button_reply?.id ?? message.button?.payload ?? "";
    const match = /^(confirm|change|cancel|stop):([0-9a-f-]{36}):(\d+)$/.exec(
      payload,
    );
    // Free text goes to human review, associated through replied-to message when possible.
    const lookup = match
      ? await db.query("SELECT company_id FROM visits WHERE id=$1", [match[2]])
      : await db.query("SELECT company_id FROM outbox WHERE provider_id=$1", [
          message.context?.id ?? "",
        ]);
    if (!lookup.rowCount) {
      const { rows: clients } = await db.query(
        "SELECT id,company_id FROM clients WHERE regexp_replace(data->>'telefono','[^0-9]','','g')=$1 ORDER BY company_id",
        [String(message.from).replace(/\D/g, "")],
      );
      for (const company of [...new Set(clients.map((c) => c.company_id))])
        await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
          company,
        ]);
      const receipt = await db.query(
        "INSERT INTO webhook_receipts(id) VALUES($1) ON CONFLICT DO NOTHING",
        [message.id],
      );
      if (!receipt.rowCount) return;
      for (const c of clients)
        await db.query(
          "INSERT INTO events(company_id,actor,action,detail) VALUES($1,$2,$3,$4)",
          [
            c.company_id,
            "whatsapp",
            "review",
            {
              clientId: c.id,
              text: (
                message.text?.body ??
                message.button?.text ??
                "Respuesta sin cita asociada"
              ).slice(0, 2000),
              reviewRequired: true,
            },
          ],
        );
      return;
    }
    const company = lookup.rows[0].company_id;
    await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      company,
    ]);
    const receipt = await db.query(
      "INSERT INTO webhook_receipts(id) VALUES($1) ON CONFLICT DO NOTHING",
      [message.id],
    );
    if (!receipt.rowCount) return;
    const {
      rows: [v],
    } = await db.query(
      "SELECT v.*,c.data,c.whatsapp_consent FROM visits v JOIN clients c ON c.id=v.client_id WHERE v.company_id=$1 AND v.id=$2 FOR UPDATE OF v",
      [
        company,
        match?.[2] ??
          (
            await db.query("SELECT visit_id FROM outbox WHERE provider_id=$1", [
              message.context?.id ?? "",
            ])
          ).rows[0]?.visit_id,
      ],
    );
    if (
      !v ||
      String(v.data.telefono).replace(/\D/g, "") !==
        String(message.from).replace(/\D/g, "")
    )
      return;
    const action = match?.[1] ?? "review";
    let detail = { text: (message.text?.body ?? "").slice(0, 2000) };
    const current =
      match &&
      Number(match[3]) === v.version &&
      ["proposed", "confirmed"].includes(v.status);
    if (action === "stop") {
      await db.query("UPDATE clients SET whatsapp_consent=false WHERE id=$1", [
        v.client_id,
      ]);
      await db.query(
        "UPDATE outbox SET state='obsolete' WHERE visit_id IN (SELECT id FROM visits WHERE client_id=$1) AND state IN ('pending','failed')",
        [v.client_id],
      );
    } else if (current && action === "confirm")
      await db.query("UPDATE visits SET status='confirmed' WHERE id=$1", [
        v.id,
      ]);
    else if (current && ["change", "cancel"].includes(action)) {
      await db.query(
        "UPDATE visits SET status='pool',plan_id=NULL,reason=$1,version=version+1 WHERE id=$2",
        [
          action === "change"
            ? "Cliente solicita otro día"
            : "Cliente rechaza la cita",
          v.id,
        ],
      );
      await db.query(
        "UPDATE outbox SET state='obsolete' WHERE visit_id=$1 AND state IN ('pending','failed')",
        [v.id],
      );
    } else detail.reviewRequired = true;
    await db.query(
      "INSERT INTO events(company_id,visit_id,actor,action,detail) VALUES($1,$2,$3,$4,$5)",
      [company, v.id, "whatsapp", action, detail],
    );
  });
}
export async function processOutbox(
  pool,
  transport = sendWhatsApp,
  { companyId = null, reminders = true, budgetMs = 40000 } = {},
) {
  const deadline = Date.now() + budgetMs;
  const today = businessToday();
  const tomorrowDate = new Date(`${today}T12:00:00Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);
  const obsoleteDate = (v, kind) =>
    !v.day || v.day < today || (kind === "reminder" && v.day !== tomorrow);
  await pool.query(
    "UPDATE outbox SET state='uncertain',error='Envío interrumpido: comprobar en Meta antes de reenviar.' WHERE state='sending' AND claimed_at<now()-interval '10 minutes'",
  );
  if (reminders)
    await pool.query(
      `INSERT INTO outbox(id,company_id,visit_id,version,kind) SELECT gen_random_uuid()::text,v.company_id,v.id,v.version,'reminder' FROM visits v JOIN plans p ON p.id=v.plan_id JOIN clients c ON c.id=v.client_id WHERE v.status='confirmed' AND c.whatsapp_consent AND p.day=(now() AT TIME ZONE 'Europe/Madrid')::date+1 ON CONFLICT DO NOTHING`,
    );
  let sent = 0,
    failed = 0;
  for (let i = 0; i < 50 && Date.now() < deadline; i++) {
    const item = await transaction(pool, async (db) => {
      const {
        rows: [row],
      } = await db.query(
        "SELECT * FROM outbox WHERE state='pending' AND available_at<=now() AND ($1::text IS NULL OR company_id=$1) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1",
        [companyId],
      );
      if (!row) return null;
      const {
        rows: [v],
      } = await db.query(
        "SELECT v.*,c.data,c.whatsapp_consent,p.day,p.name FROM visits v JOIN clients c ON c.id=v.client_id LEFT JOIN plans p ON p.id=v.plan_id WHERE v.id=$1",
        [row.visit_id],
      );
      if (
        !v ||
        v.version !== row.version ||
        !["proposed", "confirmed"].includes(v.status) ||
        !v.whatsapp_consent ||
        obsoleteDate(v, row.kind)
      ) {
        await db.query("UPDATE outbox SET state='obsolete' WHERE id=$1", [
          row.id,
        ]);
        return { skip: true };
      }
      await db.query(
        "UPDATE outbox SET state='sending',attempts=attempts+1,claimed_at=now() WHERE id=$1",
        [row.id],
      );
      return { ...row, visit: v };
    });
    if (!item) break;
    if (item.skip) continue;
    try {
      await transaction(pool, async (db) => {
        // Keep a tenant scheduling lock while sending, so a released visit cannot
        // race with a message using its previous day. A crash after acceptance
        // leaves the precommitted sending state for manual reconciliation.
        await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
          item.company_id,
        ]);
        const {
          rows: [current],
        } = await db.query(
          "SELECT v.*,c.data,c.whatsapp_consent,p.day,p.name FROM visits v JOIN clients c ON c.id=v.client_id JOIN plans p ON p.id=v.plan_id WHERE v.id=$1",
          [item.visit_id],
        );
        if (
          !current ||
          current.version !== item.version ||
          !["proposed", "confirmed"].includes(current.status) ||
          !current.whatsapp_consent ||
          obsoleteDate(current, item.kind)
        ) {
          await db.query("UPDATE outbox SET state='obsolete' WHERE id=$1", [
            item.id,
          ]);
          return;
        }
        const providerId = await transport({ ...item, visit: current });
        await db.query(
          "UPDATE outbox SET state='sent',provider_id=$1 WHERE id=$2",
          [providerId, item.id],
        );
        sent++;
      });
    } catch (e) {
      failed++;
      const retry = e.retryable && item.attempts < 4;
      await pool.query(
        "UPDATE outbox SET state=$1,error=$2,available_at=now()+interval '15 minutes' WHERE id=$3",
        [
          e.uncertain ? "uncertain" : retry ? "pending" : "failed",
          String(e.message).slice(0, 300),
          item.id,
        ],
      );
    }
  }
  return { sent, failed };
}
export async function sendWhatsApp(item) {
  const { visit } = item;
  const template =
    item.kind === "appointment"
      ? process.env.WHATSAPP_TEMPLATE_APPOINTMENT
      : process.env.WHATSAPP_TEMPLATE_REMINDER;
  if (
    !process.env.WHATSAPP_TOKEN ||
    !process.env.WHATSAPP_PHONE_ID ||
    !process.env.WHATSAPP_GRAPH_VERSION ||
    !template
  )
    throw new Error("Completa la configuración de WhatsApp.");
  const day =
    typeof visit.day === "string"
      ? visit.day.slice(0, 10)
      : visit.day.toISOString().slice(0, 10);
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: visit.data.nombre },
        { type: "text", text: day },
        { type: "text", text: visit.name },
      ],
    },
  ];
  for (const [index, action] of ["confirm", "change", "cancel"].entries())
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(index),
      parameters: [
        { type: "payload", payload: `${action}:${visit.id}:${visit.version}` },
      ],
    });
  let response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: String(visit.data.telefono).replace(/\D/g, ""),
          type: "template",
          template: {
            name: template,
            language: { code: process.env.WHATSAPP_LANGUAGE ?? "es" },
            components,
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    throw Object.assign(
      new Error("Resultado del envío desconocido; comprobar en Meta."),
      { uncertain: true },
    );
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(
        `Meta rechazó el envío (HTTP ${response.status}, código ${result.error?.code ?? "desconocido"}).`,
      ),
      { retryable: response.status === 429, uncertain: response.status >= 500 },
    );
  if (!result.messages?.[0]?.id)
    throw Object.assign(
      new Error("Meta no devolvió identificador de mensaje."),
      { uncertain: true },
    );
  return result.messages[0].id;
}
