/**
 * longform-parser.js — 롱폼(16:9) 대본(.md) 파서. 한 파일 = 한 편의 긴 영상(Project 1개).
 *
 * 본문을 sentence-splitter(splitHybrid)로 문장화하고 group-builder(buildGroupsHybrid)로
 * 묶어 { fileTitle, meta, projects: [Project] } 형태를 반환한다.
 *
 *   - 마크다운 헤더(#…) 중 "도입" 키워드 → 도입부 그룹(작게 묶음, 50자 캡)
 *   - [대괄호] 섹션 → 섹션별 한 그룹
 *   - 그 외 본론 → mainSentenceSize(기본 3문장) 단위
 *
 * 이미지/영상 프롬프트는 대본에 없으므로(빈 값) 내보내기/가져오기/API(autoFillPrompts)로 채운다.
 * 최종 산출은 .vrew (16:9) — vrew-builder 가 aspect '16:9' 를 이미 지원.
 */

const fs = require('fs');
const path = require('path');
const { Project } = require('../project-model');
const { splitHybrid, stripCharCountTail } = require('../sentence-splitter');
const { buildGroupsHybrid } = require('../group-builder');
const { getModeProfile } = require('../mode-profiles');

const H1_RE = /^#\s+(.+?)\s*$/m;

// 롱폼 그룹화 임계값 — 채널(프리셋)의 분할옵션을 우선 사용, 없으면 mode-profile(longform) 기본값.
//   over: { introSentenceSize, mainSentenceSize, shortLen, longLen } (프리셋에서 전달)
function _thresholds(over = {}) {
  const g = getModeProfile('longform').grouping; // { groupSize, introMaxChars }
  const num = (v, d) => (v != null && Number(v) > 0 ? Number(v) : d);
  return {
    shortLen: num(over.shortLen, 10),
    longLen: num(over.longLen, 20),
    vrewMaxChars: num(over.longLen, 20),
    introSentenceSize: num(over.introSentenceSize, 2),
    mainSentenceSize: num(over.mainSentenceSize, g.groupSize || 3),
    // 분할방식 — 'h3'(기본, H3 섹션 1개=그룹) / 'h2'(H2 섹션=그룹, 그 아래 H3 모두 포함) / 'sentence'(문장수).
    splitMode: (over.splitMode === 'sentence' || over.splitMode === 'h2') ? over.splitMode : 'h3',
    // 도입부 글자수 캡 해제 — 도입부 문장수(introSentenceSize)가 그룹을 결정하도록.
    //   (시간 기준 묶음은 '도입부 TTS+10초 재배치' 가 별도 담당)
    introMaxChars: 100000,
  };
}

function parseLongform(text, fallbackTitle, thresholds = {}) {
  let raw = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 출판(POD) 예약 섹션(## [헌사]·[서문]·[판권] 등)은 책 전용 — 영상 대본에서 통째로 제외.
  //   (롱폼과 출판이 한 원고(.md)를 공유: 일반 ## 장 = 영상+책 본문, ## [예약] = 책만)
  try { raw = require('./book-parser').stripBookSections(raw); } catch (_) {}

  // 파일 제목 — 첫 H1(# …) 또는 폴백(파일명)
  const h1 = raw.match(H1_RE);
  //   📏 `# 제목 / 15,761 자` 의 글자 수 꼬리는 벗긴다 — 대본 읽기·PDF·업로드 폴백 제목·헤더에 새지 않게.
  const fileTitle = (h1 ? stripCharCountTail(h1[1]) : '') || fallbackTitle || '롱폼';
  const meta = { raw: '', voice: null, aspect: '16:9' };

  // 문장화 + 그룹화 (헤더/대괄호/도입 하이브리드)
  const { items } = splitHybrid(raw);
  const { sentences, groups } = buildGroupsHybrid(items, _thresholds(thresholds));

  // 그룹 phase 라벨 — 섹션명(## 헤더/대괄호)을 그대로 배지에. 도입부는 isIntro 로 색 강조.
  for (const g of groups) {
    g.phase = g.title || (g.isIntro ? '도입부' : null);
    // 대본에 비디오(I2V) 프롬프트가 있으면 그 그룹은 i2v. 없으면 모션(켄번스).
    if (g.videoPrompt) { g.isI2V = true; g.mode = 'i2v'; }
    else { g.mode = 'motion'; g.isI2V = false; }
  }

  const proj = new Project({ sentences, groups });
  proj.mode = 'longform';
  proj.aspect = '16:9';
  proj.title = fileTitle;
  proj.shortsNum = 1;           // 한 편 — DTO/UI 가 shortsNum 으로 키잉하므로 1 고정
  proj.hookCaption = null;
  proj.fileTitle = fileTitle;
  proj.voice = meta.voice;
  proj.format = 'longform';
  // 🖼 `> 🖼️ 이미지: 이어서` — 그 H3 를 앞 그룹에 합쳐 **같은 그림**을 이어 쓴다(core/group-merge).
  //   표식이 없는 대본은 한 글자도 안 바뀐다(레거시 대본 무영향).
  proj.continueInfo = require('../group-merge').applyContinueMarkers(proj);
  // 📝 `> 📝 …` 제작 메모(낭독 제외) — 📄 대본 읽기에서만 그 장 제목 아래에 보인다(TTS·그룹·자막 무관 · v0.5.66)
  proj.readerNotes = readerNotesOf(raw);

  return { fileTitle, meta, projects: [proj], format: 'longform' };
}

/** `## 장` 아래의 `> 📝 …` 줄 → [{h2, text}] (H2 앞 머리말 메모는 넣지 않는다 — 대본 전체 주석이라 읽기엔 소음) */
function readerNotesOf(raw) {
  const out = [];
  let h2 = null, fence = false;
  for (const line of String(raw || '').split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { h2 = h[1]; continue; }
    const m = h2 != null && line.match(/^\s*>\s*📝\s*(.+?)\s*$/u);
    if (m) out.push({ h2, text: m[1].replace(/\*\*/g, '').trim() });
  }
  return out;
}

function parseLongformFile(filePath, thresholds = {}) {
  const fallback = path.basename(filePath).replace(/\.md$/i, '');
  return parseLongform(fs.readFileSync(filePath, 'utf8'), fallback, thresholds);
}

module.exports = { parseLongform, parseLongformFile, readerNotesOf };
