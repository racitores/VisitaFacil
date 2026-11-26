import {test, before,after} from 'node:test';
import assert from 'node:assert/strict';
import {setupDatabase} from './helpers.mjs';
import {createHmac,randomUUID} from 'node:crypto';
import {processOutbox} from '../server/messaging.mjs';
import {createApp} from '../server/app.mjs';
process.env.BETTER_AUTH_URL='http://localhost:31927';process.env.BETTER_AUTH_SECRET='local-test-only-secret-at-least-32-characters';
const deliveries=[];
let database,server,base='http://localhost:31927',cookieA,cookieB,companyA,companyB,clientA,visitA,planA;
const day=new Date().toISOString().slice(0,10);
async function request(path,{cookie=cookieA,company=companyA,method='GET',body,origin=base,headers={}}={}){
 const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...headers,...(cookie?{Cookie:cookie}:{}),...(company?{'X-Company-Id':company}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
before(async()=>{database=await setupDatabase();server=createApp({pool:database.pool,transport:async item=>{deliveries.push(item);return `wamid.test.${deliveries.length}`;}}).listen(31927);await new Promise(r=>server.once('listening',r));});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(database)await database.close();});
test('authenticates real passwords and isolates tenant data',async()=>{
 let r=await request('/auth/sign-up/email',{method:'POST',body:{name:'Empresa A',email:'a@example.com',password:'password-testing-A-123'}});assert.equal(r.status,200,JSON.stringify(r.body));cookieA=r.cookie;
 r=await request('/auth/sign-up/email',{method:'POST',body:{name:'Empresa B',email:'b@example.com',password:'password-testing-B-123'}});assert.equal(r.status,200,JSON.stringify(r.body));cookieB=r.cookie;
 r=await request('/companies',{method:'POST',body:{name:'A'}});assert.equal(r.status,201);companyA=r.body.id;
 r=await request('/companies',{cookie:cookieB,method:'POST',body:{name:'B'}});companyB=r.body.id;
 r=await request('/clients',{method:'POST',body:{nombre:'Cliente de A',telefono:'34600000001',fechaAlta:'2025-01-02',revisiones:[],direccion:{via:'Calle de Alcalá, 10',localidad:'Madrid',coordenadas:[-3.7,40.4]}}});assert.equal(r.status,201);clientA=r.body.id;
 assert.equal((await request('/state',{cookie:cookieB,company:companyA})).status,403);
 assert.equal((await request('/state',{cookie:cookieB,company:companyB})).body.clients.length,0);
 assert.equal((await request('/clients/'+clientA,{method:'DELETE',cookie:cookieB,company:companyB})).status,404);
 assert.equal((await request('/companies',{cookie:null})).status,401);
 assert.equal((await request('/companies',{method:'POST',origin:'https://evil.example',body:{name:'evil'}})).status,403);
 assert.equal((await request('/auth/sign-in/email',{method:'POST',body:{email:'a@example.com',password:'wrong-password-123'}})).status,401);
});
test('generates once, enforces capacity, releases and reassigns',async()=>{
 let r=await request('/visits/generate',{method:'POST',body:{until:'2099-12-31'}});assert.equal(r.body.created,1);assert.equal((await request('/visits/generate',{method:'POST',body:{until:'2099-12-31'}})).body.created,0);
 let s=(await request('/state')).body;visitA=s.visits[0].id;
 r=await request('/plans',{method:'POST',body:{day,name:'Centro',technicianId:s.userId,capacity:1,minutes:480,origin:[-3.7,40.4],destination:[-3.7,40.4]}});assert.equal(r.status,201);planA=r.body.id;
 r=await request('/visits/'+visitA+'/action',{method:'POST',body:{action:'assign',planId:planA}});assert.equal(r.status,200,JSON.stringify(r.body));
 r=await request('/visits/'+visitA+'/action',{method:'POST',body:{action:'release',reason:'No puede el cliente'}});assert.equal(r.status,200);
 s=(await request('/state')).body;assert.equal(s.visits[0].status,'pool');assert.equal(s.visits[0].plan_id,null);assert.equal(s.visits[0].reason,'No puede el cliente');
 assert.equal((await request('/visits/'+visitA+'/action',{method:'POST',body:{action:'assign',planId:planA}})).status,200);
 assert.equal((await request('/clients/'+clientA,{method:'DELETE'})).status,400);
});
test('completion updates history, prevents duplicate completion and closes visit',async()=>{
 const r=await request('/visits/'+visitA+'/action',{method:'POST',body:{action:'complete',date:day,work:'Limpieza y comprobación'}});assert.equal(r.status,200,JSON.stringify(r.body));
 const s=(await request('/state')).body;assert.equal(s.clients[0].data.revisiones.length,1);assert.equal(s.visits[0].status,'completed');
 assert.equal((await request('/visits/'+visitA+'/action',{method:'POST',body:{action:'complete',date:day,work:'Duplicada'}})).status,409);
});
let competingVisits=[],winner,otherVisit,nextDay,cookieTech,techId;
test('concurrent allocation cannot overbook the last slot or ignore availability',async()=>{
 const d=new Date();d.setDate(d.getDate()+1);nextDay=d.toISOString().slice(0,10);
 for(let i=0;i<2;i++)await request('/clients',{method:'POST',body:{nombre:`Concurrente ${i}`,telefono:`3460000000${i+2}`,fechaAlta:'2025-01-02',revisiones:[],direccion:{via:'Calle de Alcalá, 20',coordenadas:[-3.69+i*.01,40.41]}}});
 await request('/visits/generate',{method:'POST',body:{until:'2099-12-31'}});
 let s=(await request('/state')).body;competingVisits=s.visits.filter(v=>s.clients.find(c=>c.id===v.client_id).data.nombre.startsWith('Concurrente'));
 const p=await request('/plans',{method:'POST',body:{day:nextDay,name:'Último hueco',technicianId:s.userId,capacity:1,minutes:60,origin:[-3.7,40.4],destination:[-3.7,40.4]}});assert.equal(p.status,201);
 const results=await Promise.all(competingVisits.map(v=>request(`/visits/${v.id}/action`,{method:'POST',body:{action:'assign',planId:p.body.id}})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);winner=competingVisits[results.findIndex(r=>r.status===200)];otherVisit=competingVisits.find(v=>v.id!==winner.id);
 const invalid=await request(`/visits/${otherVisit.id}/action`,{method:'POST',body:{action:'availability',duration:30,availability:{excluded:[nextDay]}}});assert.equal(invalid.status,200);
 assert.equal((await request(`/visits/${otherVisit.id}/action`,{method:'POST',body:{action:'assign',planId:p.body.id}})).status,400);
 assert.equal((await request('/plans',{method:'POST',body:{day:nextDay,name:'Otra ruta mismo técnico',technicianId:s.userId,capacity:1,minutes:60,origin:[0,0],destination:[0,0]}})).status,409);
});
test('invitations bind email, are single-use and restrict technicians',async()=>{
 let r=await request('/auth/sign-up/email',{method:'POST',body:{name:'Técnico',email:'tech@example.com',password:'technician-test-password-123'}});assert.equal(r.status,200);cookieTech=r.cookie;techId=r.body.user.id;
 r=await request('/invitations',{method:'POST',body:{email:'tech@example.com',role:'technician'}});assert.equal(r.status,201);const token=r.body.token;
 assert.equal((await request('/invitations/accept',{method:'POST',cookie:cookieB,body:{token}})).status,403);
 assert.equal((await request('/invitations/accept',{method:'POST',cookie:cookieTech,body:{token}})).status,200);
 assert.equal((await request('/invitations/accept',{method:'POST',cookie:cookieTech,body:{token}})).status,400);
 const techState=(await request('/state',{cookie:cookieTech})).body;assert.equal(techState.role,'technician');assert.equal(techState.clients.length,0);assert.equal(techState.plans.length,0);
 assert.equal((await request('/clients',{method:'POST',cookie:cookieTech,body:{}})).status,403);
 assert.equal((await request(`/visits/${winner.id}/action`,{method:'POST',cookie:cookieTech,body:{action:'complete',date:day,work:'No asignada'}})).status,403);
});
test('WhatsApp queue and signed replies are idempotent; old replies cannot confirm a new appointment',async()=>{
 process.env.WHATSAPP_TOKEN='test-only';process.env.WHATSAPP_PHONE_ID='test-phone';process.env.WHATSAPP_TEMPLATE_APPOINTMENT='test_appointment';process.env.WHATSAPP_TEMPLATE_REMINDER='test_reminder';process.env.WHATSAPP_APP_SECRET='test-app-secret';
 let s=(await request('/state')).body;const c=s.clients.find(c=>c.id===winner.client_id);
 assert.equal((await request(`/clients/${c.id}`,{method:'PUT',body:{...c.data,whatsappConsent:true}})).status,200);
 let r=await request(`/visits/${winner.id}/propose`,{method:'POST',body:{}});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.sent,1);assert.equal(deliveries.length,1);
 await request(`/visits/${winner.id}/propose`,{method:'POST',body:{}});assert.equal(deliveries.length,1);
 const version=deliveries[0].version;
 async function webhook(message,bad=false){const body={entry:[{changes:[{value:{metadata:{phone_number_id:'test-phone'},messages:[message]}}]}]};const signature='sha256='+createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(JSON.stringify(body)).digest('hex');return request('/whatsapp/webhook',{method:'POST',cookie:null,body,headers:{'x-hub-signature-256':bad?'sha256=bad':signature}});}
 const msg={id:'reply-confirm',from:c.data.telefono,button:{payload:`confirm:${winner.id}:${version}`}};
 assert.equal((await webhook(msg,true)).status,403);assert.equal((await webhook(msg)).status,200);await webhook(msg);
 s=(await request('/state')).body;assert.equal(s.visits.find(v=>v.id===winner.id).status,'confirmed');
 let history=(await request(`/visits/${winner.id}/history`)).body;assert.equal(history.filter(e=>e.actor==='whatsapp'&&e.action==='confirm').length,1);
 const p=s.plans.find(p=>p.id===s.visits.find(v=>v.id===winner.id).plan_id);
 await request(`/visits/${winner.id}/action`,{method:'POST',body:{action:'release',reason:'Cambio de día'}});
 await request(`/visits/${winner.id}/action`,{method:'POST',body:{action:'assign',planId:p.id}});
 await webhook({...msg,id:'old-confirm'});
 s=(await request('/state')).body;assert.equal(s.visits.find(v=>v.id===winner.id).status,'planned');
 assert.equal((await request('/messages/reviews')).body.length,1);
 await webhook({id:'free-text',from:c.data.telefono,text:{body:'Por favor llamadme por la tarde'}});
 assert.equal((await request('/messages/reviews')).body.length,2);
 await webhook({id:'optout',from:c.data.telefono,text:{body:'BAJA'}});
 s=(await request('/state')).body;assert.equal(s.clients.find(x=>x.id===c.id).whatsapp_consent,false);assert.equal(s.visits.find(v=>v.id===winner.id).status,'planned');
 assert.equal((await request('/cron/messages',{cookie:null})).status,401);
});
test('uncertain sends do not retry automatically and cron reminders deduplicate',async()=>{
 const s=(await request('/state')).body;const v=s.visits.find(v=>v.id===winner.id);const c=s.clients.find(c=>c.id===v.client_id);
 await database.pool.query('UPDATE clients SET whatsapp_consent=true WHERE id=$1',[c.id]);
 await database.pool.query("UPDATE visits SET status='confirmed' WHERE id=$1",[v.id]);
 await database.pool.query("INSERT INTO outbox(id,company_id,visit_id,version,kind) VALUES($1,$2,$3,$4,'appointment')",[randomUUID(),companyA,v.id,v.version]);
 let calls=0;const transport=async()=>{calls++;throw Object.assign(new Error('Timeout simulado'),{uncertain:true});};
 await processOutbox(database.pool,transport,{companyId:companyA,reminders:false});await processOutbox(database.pool,transport,{companyId:companyA,reminders:false});assert.equal(calls,1);
 const uncertain=(await request('/messages')).body.find(m=>m.state==='uncertain');assert(uncertain);
 assert.equal((await request(`/messages/${uncertain.id}/reconcile`,{method:'POST',body:{result:'sent',checked:false,providerId:'wamid.manual'}})).status,400);
 assert.equal((await request(`/messages/${uncertain.id}/reconcile`,{method:'POST',body:{result:'sent',checked:true,providerId:'wamid.manual'}})).status,200);
 let reminders=0;await processOutbox(database.pool,async()=>{reminders++;return 'wamid.reminder';});await processOutbox(database.pool,async()=>{reminders++;return 'wamid.duplicate';});assert.equal(reminders,1);
});
test('dynamic grouping persists and preserves capacity and incomplete visits',async()=>{
 const r=await request('/plans/group',{method:'POST',body:{day,name:'Agrupación',technicianId:techId,capacity:2,minutes:120,origin:[-3.7,40.4],destination:[-3.7,40.4]}});assert.equal(r.status,200,JSON.stringify(r.body));assert(r.body.created>=1);
 const s=(await request('/state')).body;for(const p of s.plans){const assigned=s.visits.filter(v=>v.plan_id===p.id);assert(assigned.length<=p.capacity);assert(assigned.reduce((n,v)=>n+v.duration,0)<=p.minutes);}
 const t=(await request('/state',{cookie:cookieTech})).body;assert(t.plans.length>=1);assert(t.plans.every(p=>p.technician_id===techId));assert(t.clients.every(c=>t.visits.some(v=>v.client_id===c.id)));
});
