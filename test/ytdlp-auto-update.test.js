'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'priming-auto-update-'));
  const source = fs.readFileSync(path.join(__dirname, '..', 'core', 'media-download.js'), 'utf8');
  let latest = '2026.10.10.233141', binaryVersion = '', offline = false, failDownload = false;
  let checks = 0, downloads = 0, child;
  const log = [];
  const fakeFetch = async (url) => {
    if (url.includes('api.github.com')) {
      checks++;
      if (offline) throw new Error('offline');
      return { ok: true, json: async () => ({ tag_name: latest }) };
    }
    downloads++;
    if (failDownload) throw new Error('download failed');
    const bytes = Buffer.alloc(1024 * 1024 + 100);
    bytes.write(binaryVersion || latest);
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const req = (name) => {
    if (name === 'os') return { ...os, homedir: () => root };
    if (name === 'child_process') return {
      execFile: (cmd, args, opts, callback) => {
        if (!fs.existsSync(cmd)) return callback(new Error('not found'), '', '');
        const version = fs.readFileSync(cmd).subarray(0, 100).toString().split('\0')[0];
        callback(null, version + '\n', '');
      },
      spawn: () => { child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => child.emit('close', 1); return child; },
    };
    return require(name);
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'fetch', source)(req, mod, fakeFetch);
  const MD = mod.exports;
  const prepare = () => MD.ensureYtDlp({ onLog: (line) => log.push(line) });
  const versionOnDisk = () => fs.readFileSync(MD.OWN_EXE).subarray(0, 100).toString().split('\0')[0];
  try {
    let results = await Promise.all([prepare(), prepare()]);
    assert.equal(checks, 1); assert.equal(downloads, 1); assert.equal(results[0].version, latest);
    assert.equal(results[0], results[1]); assert.equal(versionOnDisk(), latest);
    await prepare(); assert.equal(checks, 2); assert.equal(downloads, 1);
    latest = '2026.10.11.233141';
    assert.equal((await prepare()).version, latest); assert.equal(downloads, 2);
    latest = '2026.10.10.233141';
    assert.equal((await prepare()).version, '2026.10.11.233141'); assert.equal(downloads, 2);
    offline = true;
    assert.equal((await prepare()).version, '2026.10.11.233141'); assert(log.some((line) => /기존.*보존/.test(line)));
    offline = false; latest = '2026.10.12.233141'; failDownload = true;
    assert.equal((await prepare()).version, '2026.10.11.233141'); assert.equal(versionOnDisk(), '2026.10.11.233141');
    failDownload = false; binaryVersion = '2026.01.01';
    await prepare(); assert.equal(versionOnDisk(), '2026.10.11.233141');
    assert(log.some((line) => /요청한 릴리스와 다릅니다/.test(line)));
    binaryVersion = '';

    const probe = MD.probe('https://example.test/video', { tool: { cmd: 'fake', args: [] } });
    await new Promise((resolve) => setImmediate(resolve));
    const before = downloads;
    await prepare(); assert.equal(downloads, before); assert.equal(versionOnDisk(), '2026.10.11.233141');
    child.stdout.emit('data', Buffer.from('{"id":"fake","title":"fake"}\n')); child.emit('close', 0); await probe;
    await prepare(); assert.equal(versionOnDisk(), latest);
    assert.equal(MD.compareToolVersions('2026.10.10.233141', '2026.10.10'), 1);
    console.log('자동 업데이트: 최초 설치·중복 방지·최신 유지·새 버전·하향 방지·통신/설치 실패·버전 검증·실행 중 교체 보류 통과');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
