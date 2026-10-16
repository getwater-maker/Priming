'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const WA = require('../core/work-actions'), MP = require('../core/make-progress');
const main = fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const code = main.slice(main.indexOf('function resetWorkAbort()'),main.indexOf('async function runMakeAllCore('));
const setup = () => {
 const p={shortsNum:1,sentences:[{id:'a',num:1,text:'one'},{id:'b',num:2,text:'two'},{id:'c',num:3,text:'three'}],groups:[{num:1,sentenceIds:['a'],imagePrompt:'one'},{num:2,sentenceIds:['b','c'],imagePrompt:'two'}]};
 const item={id:'item'}, S={parsed:{fileTitle:'test',projects:[p]},abort:false};
 const events=[],ctx=new AsyncLocalStorage();
 const win={isDestroyed:()=>false,webContents:{send:(_ch,x)=>events.push(x)}};
 const factory=new Function('S','WORK_ACTIONS','workContext','workClocks','activeItem','markItemRun','pushQueueUpdate','pushDtoUpdate','WORLD','win','require','fs','rangeNums','hasVideoFile','missingVisualGroups','_itemRange','setInterval','clearInterval',
  'let workAbortEpoch=0; let _mkQueuePos=null; '+code+'; return {run:runTrackedAction,abort:()=>{workAbortEpoch++;S.abort=true;}};');
 const mark=(it,phase)=>{if(phase==='start')it.run={startedAt:Date.now()};else it.run.endedAt=Date.now();};
 const api=factory(S,WA,ctx,new WeakMap(),()=>item,mark,()=>{},()=>{},{store:()=>({item})},win,()=>MP,{existsSync:()=>true},p=>p.groups.map(g=>g.num),g=>!!g.videoPath,p=>p.groups.filter(g=>!g.imagePath&&!g.videoPath).map(g=>g.num),()=>({}),()=>1,()=>{});
 return {api,p,item,ctx,events};
};
(async()=>{
 for(const [ch,[stage,,queued]] of Object.entries(WA.ACTIONS)){
  const h=setup();const args=ch.includes('group')?{shortsNum:1,groupNum:2}:ch==='tts-sentences'?{shortsNum:1,items:[{groupNum:2,sentIdx:1}]}:{};
  await h.api.run(ch,args,async()=>{
   if(queued){assert(!h.item.run,'queue waiting is not work time');h.ctx.getStore().start();}
   for(const s of h.p.sentences){s.ttsAudioPath='audio';s.ttsDurationSec=1;}
   for(const g of h.p.groups){g.imagePath='image';g.videoPath='video';}
   return ch==='export-vrew'?{outs:[{}]}:{};
  });
  const last=h.events.at(-1);assert.equal(last.phase,'done',ch);assert.equal(last.kind,stage,ch);assert(h.item.run.endedAt,ch);
  if(ch==='tts-sentences')assert.equal(last.sent.total,1);
  if(ch==='tts-group')assert.equal(last.sent.total,2);
 }
 const scoped=WA.scope([{shortsNum:1,sentences:[{id:'a',num:1},{id:'b',num:2}],groups:[{num:1,sentenceIds:['a']},{num:2,sentenceIds:['b']}]}],{shortsNum:1,groupNum:2});
 assert.equal(MP.count(scoped).sent.cur.ord,2,'scope preserves full-script ordinal');
 const cancelled=setup();await assert.rejects(cancelled.api.run('image-build',{},async()=>{cancelled.api.abort();cancelled.ctx.getStore().start();}),/중단/);assert(!cancelled.item.run);assert.equal(cancelled.events.at(-1).phase,'aborted');
 const fail=setup();await assert.rejects(fail.api.run('image-build',{},async()=>{fail.ctx.getStore().start();throw Error('broken');}),/broken/);assert.equal(fail.events.at(-1).phase,'error');assert.equal(fail.item.status,'failed');
 const both=setup();let finish1,finish2;
 const one=both.api.run('generate-prompts-api',{},()=>new Promise(r=>finish1=r));
 const two=both.api.run('claude-vision-check',{},()=>new Promise(r=>finish2=r));
 assert.equal(both.events.at(-1).jobs.length,2);finish2({});await two;assert(!both.item.run.endedAt,'one overlapping task still running');assert.equal(both.events.at(-1).phase,'running');finish1({});await one;assert(both.item.run.endedAt);
 console.log('PASS: all '+Object.keys(WA.ACTIONS).length+' action lifecycles, scoped counts/ordinals, queue cancellation, failures, overlapping progress and clocks');
})().catch(e=>{console.error(e);process.exitCode=1;});
