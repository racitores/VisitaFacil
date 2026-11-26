import {database,migrate} from './db.mjs';
const db = database();
try { await migrate(db); console.log('Esquema de aplicación y autenticación actualizado.'); }
finally { await db.end(); }
