// 자막 효과 키프레임 데이터 생성기 — Vrew 설치본 scene-*.js 에서 뽑은 @keyframes 텍스트(### 이름 줄 + 본문) → core/caption-anim-data.js
// 사용: node scripts/gen-caption-anim-data.js <keyframes.txt> core/caption-anim-data.js
// keyframes.txt 만드는 법: scene-*.js 에서 {name:"asset-effect-…",keyframes:`…`} 를 뽑아 「### 이름」 줄 + 본문으로 잇는다.
const fs=require('fs');
const txt=fs.readFileSync(process.argv[2],'utf8');
const blocks=txt.split('### ').filter(Boolean);
const out={};
function parseLen(s){s=s.trim();let m;if((m=/^(-?[\d.]+)(px|%|vw|vh)?$/.exec(s)))return {v:+m[1],u:m[2]||'px'};return {v:0,u:'px'};}
function parseTransform(t){const o={};const re=/([a-zA-Z0-9]+)\(([^)]*)\)/g;let m;
 while((m=re.exec(t))){const fn=m[1],args=m[2].split(',').map(x=>x.trim());
  if(fn==='translate3d'||fn==='translate'){const x=parseLen(args[0]),y=parseLen(args[1]||'0');o.tx=x;o.ty=y;}
  else if(fn==='translateX')o.tx=parseLen(args[0]); else if(fn==='translateY')o.ty=parseLen(args[0]);
  else if(fn==='scale3d'){o.sx=+args[0];o.sy=+args[1];}
  else if(fn==='scale'){o.sx=+args[0];o.sy=args[1]!=null?+args[1]:+args[0];}
  else if(fn==='scaleX')o.sx=+args[0]; else if(fn==='scaleY')o.sy=+args[0];
  else if(fn==='rotate')o.rz=parseFloat(args[0]);
  else if(fn==='rotate3d'){const[x,y,z,d]=args;const deg=parseFloat(d);if(+z)o.rz=deg*Math.sign(+z);else if(+x)o.rx=deg;else if(+y)o.ry=deg;}
  else if(fn==='skewX')o.skx=parseFloat(args[0]);
  else if(fn==='perspective'){} else console.error('unknown fn',fn);
 } return o;}
for(const b of blocks){const nl=b.indexOf('\n');const name=b.slice(0,nl).trim().replace(/^asset-effect-/,'');const body=b.slice(nl+1);
 const inner=body.slice(body.indexOf('{')+1,body.lastIndexOf('}'));
 const frames=[];const re=/([^{}]+)\{([^{}]*)\}/g;let m;
 while((m=re.exec(inner))){const sels=m[1].split(',').map(s=>s.trim()).map(s=>s==='from'?0:s==='to'?100:parseFloat(s));
  const decl={};for(const d of m[2].split(';')){const i=d.indexOf(':');if(i<0)continue;const k=d.slice(0,i).trim(),v=d.slice(i+1).trim();
   if(k==='opacity')decl.op=+v; else if(k==='transform'||k==='-webkit-transform'){if(k==='transform'){decl.t=1;Object.assign(decl,parseTransform(v));} else if(!decl._t)Object.assign(decl,parseTransform(v));}
   else if(k==='top')decl.ty=parseLen(v); }
  for(const p of sels)frames.push({p,...decl});}
 frames.sort((a,b)=>a.p-b.p);
 // 같은 p 합치기
 const merged=[];for(const f of frames){const l=merged[merged.length-1];if(l&&l.p===f.p)Object.assign(l,f);else merged.push({...f});}
 out[name]=merged;}
let js="'use strict';\n\n/**\n * caption-anim-data.js — 자막 효과 키프레임(자동 생성 · 손으로 고치지 말 것).\n * 출처: Vrew 설치본 resources/static/assets/scene-*.js 의 `asset-effect-*` @keyframes (animate.css 계열 · MIT).\n * 생성: scripts/gen-caption-anim-data.js (2026-09-25). 값: p=진행 %, op=불투명도, tx/ty={v,u}(px|%|vw|vh), sx/sy=배율, rz/rx/ry=회전(도), skx=기울임(도).\n */\nconst KF = ";
js+=JSON.stringify(out)+";\n\nmodule.exports = { KF };\n";
fs.writeFileSync(process.argv[3],js);console.log(Object.keys(out).length, 'keys');
