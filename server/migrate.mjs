import { database, migrate } from "./db.mjs";
const db = database(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
try {
  await migrate(db);
  console.log("Esquema de aplicación y autenticación actualizado.");
} finally {
  await db.end();
}
