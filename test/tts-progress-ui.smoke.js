'use strict';
const { _electron: electron } = require('playwright');
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tts-progress-')),name='__tts_progress_'+process.pid;
 const md=path.join(tmp,name+'.md');
 fs.writeFileSync(md,'# TTS 진행 확인\n\n## 도입부\n### 〔첫 장면〕\n'+Array.from({length:240},(_,i)=>`진행 확인 ${i+1}번째 문장입니다.`).join('\n'));
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
  console.log('PASS: standalone TTS popup, current clip follow, live clock, abort and cumulative resume excluding pause');
 }finally{
  if(w)await w.evaluate(name=>window.api.removePreset({name}),name).catch(()=>{});
  await app.close();fs.rmSync(tmp,{recursive:true,force:true});
  fs.rmSync(path.join(os.homedir(),'.priming-maker','projects',name+'.smproj.json'),{force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
