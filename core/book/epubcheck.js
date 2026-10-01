'use strict';
/**
 * epubcheck.js — W3C EPUBCheck 실행(이 PC 에 도구가 있을 때만). 도구는 앱에 넣지 않는다(JRE ~44MB + jar ~33MB):
 *   `~/.priming-maker/tools/` 에 jdk-…-jre 폴더의 bin/java.exe 와 epubcheck-… 폴더의 epubcheck.jar 가 있으면 쓴다(로이 승인 2026-10-01 · 메인 PC 에 설치).
 *   없으면 { missing:true } — 앱은 그대로 동작하고 검증만 못 한다(fail-open).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function toolsDir(home) { return path.join(home || os.homedir(), '.priming-maker', 'tools'); }
function findTools(home) {
  const dir = toolsDir(home);
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) { return null; }
  const jreDir = ents.filter((n) => /^jdk-.*jre$/i.test(n) || /^jre/i.test(n)).sort().pop();
  const ecDir = ents.filter((n) => /^epubcheck-/i.test(n)).sort().pop();
  if (!jreDir || !ecDir) return null;
  const java = path.join(dir, jreDir, 'bin', 'java.exe');
  const jar = path.join(dir, ecDir, 'epubcheck.jar');
  return fs.existsSync(java) && fs.existsSync(jar) ? { java, jar, version: ecDir.replace(/^epubcheck-/i, '') } : null;
}
/** @returns Promise<{missing?:true, ok?:bool, version, epubVersion, nFatal, nError, nWarning, messages:[{severity,id,message,where}], error?}> */
function runEpubCheck(epubPath, opts = {}) {
  return new Promise((resolve) => {
    const tools = opts.tools || findTools(opts.home);
    if (!tools) { resolve({ missing: true }); return; }
    const jsonOut = path.join(os.tmpdir(), `epubcheck-${process.pid}-${Date.now()}.json`);
    const cp = spawn(tools.java, ['-jar', tools.jar, epubPath, '--json', jsonOut], { windowsHide: true });
    let err = '';
    cp.stderr.on('data', (d) => { err += d.toString('utf8'); });
    cp.stdout.on('data', () => {});
    const killer = setTimeout(() => { try { cp.kill(); } catch (_) {} }, (opts.timeoutSec || 180) * 1000);
    cp.on('error', (e) => { clearTimeout(killer); resolve({ error: e.message }); });
    cp.on('close', () => {
      clearTimeout(killer);
      try {
        const d = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
        try { fs.unlinkSync(jsonOut); } catch (_) {}
        const c = d.checker || {};
        const messages = (d.messages || []).map((m) => ({
          severity: m.severity, id: m.ID, message: m.message,
          where: ((m.locations || [])[0] ? `${(m.locations[0].path || '').split('/').pop()}${m.locations[0].line > 0 ? ':' + m.locations[0].line : ''}` : ''),
        }));
        resolve({ ok: (c.nFatal || 0) + (c.nError || 0) === 0, version: c.checkerVersion || tools.version, epubVersion: (d.publication || {}).ePubVersion || '',
          nFatal: c.nFatal || 0, nError: c.nError || 0, nWarning: c.nWarning || 0, messages });
      } catch (e) { resolve({ error: (err.trim().split('\n')[0] || e.message).slice(0, 200) }); }
    });
  });
}
module.exports = { findTools, runEpubCheck, toolsDir };
