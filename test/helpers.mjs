import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import pg from 'pg';
import {migrate} from '../server/db.mjs';
export async function setupDatabase(){
  if(process.env.TEST_DATABASE_URL){const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:5});await migrate(pool);return {pool,close:()=>pool.end()};}
  const db=await PGlite.create();const server=new PGLiteSocketServer({db,port:55439,host:'127.0.0.1'});await server.start();
  const pool=new pg.Pool({connectionString:'postgresql://postgres:postgres@127.0.0.1:55439/postgres',max:1});
  await migrate(pool);
  return {pool,close:async()=>{await pool.end();await server.stop();await db.close();}};
}
