'use strict';
const { _electron: electron } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
(async () => {
  const root = path.join(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-resume-'));
  const name = '__queue_resume_' + process.pid;
  const files = ['unfinished','new'].map(x => path.join(tmp, name + '_' + x + '.md'));
  for (let i=0;i<2;i++) fs.writeFileSync(files[i], '# 재개 점검\n\n## 도입부\n### 〔첫 장면〕\n' + Array.from({length:i ? 2 : 24}, (_, n) => `재개 확인 ${n+1}번째 문장입니다.`).join('\n'));
  const app = await electron.launch({args:[root], env:{...process.env, PM_UI_SMOKE:'1'}});
  let win;
  try {
    win = await app.firstWindow(); await win.waitForSelector('h1');
    await win.evaluate(async ({name,tmp}) => { await window.api.addPreset({name}); await window.api.savePreset({name,patch:{outputFolder:tmp,outLong:tmp,scriptFolder:tmp}}); }, {name,tmp});
    for(const file of files) {
      await app.evaluate(({dialog}, p) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[p]}); }, file);
      await win.evaluate(name => window.api.openScript({presetName:name}),name);
    }
    const q = (await win.evaluate(() => window.api.listQueue())).queue.longform.items;
    const a=q.find(x=>x.file.includes('_unfinished')), b=q.find(x=>x.file.includes('_new'));
    assert(a&&b);
    const args={plan:[{id:a.id},{id:b.id}], common:{presetName:name,dry:true,imgEngine:'comfy::dummy.json',videoEngine:'none',outMode:'audio',outTarget:'vrew'},openEach:false};
    await win.evaluate(args=> { window.__batch=window.api.runBatch(args); },args);
    await win.waitForFunction(async id => (await window.api.listQueue()).queue.longform.items.find(x=>x.id===id)?.status==='running',a.id);
    await win.evaluate(()=>window.api.abort());
    const stopped = await win.evaluate(()=>window.__batch);
    assert.equal(stopped.aborted,true);
    assert.equal(stopped.queue.longform.items.find(x=>x.id===a.id).status,'interrupted');
    assert.notEqual(stopped.queue.longform.items.find(x=>x.id===b.id).status,'done');
    assert(!stopped.queue.longform.items.find(x=>x.id===b.id).run);
    const finished=await win.evaluate(args=>window.api.runBatch(args),{...args,plan:[{id:b.id},{id:a.id}]});
    const aa=finished.queue.longform.items.find(x=>x.id===a.id), bb=finished.queue.longform.items.find(x=>x.id===b.id);
    assert.equal(aa.status,'done'); assert.equal(bb.status,'done');
    assert(aa.run.completed && bb.run.completed);
    assert(aa.run.endedAt <= bb.run.startedAt, 'unfinished must finish before new item even with reversed plan');
    const again=await win.evaluate(args=>window.api.runBatch(args),args);
    assert.equal(again.queue.longform.items.find(x=>x.id===a.id).run.startedAt,aa.run.startedAt,'verified done is skipped');
    // Fresh unfinished items: missing visual assets must stop the queue instead of claiming completion.
    const failedFiles = ['failure', 'after_failure'].map(x => path.join(tmp, name + '_' + x + '.md'));
    files.push(...failedFiles);
    for (const file of failedFiles) {
      fs.writeFileSync(file, '# 출력 실패 점검\n\n## 도입부\n### 〔첫 장면〕\n> 🖼️ 이미지: quiet room\n완료할 수 없는 그림입니다.\n');
      await app.evaluate(({dialog}, p) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[p]}); }, file);
      await win.evaluate(name => window.api.openScript({presetName:name}),name);
    }
    const fq = (await win.evaluate(() => window.api.listQueue())).queue.longform.items;
    const f = fq.find(x=>x.file===path.basename(failedFiles[0])), next = fq.find(x=>x.file===path.basename(failedFiles[1]));
    const failed = await win.evaluate(args=>window.api.runBatch(args), {...args, plan:[{id:f.id},{id:next.id}],common:{...args.common,outMode:'full'}});
    assert.equal(failed.failed,1);
    assert.equal(failed.queue.longform.items.find(x=>x.id===f.id).status,'failed');
    assert(!failed.queue.longform.items.find(x=>x.id===next.id).run, 'failure must not advance queue');
    console.log('PASS: real mid-run abort; no next item; resume unfinished first; verified completion; completed item skip; output failure stops queue');
  } finally {
    if(win) await win.evaluate(name=>window.api.removePreset({name}),name).catch(()=>{});
    await app.close();
    fs.rmSync(tmp,{recursive:true,force:true});
    for(const file of files) { const snap=path.join(os.homedir(),'.priming-maker','projects',path.basename(file,'.md')+'.smproj.json'); try {fs.rmSync(snap,{force:true});}catch{} }
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
