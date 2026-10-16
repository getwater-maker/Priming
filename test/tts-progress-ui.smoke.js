'use strict';
const { _electron: electron } = require('playwright');
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tts-progress-')),name='__tts_progress_'+process.pid;
 const md=path.join(tmp,name+'.md');
 // 장면 24개 × 10문장 — 그룹 칸이 ② 작업 그룹을 따라가는지도 본다(v0.9.57)
 fs.writeFileSync(md,'# TTS 진행 확인\n\n## 도입부\n'+Array.from({length:24},(_,s)=>`### 〔장면 ${s+1}〕\n`+Array.from({length:10},(_,i)=>`진행 확인 ${s*10+i+1}번째 문장입니다.`).join('\n')).join('\n\n'));
 const app=await electron.launch({args:[path.join(__dirname,'..')],env:{...process.env,PM_UI_SMOKE:'1'}});
 let w;
 try{
  w=await app.firstWindow();w.setDefaultTimeout(20000);await w.waitForSelector('h1');
  await w.evaluate(async({name,tmp})=>{await window.api.addPreset({name});await window.api.savePreset({name,patch:{outputFolder:tmp,outLong:tmp,scriptFolder:tmp}});localStorage.setItem('pm.clipDetail','1');},{name,tmp});
  await w.reload();await w.waitForSelector('h1');await w.selectOption('select[title^="채널(프리셋)"]',name);
  await app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});},md);
  await w.click('.hgroup:has(.glabel:has-text("대본")) button:has-text("열기")');await w.waitForSelector('.clip-cap');
  await w.evaluate(name=>{window.__progress=[];window.api.onMakeProgress(p=>window.__progress.push(p));window.__tts=window.api.ttsBuild({presetName:name,dry:true}).then(()=> 'done',e=>e.message);},name);
  await w.waitForSelector('[data-testid="make-progress"]');
  await w.waitForFunction(()=>window.__progress.some(p=>p.kind==='tts'&&p.phase==='running'&&p.sent.done>0));
  await w.waitForFunction(()=>{const e=document.querySelector('.tts-now');return e&&Number(e.dataset.ln)>1;});
  // 🧩 그룹 칸 = 「⚙ 작업 중」 그룹이 ② 의 문장 그룹과 같고, 칸 안에 보인다
  await w.waitForFunction(()=>{const e=document.querySelector('.tts-now');return e&&Number(e.dataset.ln)>=45;},null,{timeout:60000});
  await w.waitForTimeout(2600);
  const gs=await w.evaluate(()=>{const s=document.querySelector('.tts-now'),g=document.querySelector('.pane-groups .pg-item.work-now'),pane=document.querySelector('.pane-groups');if(!s||!g||!pane)return{miss:!g};const pr=pane.getBoundingClientRect(),er=g.getBoundingClientRect();const c=s.closest('.cut');return{ln:Number(s.dataset.ln),want:c?Number(c.dataset.g):null,g:Number(g.dataset.g),cnt:document.querySelectorAll('.pane-groups .pg-item.work-now').length,vis:er.top>=pr.top-2&&er.bottom<=pr.bottom+2,top:pane.scrollTop};});
  assert(!gs.miss,'group column must mark the working group');
  assert.equal(gs.cnt,1,'only one working group');
  assert(gs.g>=3&&gs.g===gs.want,'working group follows clip line: '+JSON.stringify(gs));
  assert(gs.vis&&gs.top>0,'group column scrolled to working group: '+JSON.stringify(gs));
  const t1=await w.locator('[data-testid="q-row"]', {hasText:name}).locator('[data-testid="q-time"]').innerText();
  await w.waitForTimeout(1100);
  const t2=await w.locator('[data-testid="q-row"]', {hasText:name}).locator('[data-testid="q-time"]').innerText();assert.notEqual(t1,t2,'time must tick');
  await w.evaluate(()=>window.api.abort());await w.evaluate(()=>window.__tts);
  const q=(await w.evaluate(()=>window.api.listQueue())).queue.longform.items.find(x=>x.file===path.basename(md));
  assert.equal(q.status,'interrupted');assert(q.run.endedAt);
  const prior=(q.run.elapsedMs||0)+q.run.endedAt-q.run.startedAt;
  await w.waitForTimeout(1200);
  await w.evaluate(name=>{window.__tts=window.api.ttsBuild({presetName:name,dry:true}).then(()=> 'done',e=>e.message);},name);
  await w.waitForFunction(async()=>{const q=(await window.api.listQueue()).queue.longform;return q.items.some(x=>x.status==='running'&&x.run&&!x.run.endedAt);});
  const q2=(await w.evaluate(()=>window.api.listQueue())).queue.longform.items.find(x=>x.id===q.id);
  assert.equal(q2.run.elapsedMs,prior,'paused duration excluded; previous work carried forward');
  await w.evaluate(()=>window.api.abort());await w.evaluate(()=>window.__tts);
  assert(await w.locator('[data-testid="make-progress"]').count());
  console.log('PASS: standalone TTS popup, current clip follow, group column follow, live clock, abort and cumulative resume excluding pause');
 }finally{
  if(w)await w.evaluate(name=>window.api.removePreset({name}),name).catch(()=>{});
  await app.close();fs.rmSync(tmp,{recursive:true,force:true});
  fs.rmSync(path.join(os.homedir(),'.priming-maker','projects',name+'.smproj.json'),{force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
