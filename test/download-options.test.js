'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const MD = require('../core/media-download');
const url = 'https://www.youtube.com/watch?v=oKRJ0kiHHLw';
const arg = (a, name) => a[a.indexOf(name) + 1];

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priming-options-'));
  try {
    const opts = { outDir: dir, mode: 'video', quality: '1080', subs: true, subtitleLanguage: 'ko', subtitleTrack: 'manual' };
    let a = MD.buildDownloadArgs(url, opts);
    assert.match(arg(a, '-f'), /height<=1080/);
    assert(a.includes('--write-subs')); assert(!a.includes('--write-auto-subs')); assert.equal(arg(a, '--sub-langs'), 'ko');
    a = MD.buildDownloadArgs(url, { ...opts, mode: 'audio', audioFormat: 'm4a' });
    assert.equal(arg(a, '--audio-format'), 'm4a');
    a = MD.buildDownloadArgs(url, { ...opts, mode: 'subtitles', subtitleTrack: 'auto' });
    assert(a.includes('--skip-download')); assert(!a.includes('--extract-audio')); assert(a.includes('--write-auto-subs')); assert(!a.includes('--write-subs'));
    assert.equal(MD.normalizePlaylistUrl(url + '&list=PL_123&t=288'), 'https://www.youtube.com/playlist?list=PL_123');
    assert.throws(() => MD.normalizePlaylistUrl(url), /재생목록/);
    assert.equal(MD.selectSubtitleLanguage({ language: 'en', subLangs: [], autoLangs: ['en', 'en-orig', 'en-ko'] }), 'en-orig');
    assert.equal(MD.selectSubtitleLanguage({ language: 'en', subLangs: ['en'], autoLangs: ['en-orig'] }), 'en');
    assert.equal(MD.selectSubtitleLanguage({ language: 'en', subLangs: ['en'], autoLangs: ['en-orig'] }, 'original', 'auto'), 'en-orig');

    const vtt = 'WEBVTT\n\n00:01.200 --> 00:03.400 align:start\nHello <00:01.500><c>world</c>\n\n00:00:05.000 --> 00:00:06.000\nSecond line\n';
    const file = path.join(dir, 'T.en.vtt'); fs.writeFileSync(file, vtt);
    const srt = MD.exportSubtitles([file], 'srt')[0];
    assert.match(fs.readFileSync(srt, 'utf8'), /1\n00:00:01,200 --> 00:00:03,400\nHello world/);
    assert(!fs.readFileSync(srt, 'utf8').includes('<c>'));
    const txt = MD.exportSubtitles([file], 'txt')[0]; assert.match(fs.readFileSync(txt, 'utf8'), /Hello world/);
    assert.equal(MD.exportSubtitles([file], 'vtt')[0], file);

    const fake = path.join(dir, 'fake.js');
    fs.writeFileSync(fake, `const fs=require('fs');const a=process.argv.slice(2);const p=a[a.indexOf('-o')+1].replace('%(title)s','Existing').replace('%(ext)s',a.includes('--skip-download')?'NA':'m4a');console.log('__PRIMING_BASE__'+p);if(!a.includes('--skip-download'))fs.writeFileSync(p,'audio');if(a.includes('--write-subs'))fs.writeFileSync(p.replace(/\\.[^.]+$/,'.en.vtt'),${JSON.stringify(vtt)});`);
    const tool = { cmd: process.execPath, args: [fake] };
    const o = { tool, outDir: dir, mode: 'audio', audioFormat: 'm4a', subs: true };
    let result = await MD.download(url, o); assert(result.audio.endsWith('.m4a')); assert(result.sub.endsWith('.vtt'));
    fs.writeFileSync(path.join(dir, 'Existing.other.m4a'), 'unrelated');
    result = await MD.download(url, o); assert.equal(path.basename(result.audio), 'Existing.m4a');
    result = await MD.download(url, { ...o, mode: 'subtitles', subtitleTrack: 'manual' }); assert(result.sub && !result.audio && !result.video);
    await assert.rejects(() => MD.download(url, { ...o, mode: 'subtitles', subtitleLanguage: 'ja' }), /자막이 제공되지/);
    await assert.rejects(() => MD.download(url, { ...o, outDir: path.join(dir, 'empty'), mode: 'subtitles', subtitleTrack: 'auto' }), /자막이 제공되지/);
    let validBinary = true, blockReplacement = false, updateUrl = '';
    const mockFs = { ...fs, renameSync: (src, dest) => {
      if (blockReplacement && path.basename(src).startsWith('yt-dlp-download-')) throw new Error('교체 실패');
      return fs.renameSync(src, dest);
    } };
    const req = (name) => {
      if (name === 'os') return { ...os, homedir: () => dir };
      if (name === 'fs') return mockFs;
      if (name === 'child_process') return { execFile: (cmd, args, opts, done) => {
        assert(fs.existsSync(cmd));
        done(validBinary ? null : new Error('실행 실패'), validBinary ? '2026.10.10.233141\n' : '', '');
      }, spawn: () => { throw new Error('실제 실행 금지'); } };
      return require(name);
    };
    const fakeFetch = async (url) => { updateUrl = url; return { ok: true, arrayBuffer: async () => Buffer.alloc(1024 * 1024 + 1, 1) }; };
    const mod = { exports: {} };
    new Function('require', 'module', 'fetch', fs.readFileSync(path.join(__dirname, '..', 'core', 'media-download.js'), 'utf8'))(req, mod, fakeFetch);
    const updater = mod.exports;
    fs.mkdirSync(path.dirname(updater.OWN_EXE), { recursive: true });
    fs.writeFileSync(updater.OWN_EXE, 'original');
    await updater.downloadYtDlp({ channel: 'nightly' });
    assert.equal(updateUrl, MD.NIGHTLY_URL); assert(fs.statSync(updater.OWN_EXE).size > 1024 * 1024);
    fs.writeFileSync(updater.OWN_EXE, 'original'); validBinary = false;
    await assert.rejects(() => updater.downloadYtDlp(), /실행 검증/);
    assert.equal(fs.readFileSync(updater.OWN_EXE, 'utf8'), 'original');
    validBinary = true; blockReplacement = true;
    await assert.rejects(() => updater.downloadYtDlp(), /교체 실패/);
    assert.equal(fs.readFileSync(updater.OWN_EXE, 'utf8'), 'original');
    console.log('다운로드 옵션: 화질·음원·트랙·재생목록·자막 변환·재실행·자막 없음 검증 통과');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
