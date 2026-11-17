'use strict';
// 📱 핸드폰에서 받기(v1.0.53 · 로이 2026-11-17) — PC 앱이 같은 Wi-Fi 에 작은 웹 페이지를 열고(QR), 핸드폰 브라우저가 녹음 파일을 올린다.
//   🔒 받기 창이 열려 있는 동안만 · 주소에 무작위 열쇠(token) · 그 밖의 주소는 404 · 한 번에 하나씩 받음 · 크기 상한 · 오래 쉬면 스스로 닫음
//   ⛔ 받은 파일을 직접 문장에 붙이지 않는다 — onFile(main)이 기존 음성 덮어쓰기 한 길(_ownVoiceFromFile)로 넘긴다.
//   ⛔ 방화벽·네트워크 설정을 바꾸지 않는다(처음 한 번 Windows 허용 창은 로이가 직접).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const AUDIO_EXT = ['m4a', 'mp3', 'wav', 'aac', 'ogg', 'oga', 'opus', 'flac', 'amr', '3gp', '3ga', 'mp4', 'webm', 'wma', 'caf', 'qta'];
const SKIP_IF = /vethernet|virtualbox|vmware|hyper-v|wsl|loopback|docker|npcap|bluetooth/i;

/** 핸드폰이 닿을 만한 이 PC 의 IPv4 주소들(좋은 순서) → [{ ip, name, kind:'lan'|'tailscale'|'other' }] */
function lanAddrs(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces || {})) {
    if (SKIP_IF.test(name)) continue;
    for (const a of list || []) {
      if (!a || a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue;
      const ip = a.address; const p = ip.split('.').map(Number);
      let kind = 'other', rank = 9;
      if (p[0] === 192 && p[1] === 168) { kind = 'lan'; rank = 0; }
      else if (p[0] === 10) { kind = 'lan'; rank = 1; }
      else if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) { kind = 'lan'; rank = 2; }
      else if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) { kind = 'tailscale'; rank = 5; }
      else if (p[0] === 169 && p[1] === 254) continue;   // 자동 사설 주소 = 연결 안 됨
      out.push({ ip, name, kind, rank });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map(({ rank, ...r }) => r);
}

function extOf(name) {
  const e = String(name || '').toLowerCase().replace(/^.*\./, '');
  return AUDIO_EXT.includes(e) ? e : 'bin';
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 핸드폰 브라우저에 보이는 페이지 — 바깥 자원 없음 · 상태는 2초마다 다시 읽는다 */
function pageHtml(token) {
  const base = '/r/' + token;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Priming · 내 목소리 보내기</title>
<style>
:root{--bg:#faf6f0;--card:#fffdf9;--fg:#3a342e;--mut:#8a7f72;--line:#ece3d6;--acc:#19a8d6;--ok:#4f9a3f;--bad:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#1d1f20;--card:#27292b;--fg:#eceeee;--mut:#9aa0a0;--line:#3a3d3f;--acc:#2ec4f0;--ok:#5fbf72;--bad:#e07a7a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;padding:16px}
h1{font-size:18px;margin:0 0 12px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px}
.lbl{font-size:13px;color:var(--mut);margin-bottom:6px}.txt{font-size:21px;line-height:1.55;word-break:keep-all;white-space:pre-wrap}
.btn{display:block;width:100%;padding:16px;margin:10px 0;border-radius:12px;border:0;font-size:18px;font-weight:700;text-align:center;background:var(--acc);color:#fff}
.btn.sec{background:transparent;color:var(--fg);border:2px solid var(--line)}input[type=file]{display:none}
#st{font-size:15px;min-height:22px;margin:6px 0}.ok{color:var(--ok)}.bad{color:var(--bad)}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden;display:none}.bar>span{display:block;height:100%;width:0;background:var(--acc)}
.tip{font-size:13px;color:var(--mut);line-height:1.5}ul{padding-left:18px;margin:6px 0}
</style></head><body>
<h1>🎙 Priming · 내 목소리 보내기</h1>
<div class="card"><div class="lbl" id="lbl">PC 와 연결하는 중…</div><div class="txt" id="txt"></div></div>
<label class="btn" id="b1">🎙 녹음해서 보내기<input id="f1" type="file" accept="audio/*" capture></label>
<label class="btn sec" id="b2">📂 녹음 파일 고르기<input id="f2" type="file" accept="audio/*,.m4a,.mp3,.wav,.aac,.ogg,.opus,.flac,.amr,.3gp,.3ga,.mp4,.webm"></label>
<div class="bar" id="bar"><span id="barIn"></span></div>
<div id="st"></div>
<div class="card"><div class="lbl">보낸 것</div><ul id="done"><li class="tip">아직 없습니다</li></ul></div>
<p class="tip">· 보낸 녹음이 PC 에서 고른 클립의 음성이 됩니다(앞뒤 무음은 PC 가 잘라 냅니다).<br>· 「🎙 녹음해서 보내기」는 핸드폰 녹음 앱을 엽니다(기종에 따라 파일 고르기가 열릴 수 있습니다).<br>· 아이폰 음성 메모는 「공유 → 파일에 저장」 뒤 「녹음 파일 고르기」로 고르세요.</p>
<script>
var BASE=${JSON.stringify(base)},busy=false,lost=0;
function $(i){return document.getElementById(i)}
function st(m,c){var e=$('st');e.textContent=m;e.className=c||''}
function show(s){
  if(!s||!s.ok){$('lbl').textContent=(s&&s.error)||'PC 에서 받을 클립이 없습니다';$('txt').textContent='';return}
  $('lbl').textContent='지금 넣을 문장'+(s.qn?' ('+s.qi+'/'+s.qn+')':'')+(s.own?' · 이미 내 녹음 있음(새로 보내면 바뀝니다)':'');$('txt').textContent=s.text||'';
  var ul=$('done');if(s.done&&s.done.length){ul.innerHTML='';s.done.slice(-8).reverse().forEach(function(d){var li=document.createElement('li');li.textContent=d;ul.appendChild(li)})}
}
function poll(){
  if(busy)return;
  var x=new XMLHttpRequest();x.open('GET',BASE+'/state',true);x.timeout=5000;
  x.onload=function(){if(x.status===200){lost=0;try{show(JSON.parse(x.responseText))}catch(e){}}else{lost++;if(x.status===404){$('lbl').textContent='PC 의 받기 창이 닫혔습니다 — PC 에서 다시 열고 QR 을 새로 찍으세요';$('txt').textContent=''}}};
  x.onerror=x.ontimeout=function(){lost++;if(lost>=2){$('lbl').textContent='PC 와 연결이 끊겼습니다 — 같은 Wi-Fi 인지 확인하세요';}};
  x.send();
}
function send(f){
  if(!f)return;busy=true;st('보내는 중… '+f.name);$('bar').style.display='block';$('barIn').style.width='0%';
  var x=new XMLHttpRequest();x.open('POST',BASE+'/up?name='+encodeURIComponent(f.name||'rec'),true);
  x.upload.onprogress=function(e){if(e.lengthComputable)$('barIn').style.width=Math.round(e.loaded/e.total*100)+'%'};
  x.onload=function(){busy=false;$('bar').style.display='none';var r={};try{r=JSON.parse(x.responseText)}catch(e){}
    if(x.status===200&&r.ok){st('✔ '+(r.msg||'넣었습니다'),'ok');if(r.state)show(r.state)}else st('⚠ '+(r.error||('보내지 못했습니다 ('+x.status+')')),'bad');setTimeout(poll,300)};
  x.onerror=function(){busy=false;$('bar').style.display='none';st('⚠ 보내지 못했습니다 — 같은 Wi-Fi 인지 확인하세요','bad')};
  x.send(f);
}
$('f1').onchange=function(){send(this.files[0]);this.value=''};$('f2').onchange=function(){send(this.files[0]);this.value=''};
poll();setInterval(poll,2000);
</script></body></html>`;
}

/**
 * opts: { host('0.0.0.0'), port(0 = 아무 빈 자리), maxBytes, tmpDir, idleMs,
 *         getState() → { ok, num, text, own, done[] } | { ok:false, error },
 *         onFile({ path, name, bytes }) → Promise<{ ok, msg?, error?, state? }>, log? }
 */
function createPhoneRecv(opts = {}) {
  const token = opts.token || crypto.randomBytes(16).toString('hex');
  const maxBytes = opts.maxBytes || 200 * 1048576;
  const tmpDir = opts.tmpDir || path.join(os.tmpdir(), 'priming-rec');
  const idleMs = opts.idleMs || 30 * 60 * 1000;
  const base = '/r/' + token;
  let server = null, port = 0, idleT = null, chain = Promise.resolve();
  const log = opts.log || (() => {});
  const touch = () => { if (idleT) clearTimeout(idleT); idleT = setTimeout(() => { log('📱 30분 동안 쓰지 않아 핸드폰 받기를 닫았습니다'); api.stop(); if (opts.onIdleStop) opts.onIdleStop(); }, idleMs); };
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const handler = (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== base && !u.pathname.startsWith(base + '/')) { res.writeHead(404); res.end(); return; }
    touch();
    const sub = u.pathname.slice(base.length);
    if (req.method === 'GET' && (sub === '' || sub === '/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(pageHtml(token)); return;
    }
    if (req.method === 'GET' && sub === '/state') { let s; try { s = opts.getState ? opts.getState() : null; } catch (e) { s = { ok: false, error: e.message }; } json(res, 200, s || { ok: false }); return; }
    if (req.method === 'POST' && sub === '/up') {
      const len = Number(req.headers['content-length'] || 0);
      if (len > maxBytes) { req.resume(); json(res, 413, { ok: false, error: '파일이 너무 큽니다(' + Math.round(maxBytes / 1048576) + 'MB 넘음)' }); return; }
      const name = String(u.searchParams.get('name') || 'rec').slice(0, 120);
      try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (_) {}
      const fp = path.join(tmpDir, `phone_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.${extOf(name)}`);
      const ws = fs.createWriteStream(fp); let got = 0, over = false;
      req.on('data', (d) => { got += d.length; if (got > maxBytes && !over) { over = true; req.unpipe(ws); ws.destroy(); } });
      req.pipe(ws);
      const finish = (fn) => { chain = chain.then(fn, fn); };
      ws.on('error', () => { try { fs.rmSync(fp, { force: true }); } catch (_) {} if (!res.headersSent) json(res, 500, { ok: false, error: 'PC 에 저장하지 못했습니다' }); });
      req.on('end', () => ws.end());
      ws.on('close', () => {
        if (over) { try { fs.rmSync(fp, { force: true }); } catch (_) {} if (!res.headersSent) json(res, 413, { ok: false, error: '파일이 너무 큽니다' }); return; }
        if (got < 100) { try { fs.rmSync(fp, { force: true }); } catch (_) {} json(res, 400, { ok: false, error: '받은 소리가 없습니다' }); return; }
        finish(async () => {
          let r;
          try { r = opts.onFile ? await opts.onFile({ path: fp, name, bytes: got }) : { ok: false, error: '받을 곳이 없습니다' }; }
          catch (e) { r = { ok: false, error: e.message }; }
          try { if (fs.existsSync(fp)) fs.rmSync(fp, { force: true }); } catch (_) {}
          json(res, 200, r || { ok: false });
        });
      });
      return;
    }
    res.writeHead(405); res.end();
  };
  const api = {
    token,
    get port() { return port; },
    get running() { return !!server; },
    start() {
      if (server) return Promise.resolve({ port });
      return new Promise((resolve, reject) => {
        const s = http.createServer(handler);
        s.on('error', (e) => { server = null; reject(e); });
        s.listen(opts.port || 0, opts.host || '0.0.0.0', () => { server = s; port = s.address().port; touch(); resolve({ port }); });
      });
    },
    stop() {
      if (idleT) { clearTimeout(idleT); idleT = null; }
      const s = server; server = null;
      if (s) { try { s.close(); } catch (_) {} try { if (s.closeAllConnections) s.closeAllConnections(); } catch (_) {} }
    },
    url(ip) { return `http://${ip}:${port}${base}`; },
  };
  return api;
}

module.exports = { createPhoneRecv, lanAddrs, pageHtml, extOf, AUDIO_EXT };
