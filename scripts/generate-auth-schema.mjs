// Regenerate only when reviewing a Better Auth upgrade. Always uses an empty,
// disposable PostgreSQL instance; never reads production connection strings.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { getMigrations } from "better-auth/db/migration";
import pg from "pg";
import { writeFile } from "node:fs/promises";
import { authOptions } from "../server/auth.mjs";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "schema-generation-only-not-a-production-secret";
const db = await PGlite.create();
const socket = new PGLiteSocketServer({ db, port: 55440 });
await socket.start();
const pool = new pg.Pool({
  connectionString: "postgresql://postgres:postgres@127.0.0.1:55440/postgres",
  max: 1,
});
try {
  const migration = await getMigrations(authOptions(pool));
  const sql = await migration.compileMigrations();
  await writeFile(
    new URL("../server/auth-schema.sql", import.meta.url),
    "-- Generated from the pinned Better Auth dependency by scripts/generate-auth-schema.mjs.\n" +
      sql +
      "\n",
  );
  console.log("Generated checked-in Better Auth PostgreSQL schema.");
} finally {
  await pool.end();
  await socket.stop();
  await db.close();
}
