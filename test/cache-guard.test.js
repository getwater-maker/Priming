'use strict';
/**
 * test/cache-guard.test.js — 미디어 캐시가 '이상 이미지(검정·노이즈)'를 되살리지 못하는지
 *
 * 🔴 실제로 그랬다(로이 2026-08-19): 노이즈를 감지해 지웠는데 다음 실행에서
 *    `♻ 이미지 3개 재활용(캐시)` 로 **그대로 복구**됐다. `imageCleared` 플래그는 스냅샷에
 *    저장되지 않아 앱을 껐다 켜면 사라지므로, **캐시 항목 자체를 지워야** 한다.
 *    prefillImageCache 가 캐시가 나가는 유일한 문이라 거기서 검사한다.
 * 🔑 함수는 main.js 원문에서 뽑아 실행한다(복사하면 앱과 갈라져도 통과해 버린다).
 *
 * 실행: node test/cache-guard.test.js
 */
const fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process');
const ff=require('../core/media-utils').getFfmpegPath();
const MC=require('../core/media-cache');
const src=fs.readFileSync(require('path').join(__dirname,'..','main.js'),'utf8');
const cut=(startMark,endMark)=>{const a=src.indexOf(startMark);const b=src.indexOf('\n}\n', src.indexOf(endMark,a))+3;return src.slice(a,b);};
const blk = [
  cut('const BAD_DARK_MEAN','return _visRemember(key, ok.every'),
  cut('async function _mapLimit','return out;'),
  cut('function hasVisual','return !!((g.imagePath'),
  cut('async function prefillImageCache','return n;'),
].join(String.fromCharCode(10));
const m={exports:{}};
new Function('fs','path','require','log','pushDtoUpdate','module',
  blk+'\nmodule.exports={prefillImageCache};')
  (fs,path,(x)=>require(x.startsWith('./')?path.join(__dirname,'..',x):x),(s)=>console.log('   [로그]',s),()=>{},m);
const {prefillImageCache}=m.exports;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cachetest-'));
const mk=(n,args)=>{const o=path.join(tmp,n);execFileSync(ff,['-y','-hide_banner','-loglevel','error',...args,o]);return o;};
const noise=mk('noise.png',['-f','lavfi','-i','nullsrc=s=1344x768','-vf','geq=random(1)*255:random(2)*255:random(3)*255','-frames:v','1']);
const good =mk('good.png', ['-f','lavfi','-i','gradients=s=1344x768:c0=0x102030:c1=0xd0c0a0','-frames:v','1']);
const proj={aspect:'16:9', groups:[
  {num:1, imagePrompt:'TEST-NOISE-'+Date.now(), imagePath:null},
  {num:2, imagePrompt:'TEST-GOOD-'+Date.now(),  imagePath:null}]};
const kN=MC.imageKey(proj.groups[0].imagePrompt,'st','16:9','comfy');
const kG=MC.imageKey(proj.groups[1].imagePrompt,'st','16:9','comfy');
MC.put(kN,noise,'png'); MC.put(kG,good,'png');
console.log('캐시 심음 — 노이즈',!!MC.get(kN),'/ 정상',!!MC.get(kG));
const outDir=path.join(tmp,'media');
(async()=>{
const n=await prefillImageCache(proj,outDir,'st','comfy');
let pass=0,fail=0; const ck=(t,ok)=>{ok?(pass++,console.log('  ✓',t)):(fail++,console.log('  ✗',t))};
ck('재활용 개수 = 1 (정상만)', n===1);
ck('노이즈 그룹은 이미지 없음', !proj.groups[0].imagePath);
ck('노이즈 그룹 imageCleared 표시', proj.groups[0].imageCleared===true);
ck('노이즈 파일이 출력폴더에 안 남음', !fs.existsSync(path.join(outDir,'01.png')));
ck('노이즈 캐시 항목 삭제됨(영구 차단)', !MC.get(kN));
ck('정상 그룹은 그대로 재활용', !!proj.groups[1].imagePath && fs.existsSync(proj.groups[1].imagePath));
ck('정상 캐시는 보존', !!MC.get(kG));
try{MC.del(kG);}catch{} try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
console.log(`\n${pass}/${pass+fail} 통과`); process.exit(fail?1:0);
})();
