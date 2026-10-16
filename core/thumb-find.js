'use strict';
/**
 * thumb-find.js — 🖼 대본의 유튜브 썸네일 찾기(v0.9.24 · 로이 2026-10-15 「로그 창에 썸네일 탭 · 4등분」).
 *   채널사업부 패키징이 만든 썸네일 3안은 `<썸네일 폴더>\<채널 폴더>\[약칭_MMDD] 썸네일_A.png` 에 있다
 *   (정본: D:\## 아도나이로이\_시스템\제작배치.py `썸네일루트` 주석 — 채널별 하위 폴더 · 월 폴더 없음).
 *   대본 파일 이름 앞의 `[약칭_MMDD]` 가 채널마다 유일한 열쇠다 → 그 열쇠로 시작하는 그림 파일을 찾는다.
 *   · 폴더 바로 아래와 그 아래 한 단계(채널 폴더)만 본다 · `_` 로 시작하는 폴더(`_규격전_원본_…` 같은 보관함)는 건너뛴다.
 *   · 읽기만 한다(⛔ 쓰기·지우기 없음) · 비동기(메인 프로세스를 멈추지 않는다).
 * 테스트: test/thumb-find.test.js
 */
const fs = require('fs');
const path = require('path');

const IMG_RE = /\.(png|jpe?g|webp)$/i;

/** 대본 경로 → 열쇠 `[약칭_MMDD]`(없으면 '') */
function thumbKey(scriptPath) {
  const m = path.basename(String(scriptPath || '')).match(/^\[[^\]\r\n]+\]/);
  return m ? m[0] : '';
}

/** root 아래에서 key 로 시작하는 그림 — [{ path, name, mtimeMs }] 이름순 · 최대 max 개 */
async function findThumbs(root, key, max = 4, directOnly = false) {
  if (!root || (!key && !directOnly)) return [];
  const out = [];
  const scan = async (dir) => {
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return []; }
    return ents;
  };
  const top = await scan(root);
  const dirs = [root];
  for (const e of top) if (!directOnly && e.isDirectory() && !e.name.startsWith('_')) dirs.push(path.join(root, e.name));
  for (const d of dirs) {
    const ents = d === root ? top : await scan(d);
    for (const e of ents) {
      if (!e.isFile() || !e.name.startsWith(key) || !IMG_RE.test(e.name)) continue;
      const p = path.join(d, e.name);
      let mtimeMs = 0;
      try { mtimeMs = (await fs.promises.stat(p)).mtimeMs; } catch (_) {}
      out.push({ path: p, name: e.name, mtimeMs });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return out.slice(0, max);
}

module.exports = { thumbKey, findThumbs };
