import {database,migrate} from './db.mjs';
const configured=process.env.DATABASE_URL&&process.env.BETTER_AUTH_URL&&process.env.BETTER_AUTH_SECRET;
if(configured){const pool=database();try{await migrate(pool);console.log('Esquema PostgreSQL preparado.');}finally{await pool.end();}}
else console.log('Plataforma pendiente de conectar PostgreSQL y autenticación; demostración pública disponible.');
