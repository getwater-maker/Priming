'use strict';
/**
 * 🖼 그림목록 TSV → 로컬 ComfyUI 이미지 일괄 생성.
 *
 * 강의 영상(D:\비즈니스PT)처럼 **장면마다 그림이 필요한** 작업용. 음성 TSV 와 짝을 이룬다.
 *
 * 형식(탭 구분, **헤더 한 줄 있음** — 음성 TSV 와 다른 점이다):
 *   경로 · 장면번호 · 화면 한글(참고용) · positive prompt · negative prompt
 *   예) 003_돈이_만들어지는_구조/R-02.png ⇥ R-02 ⇥ 유튜브를 시작할 때 ⇥ a person… ⇥ text, letters…
 *
 * 🔑 **프롬프트는 손대지 않는다.** 스타일 문구까지 포함된 완성 프롬프트를 그대로 ComfyUI 에 넘긴다.
 *   여기서 뭔가 덧붙이면 그림체가 **두 곳에서 관리**되어 76강을 가는 동안 반드시 어긋난다
 *   (로이 결정 2026-08-27: 스타일은 대본 만드는 쪽이 관리한다).
 *
 * 🔑 **1번 칸이 곧 저장 경로다.** 음성처럼 「TSV 이름으로 폴더를 만드는」 방식이 아니다 —
 *   1번 칸에 이미 하위 폴더가 들어 있으므로 `<이미지 출력 폴더>/<1번 칸>` 에 그대로 만든다.
 */

const fs = require('fs');
const path = require('path');

const IMG_EXT = /\.(png|jpe?g|webp)$/i;

/** 경로 칸을 안전한 상대경로로 정규화. 안 되면 null + 이유. */
function normalizeRelPath(raw) {
  const t = String(raw || '').trim().replace(/\\/g, '/');
  if (!t) return { err: '경로 칸이 비어 있습니다' };
  if (/^[a-zA-Z]:\//.test(t) || t.startsWith('/')) return { err: '절대경로는 쓸 수 없습니다 — 출력 폴더 기준 상대경로로 적으세요' };
  const parts = t.split('/').filter((x) => x !== '' && x !== '.');
  if (parts.some((x) => x === '..')) return { err: '상위 폴더(..)로 나가는 경로는 쓸 수 없습니다' };
  if (!parts.length) return { err: '경로 칸이 비어 있습니다' };
  const rel = parts.join('/');
  if (!IMG_EXT.test(rel)) return { err: '파일 이름이 .png/.jpg/.webp 로 끝나야 합니다 — ' + rel };
  return { rel };
}

/**
 * 그림목록 TSV 파싱.
 * @returns {{rows: Array, errors: Array, headerSkipped: boolean}}
 *   rows[i] = { rel, scene, caption, positive, negative, line }
 */
function parseImageTsv(text) {
  const rows = [];
  const errors = [];
  const seen = new Map();
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);

  // 🔑 헤더 판별 — **첫 줄 1번 칸이 이미지 확장자로 끝나지 않으면 헤더**로 본다.
  //   데이터 행은 반드시 파일 경로라 확장자가 있다. 헤더 문구를 목록으로 못박으면(「경로」「path」…)
  //   그쪽에서 라벨을 바꾸는 순간 **첫 그림이 조용히 사라진다**.
  let headerSkipped = false;
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const first = lines[i].split('\t')[0].trim();
    if (!IMG_EXT.test(first)) { headerSkipped = true; start = i + 1; }
    else start = i;
    break;
  }

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    const line = i + 1;
    if (!raw.trim()) continue;
    const c = raw.split('\t');
    if (c.length < 4) {
      errors.push({ line, message: '칸이 모자랍니다 (경로·장면·한글·positive[·negative] — 탭으로 구분)' });
      continue;
    }
    const p = normalizeRelPath(c[0]);
    if (p.err) { errors.push({ line, message: p.err }); continue; }
    const positive = String(c[3] || '').trim();
    if (!positive) { errors.push({ line, message: 'positive 프롬프트가 비어 있습니다 — ' + p.rel }); continue; }
    // 🔴 같은 경로가 두 번 나오면 **뒤엣것이 앞엣것을 덮어쓴다**. 조용히 덮으면 그 장면이 영상에서
    //   사라지고 렌더 단계에서야 드러난다 → 여기서 세운다(음성 TSV 와 같은 정책).
    if (seen.has(p.rel)) { errors.push({ line, message: '경로가 중복입니다 (' + seen.get(p.rel) + '행과 같음) — ' + p.rel }); continue; }
    seen.set(p.rel, line);
    rows.push({
      rel: p.rel,
      scene: String(c[1] || '').trim(),
      caption: String(c[2] || '').trim(),
      positive,
      negative: String(c[4] || '').trim(),
      line,
    });
  }
  return { rows, errors, headerSkipped };
}

const MAX_CONSEC_FAIL = 5;
// 🔴 **자리표시 파일을 「이미 있음」으로 보면 안 된다.** 실제로 그림 목록을 준 쪽이 폴더 구조를 잡으려고
//   70바이트짜리 빈 png 12개를 미리 놓아 두었고, 크기를 안 보는 게이트가 그걸 전부 건너뛰어
//   **한 장도 만들지 않고 "완료"** 라고 보고했다(2026-08-27 실측). 1024x1024 PNG 는 아무리 단순해도
//   이보다 훨씬 크다.
const MIN_IMG_BYTES = 4096;

/**
 * 일괄 생성.
 * @param o.rows       parseImageTsv 결과
 * @param o.outRoot    이미지 출력 뿌리(여기에 rel 을 붙인다)
 * @param o.engine     ComfyImage 인스턴스
 * @param o.seed       고정 시드
 * @param o.dims       { w, h }
 * @param o.force      true 면 이미 있어도 다시 만든다
 * @param o.onLine     로그
 * @param o.onProgress (i, n, stat)
 * @param o.abortSignal
 */
async function runImageBatch(o) {
  const onLine = o.onLine || (() => {});
  const abort = o.abortSignal || (() => false);
  const rows = o.rows || [];
  const outRoot = o.outRoot;
  const dims = o.dims || { w: 1024, h: 1024 };

  if (!outRoot) throw new Error('이미지 출력 폴더가 정해지지 않았습니다.');
  fs.mkdirSync(outRoot, { recursive: true });

  const made = [], skipped = [], failed = [];
  let consecFail = 0, sumMs = 0, negWarned = false;
  const t0 = Date.now();
  const _stat = () => ({ made: made.length, perImageSec: made.length ? sumMs / 1000 / made.length : null });

  for (let i = 0; i < rows.length; i++) {
    if (abort()) { onLine('중단되었습니다 — ' + i + '/' + rows.length + ' 까지 처리했습니다.'); break; }
    const row = rows[i];
    const outPath = path.join(outRoot, row.rel.split('/').join(path.sep));
    const tag = '[' + (i + 1) + '/' + rows.length + '] ' + row.rel;

    // ── 이어받기: 이미 있으면 건드리지 않는다(마음에 안 드는 그림만 지우고 다시 돌리는 방식) ──
    if (!o.force && fs.existsSync(outPath)) {
      let sz = 0; try { sz = fs.statSync(outPath).size; } catch {}
      if (sz >= MIN_IMG_BYTES) {
        skipped.push(row.rel);
        if (o.onProgress) o.onProgress(i + 1, rows.length, _stat());
        continue;
      }
      onLine(tag + '  ↻ 자리표시/빈 파일(' + sz + 'B) — 다시 만듭니다');
    }

    try { fs.mkdirSync(path.dirname(outPath), { recursive: true }); } catch {}

    const g0 = Date.now();
    let r = null;
    try {
      r = await o.engine.textToImage({
        prompt: row.positive,
        negative: row.negative || undefined,
        seed: o.seed,
        dims,
        outputPath: outPath,
        abortSignal: abort,
      });
    } catch (e) { r = { success: false, error: e.message }; }

    if (!r || !r.success) {
      failed.push({ rel: row.rel, scene: row.scene, reason: (r && r.error) || '알 수 없는 오류' });
      consecFail++;
      onLine(tag + '  ✗ 실패: ' + ((r && r.error) || '알 수 없는 오류'));
      if (consecFail >= MAX_CONSEC_FAIL) {
        onLine('연속 ' + consecFail + '개 실패 — 서버 문제로 보고 멈춥니다. 남은 그림은 시도하지 않습니다.');
        break;
      }
      if (o.onProgress) o.onProgress(i + 1, rows.length, _stat());
      continue;
    }
    consecFail = 0;
    const ms = Date.now() - g0;
    sumMs += ms;
    made.push(row.rel);
    // 🔑 부정 프롬프트가 **워크플로에 들어갈 자리가 없으면** 한 번만 알린다. 조용히 버리면
    //   "negative 를 적었는데 왜 글자가 나오지?" 를 영원히 못 푼다.
    if (r.negApplied === false && row.negative && !negWarned) {
      negWarned = true;
      onLine('⚠ 이 워크플로는 **부정 프롬프트를 쓰지 않습니다** — negative 칸이 무시됩니다.');
      onLine('   (Krea2 Turbo 계열은 negative 가 ConditioningZeroOut 이고 cfg=1 이라 자리도 없고 있어도 무효입니다.');
      onLine('    글자·워터마크를 막으려면 positive 쪽에 긍정 서술로 적는 편이 실제로 듣습니다.)');
    }
    onLine(tag + '  ✓ ' + (ms / 1000).toFixed(1) + '초');
    if (o.onProgress) o.onProgress(i + 1, rows.length, _stat());
  }

  return {
    total: rows.length,
    made: made.length,
    skipped: skipped.length,
    failed,
    perImageSec: made.length ? sumMs / 1000 / made.length : null,
    elapsedSec: (Date.now() - t0) / 1000,
    outRoot,
  };
}

module.exports = { parseImageTsv, normalizeRelPath, runImageBatch, IMG_EXT };
