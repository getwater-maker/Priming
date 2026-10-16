'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recoverImages } = require('../core/image-recovery');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priming-recovery-'));
  try {
    const good = path.join(dir, '13.png');
    const group = () => ({ num: 13, imagePrompt: 'A scholar sits beside a window.', imageStatus: 'fail', imagePath: null });
    const run = (g, claude, generate, aborted) => recoverImages({ project: { title: '장면', groups: [g], getSentencesOfGroup: () => [{ text: '학자가 창밖을 본다.' }] }, groups: [g], claude, generate, aborted, log: () => {} });
    let calls = 0;
    const claude = { available: () => true, parseJson: JSON.parse, ask: async (o) => {
      assert.match(o.text, /학자가 창밖/); calls++;
      return { ok: true, text: JSON.stringify({ prompt: `A fully dressed Joseon scholar watches a garden, composition ${calls}.` }) };
    } };
    const g = group();
    assert.deepEqual(await run(g, claude, async (x) => { fs.writeFileSync(good, 'validated image'); x.imagePath = good; x.imageStatus = 'done'; }), []);
    assert.equal(calls, 1); assert.equal(g.imageCleared, false); assert.equal(g.imageError, null);

    calls = 0;
    const missing = group();
    assert.deepEqual(await run(missing, claude, async () => { throw new Error('GPU 실패'); }), [13]);
    assert.equal(calls, 2); assert.equal(missing.imageStatus, 'fail'); assert.match(missing.imageError, /복구 필요.*GPU 실패/);

    calls = 0;
    const noKey = group();
    await run(noKey, { ...claude, available: () => false }, async () => { throw new Error('호출 금지'); });
    assert.equal(calls, 0); assert.match(noKey.imageError, /API 키/);

    const unchanged = group();
    let generated = 0;
    await run(unchanged, { ...claude, ask: async () => ({ ok: true, text: JSON.stringify({ prompt: unchanged.imagePrompt }) }) }, async () => { generated++; });
    assert.equal(generated, 0); assert.equal(unchanged.imageStatus, 'fail');

    let stop = false;
    const aborted = group();
    await run(aborted, { ...claude, ask: async () => { stop = true; return { ok: true, text: JSON.stringify({ prompt: 'A new composition of the same Joseon scholar.' }) }; } }, async () => { generated++; }, () => stop);
    assert.equal(generated, 0); assert.equal(aborted.imagePrompt, 'A scholar sits beside a window.');
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const start = source.indexOf('async function runComfyImages(');
    const end = source.indexOf('\n// 초 →', start);
    let generations = 0;
    calls = 0;
    const g13 = group();
    const project = { groups: [g13], getSentencesOfGroup: () => [{ text: '학자가 창밖을 본다.' }] };
    const logs = [];
    const config = { workflowPath: 'test.json', cloud: true, concurrency: 1 };
    class ComfyImage {
      constructor() { this.baseUrl = 'test'; }
      async textToImage({ outputPath }) {
        generations++;
        fs.writeFileSync(outputPath, generations <= 3 ? 'bad' : 'good');
        return { success: true, imagePath: outputPath };
      }
    }
    const req = (id) => {
      if (id === './core/comfy-image') return { loadConfig: () => config, ComfyImage };
      if (id === './core/visual-span') return { markCovered: () => {} };
      if (id === './core/image-recovery') return { recoverImages: (opts) => recoverImages({ ...opts, claude }) };
      throw new Error('예기치 않은 의존성: ' + id);
    };
    const pipeline = { buildImagePrompt: (_, p) => p, nudgePromptForRetry: (p, level) => p + ' ' + level,
      claimPath: () => path.join(dir, 'attempt-' + (generations + 1) + '.png'), IMG_EXTS: [] };
    const runComfy = new Function('require', 'fs', 'path', 'P', 'S', 'hasVisual', 'imgDone', 'pushDtoUpdate', '_qwenRefsFor', 'looksBadImage', '_dur',
      source.slice(start, end) + '\nreturn runComfyImages;')(req, fs, path, pipeline, { abort: false }, () => false,
      (x) => !!(x.imagePath && fs.existsSync(x.imagePath)), () => {}, async () => null,
      async (file) => fs.readFileSync(file, 'utf8') === 'bad', String);
    await runComfy(project, dir, (line) => logs.push(line), null, [13]);
    assert.equal(generations, 4); assert.equal(calls, 1); assert.equal(g13.imageStatus, 'done');
    assert.equal(fs.readFileSync(g13.imagePath, 'utf8'), 'good');
    assert(logs.some((line) => line.includes('복구 완료')));
    console.log('이미지 복구: 성공·GPU 예외·키 없음·동일 프롬프트·중단 검증 통과');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
