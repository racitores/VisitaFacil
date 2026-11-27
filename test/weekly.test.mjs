import {test} from "node:test";
import assert from "node:assert/strict";
import {weekWindow,defaultWeeklySettings,validateWeeklySettings,buildWeeklyDraft,validateWeeklyApproval} from "../dist/planificacion-semanal.mjs";
test("weekly window crosses years, respects deadlines and detects changed visits",function weeklyPure(){
 assert.deepEqual(weekWindow("2026-12-30",1),{start:"2027-01-04",end:"2027-01-10"});
 const settings=validateWeeklySettings({...defaultWeeklySettings("t"),weeksAhead:0,capacity:1,minutes:60,weekdays:[1,2,3,4,5],origin:[-3.7,40.4],destination:[-3.7,40.4]},["t"]);
 assert.throws(()=>validateWeeklySettings({...settings,technicianIds:["outsider"]},["t"]),/técnicos/);
 const clients=Array.from({length:5},(_,i)=>({id:`c${i}`,data:{direccion:{coordenadas:[-3.7+i*.01,40.4]}}}));
 const visits=clients.map((c,i)=>({id:`v${i}`,client_id:c.id,status:"pool",due_date:i===3?"2027-02-01":"2026-12-31",duration:60,availability:i===4?{from:"2027-01-05"}:{},version:1}));
 const payload=buildWeeklyDraft({settings,clients,visits,plans:[],today:"2026-12-30"});
 assert.equal(payload.assignedCount,2);assert.equal(payload.unassigned.length,2);assert.equal(payload.candidateCount,4);
 assert(payload.groups.every(g=>g.day>="2026-12-30"&&g.day<="2027-01-03"&&g.visits.length<=1));
 assert(validateWeeklyApproval({payload,clients,visits,plans:[],memberIds:["t"],today:"2026-12-30"}));
 const changed=structuredClone(visits);changed.find(v=>v.id===payload.groups[0].visits[0].visitId).version++;
 assert.throws(()=>validateWeeklyApproval({payload,clients,visits:changed,plans:[],memberIds:["t"],today:"2026-12-30"}),/cambiado/);
 assert.throws(()=>validateWeeklyApproval({payload,clients,visits,plans:[],memberIds:["t"],today:"2027-01-01"}),/pasados/);
});
