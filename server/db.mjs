import pg from "pg";
// SQL DATE is a civil day, never a UTC instant.
pg.types.setTypeParser(1082, (value) => value);
import { readFile } from "node:fs/promises";
export function database(url = process.env.DATABASE_URL) {
  if (!url)
    throw Object.assign(
      new Error("Conecta una base de datos PostgreSQL en Vercel."),
      { status: 503 },
    );
  return new pg.Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 20000,
  });
}
export async function transaction(pool, fn) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function migrate(pool) {
  const { getMigrations } = await import("better-auth/db/migration");
  const { authOptions } = await import("./auth.mjs");
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(63029341)");
    await db.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
  });
  const { runMigrations } = await getMigrations(authOptions(pool));
  await runMigrations();
}
