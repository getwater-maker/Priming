/**
 * mode-profiles.js — 모드(롱폼/출판) 워크플로 차이를 단일 설정 객체로 격리.
 *
 * `if (mode === 'longform')` 분기를 코드 전체에 흩뿌리지 않고 여기서 한 번에 정의한다.
 * pipeline / main 의 함수들이 project.mode 로 프로파일을 조회해 동작을 결정한다.
 * ⚠ 쇼츠·플리 모드는 2026-08-22 제거됨 — normalizeMode 가 옛 저장값('shorts'/'playlist')을
 *   롱폼으로 정규화한다(옛 workspace.json·.smproj 가 들어와도 크래시하지 않게).
 *
 *   - longform: 가로 16:9. sentence-splitter + group-builder · 도입부 50자 캡 · 자막 길게.
 *   - book:     출판(POD) PDF. 롱폼과 원고(.md) 공유.
 *
 * 최종 산출은 .vrew (최종 MP4 렌더는 Vrew 에서 직접 — video-renderer 미사용).
 */

const MODE_PROFILES = {
  longform: {
    label: '롱폼',
    defaultAspect: '16:9',
    aspectOptions: ['16:9'],
    parser: 'sentence-splitter',                   // core/parsers/longform-parser (Phase 3 이식)
    grouping: { strategy: 'group-builder', groupSize: 3, introMaxChars: 50 },
    captionMaxChars: 18,
    videoCap: { grok: 6, flow: 8 },
    defaultTtsSpeed: 1.15,                         // 롱폼 음성배속 — 합성 1.0 → atempo 1.15배
    // 자막 기본 스타일 — 롱폼(위치조정.vrew 분석값): 아래 기준 + -50(=-0.125), 왼쪽 정렬, 크기 100, 너비 96%.
    captionYAlign: 'bottom',       // 세로 기준 = 아래 (위치조정.vrew 와 일치)
    captionYOffset: -0.125,        // Vrew 상하값 -50
    captionAlign: 'start',         // 왼쪽 정렬 (좌)
    captionSize: 100,
    presetKind: 'channel',
    vrewPrefix: '롱폼',
  },
  // 리모션(remotion) — TSV(`파일명<탭>문장`) 를 받아 그 이름 그대로 mp3 를 낸다.
  //   영상은 리모션이 만들고 이 앱은 **음성만** 담당한다 → 자막·이미지·비디오·.vrew 가 전부 없다.
  //   그래서 채널 편집에서 「자막·분할」·「제작 도구」 탭을 감추고, 폴더는 mp3 출력 하나만 쓴다.
  remotion: {
    label: '리모션',
    defaultAspect: '16:9',
    aspectOptions: ['16:9'],
    parser: 'tsv',                                 // core/tsv-tts.parseTsv
    grouping: { strategy: 'none' },
    defaultTtsSpeed: 1.0,                          // 배속은 채널에서 정한다(기본 원속)
    presetKind: 'channel',
    vrewPrefix: '리모션',
    // 이 모드가 쓰지 않는 것들 — UI 가 이 플래그로 탭을 감춘다.
    noCaption: true,
    noVisuals: true,
    noVrew: true,
    audioOnly: true,
  },
  // 출판(book) — POD 출판용 PDF 생성 전용. 롱폼과 원고(.md) 공유. TTS·이미지·.vrew 없음.
  book: {
    label: '출판',
    defaultAspect: '16:9',
    aspectOptions: ['16:9'],
    parser: 'book',                                // core/parsers/book-parser
    grouping: { strategy: 'none' },
    presetKind: 'channel',
    vrewPrefix: '출판',
  },
};

function normalizeMode(mode) {
  if (mode === 'book') return 'book';
  if (mode === 'remotion') return 'remotion';
  // 'shorts'/'playlist' 는 제거된 모드(2026-08-22) — 옛 저장 데이터가 들어와도 롱폼으로 흡수한다.
  return 'longform';
}

function getModeProfile(mode) {
  return MODE_PROFILES[normalizeMode(mode)];
}

module.exports = { MODE_PROFILES, getModeProfile, normalizeMode };
