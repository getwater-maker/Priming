'use strict';
/**
 * test/media-download.test.js — 🔗 URL 다운로드 → STT
 *
 * 🔑 원문 모듈을 그대로 require 해 실행한다. 로직을 복사해 두면 앱과 갈라져도 테스트가 통과한다.
 * ⚠ 네트워크를 쓰지 않는다 — 실제 유튜브 왕복은 사람이 한 번 돌려 확인한다(README 성격의 실측 기록은 CLAUDE.md).
 */
const fs = require('fs');
const path = require('path');
const MD = require('../core/media-download');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)})`);
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

// 🔴 실제 유튜브 자동자막(2026-09-15 · LwNKjCPXXgo)의 머리 부분 그대로.
//    롤업이라 **같은 문장이 다음 큐에 다시 실려 온다** + 단어마다 <타임><c> 태그가 박혀 있다.
const REAL_VTT = [
  'WEBVTT',
  'Kind: captions',
  'Language: ko',
  '',
  '00:00:00.199 --> 00:00:02.070 align:start position:0%',
  ' ',
  '불꽃<00:00:00.640><c> 야구투</c><00:00:01.040><c> 18회의</c><00:00:01.560><c> 최고</c><00:00:01.839><c> 동시</c>',
  '',
  '00:00:02.070 --> 00:00:02.080 align:start position:0%',
  '불꽃 야구투 18회의 최고 동시',
  ' ',
  '',
  '00:00:02.080 --> 00:00:03.149 align:start position:0%',
  '불꽃 야구투 18회의 최고 동시',
  '시청자<00:00:02.520><c> 수는</c><00:00:02.960><c> 약</c>',
  '',
  '00:00:03.149 --> 00:00:03.159 align:start position:0%',
  '시청자 수는 약',
  ' ',
  '',
  '00:00:03.159 --> 00:00:05.030 align:start position:0%',
  '시청자 수는 약',
  '16만2,000명이었습니다.',
  '',
].join('\n');

console.log('\n[1] yt-dlp 버전 판정 — 낡은 판은 오디오가 403 으로 죽는다(실측)');
{
  const now = Date.parse('2026-09-15T00:00:00Z');
  eq(MD.versionAgeDays('2026.07.04', now), 73, '2026.07.04 은 73일 된 판');
  eq(MD.isStale('2026.07.04', now), true, '🔴 그 판이 실제로 403 을 냈다 → stale');
  eq(MD.versionAgeDays('2026.08.19', now), 27, '2026.08.19 은 27일');
  eq(MD.isStale('2026.08.19', now), false, '그 판은 정상 동작했다 → stale 아님');
  eq(MD.isStale('nightly', now), false, '못 읽는 버전은 낡았다고 단정하지 않는다(fail-open)');
  eq(MD.versionAgeDays('', now), null, '빈 값은 null');
  ok(MD.parseVersionDate('2026.08.19.123456') instanceof Date, 'nightly 접미가 붙어도 날짜를 읽는다');
  ok(MD.STALE_DAYS <= 73, `상한이 실사고(73일)보다 낮다 — 안 그러면 같은 사고를 또 겪는다 (${MD.STALE_DAYS}일)`);
}

console.log('\n[2] 자막(VTT) → 텍스트 — 🔴 롤업 중복을 못 걷으면 분량이 3배가 된다');
{
  const lines = MD.vttToText(REAL_VTT);
  const joined = lines.join(' ');
  eq(lines.length, 3, '실제 자막 머리에서 나온 줄 수');
  eq(joined, '불꽃 야구투 18회의 최고 동시 시청자 수는 약 16만2,000명이었습니다.', '내용이 그대로 이어진다');
  ok(!/<\d{2}:\d{2}:\d{2}/.test(joined), '단어별 타이밍 태그가 남지 않는다');
  ok(!/<c>|<\/c>/.test(joined), '서식 태그가 남지 않는다');
  ok(!joined.includes('WEBVTT') && !joined.includes('Kind:'), '헤더가 섞이지 않는다');
  ok(!joined.includes('-->'), '타임코드가 섞이지 않는다');
  // 🔑 중복 제거가 실제로 일하는지 — 태그만 걷고 중복을 남기면 줄이 7개가 된다.
  const naive = REAL_VTT.split('\n').map((s) => s.replace(/<[^>]*>/g, '').trim())
    .filter((s) => s && !s.includes('-->') && !/^(WEBVTT|Kind|Language)/.test(s));
  ok(naive.length > lines.length, `중복 제거 전 ${naive.length}줄 → 후 ${lines.length}줄 (실제로 걷어낸다)`);
  eq(new Set(lines).size, lines.length, '결과에 같은 줄이 남아 있지 않다');
}

console.log('\n[3] VTT 파서 — 그 밖의 형식');
{
  eq(MD.vttToText('').length, 0, '빈 입력');
  eq(MD.vttToText(null).length, 0, 'null');
  // SRT 도 같은 함수로 처리된다(큐 번호 줄을 버린다)
  const srt = '1\n00:00:01,000 --> 00:00:02,000\n첫 줄\n\n2\n00:00:02,000 --> 00:00:03,000\n둘째 줄\n';
  eq(MD.vttToText(srt).join('|'), '첫 줄|둘째 줄', 'SRT 의 큐 번호를 본문으로 오인하지 않는다');
  // HTML 엔티티 — ⚠ &amp; 를 먼저 풀면 &amp;lt; 가 두 번 풀려 <  가 된다
  eq(MD.vttToText('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA &amp;lt; B &amp; C').join(''), 'A &lt; B & C',
    '&amp; 를 마지막에 풀어 이중 디코드를 막는다');
  eq(MD.vttToText('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i>기울임</i> 글자').join(''), '기울임 글자', '서식 태그 제거');
  // 롤업이 2줄씩 실려 와도 걷어낸다(직전 1줄만 보면 놓친다)
  const roll = ['WEBVTT', '',
    '00:00:01.000 --> 00:00:02.000', '가', '나', '',
    '00:00:02.000 --> 00:00:03.000', '가', '나', '다', ''].join('\n');
  eq(MD.vttToText(roll).join('|'), '가|나|다', '🔑 최근 여러 줄을 함께 보므로 2줄 롤업도 걸러진다');
  // 숫자만 있는 **본문**은 SRT 번호와 구분되지 않는다 — 알려진 한계(경계 기록)
  ok(MD.vttToText('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n2024').length === 0,
    '⚠ 알려진 한계: 숫자만인 자막 줄은 SRT 번호로 보고 버린다');
}

console.log('\n[4] 자막 언어 — 🔴 번역본을 집으면 STT 보다 나쁜 결과를 조용히 쓴다');
{
  eq(MD.subLangPref('ko').join(','), 'ko-orig,ko', '한국어 영상은 원본 자동자막 우선');
  eq(MD.subLangPref('ja').join(','), 'ja-orig,ja', '일본어 영상은 **일본어** 원본 — ko 번역본을 받지 않는다');
  eq(MD.subLangPref('en-US').join(','), 'en-orig,en', '지역 코드가 붙어도 기본 언어로 자른다');
  eq(MD.subLangPref('').join(','), 'ko-orig,ko,en-orig,en', '언어를 모를 때만 폴백 목록');
}

console.log('\n[5] 실패 문구 — 무엇을 해야 하는지 알려준다');
{
  ok(/업데이트/.test(MD._explain('ERROR: unable to download video data: HTTP Error 403: Forbidden')),
    '403 은 「낡은 yt-dlp」로 안내한다(실사고 그대로)');
  ok(/비공개|연령|멤버십/.test(MD._explain('ERROR: Private video. Sign in if you have been granted access')), '비공개 영상');
  ok(/찾을 수 없/.test(MD._explain('ERROR: Video unavailable')), '삭제·지역제한');
  ok(/지원하지 않는/.test(MD._explain('ERROR: Unsupported URL: https://example.com/x')), '지원 안 하는 주소');
  ok(/네트워크/.test(MD._explain('ERROR: Unable to download webpage: getaddrinfo ENOTFOUND')), '네트워크 끊김');
  eq(MD._explain(''), '', '빈 stderr 는 빈 문자열(호출부가 기본 문구를 쓴다)');
}

console.log('\n[6] 배선 — 한쪽만 고쳐져 갈라지지 않는지 원문으로 대조');
{
  const main = read('main.js');
  const pre = read('preload.js');
  const app = read('renderer/src/App.jsx');

  ok(/async function transcribeToTxt\(/.test(main), '「파일 → .txt」 가 함수로 분리돼 있다');
  // 🔑 STT 버튼과 URL 경로가 **같은 함수**를 쓴다 — 두 벌이면 v0.3.92 의 m4a 게이트 같은 사고가 재발한다
  const calls = (main.match(/await transcribeToTxt\(/g) || []).length;
  ok(calls >= 2, `두 경로가 그 함수를 공유한다 (호출 ${calls}곳)`);
  ok(!/asr\.needsAudioConvert/.test(main.split("ipcMain.handle('stt-transcribe'")[1] || ''),
    '옛 변환 코드가 STT 핸들러에 복제돼 남아 있지 않다');

  ok(/ipcMain\.handle\('stt-from-url'/.test(main), 'IPC stt-from-url');
  ok(/ipcMain\.handle\('ytdlp-status'/.test(main), 'IPC ytdlp-status');
  ok(/ipcMain\.handle\('ytdlp-update'/.test(main), 'IPC ytdlp-update');
  ok(/sttFromUrl:/.test(pre) && /ytdlpStatus:/.test(pre) && /ytdlpUpdate:/.test(pre), 'preload 3개');

  // 재생목록 하나가 수백 개를 받는 사고를 구조로 막는다
  const dl = read('core/media-download.js');
  ok(/'--no-playlist'/.test(dl), "🔑 --no-playlist 가 기본이다(재생목록 폭주 차단)");
  ok(/'--windows-filenames'/.test(dl), '--windows-filenames 로 금지문자만 거른다');
  // ⚠ 주석에도 이 낱말이 나온다(그러지 말라는 설명) → **주석을 걷어낸 뒤** 검사한다.
  //    ⚠ 줄 **끝** 주석(`'--windows-filenames',  // …`)도 걷어야 한다 — 줄 시작만 보면 그대로 통과한다.
  //    `[^:]` 로 `https://` 는 지키고 주석만 지운다.
  const dlCode = dl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/--restrict-filenames/.test(dlCode), '🔴 --restrict-filenames 금지 — 한글 제목이 통째로 사라진다');
  ok(/PYTHONIOENCODING/.test(dl), '한글 제목이 CP949 로 깨지지 않게 UTF-8 을 지정한다');

  // 화면
  ok(/🔗 URL/.test(app), '헤더에 🔗 URL 버튼');
  ok(/urlMode, setUrlMode\] = useState\('audio'\)/.test(app), '받을 것 기본값은 MP3(로이 확정)');
  ok(/value="audio"[\s\S]{0,80}value="video"[\s\S]{0,80}value="both"/.test(app), 'MP3·영상·둘 다 를 고를 수 있다');
  ok(/if \(urlOpen\) \{ setUrlOpen\(false\); return; \}/.test(app), 'ESC 로 닫힌다');
  ok(/urlOpen, tsOpen/.test(app), 'ESC deps 배열에 들어 있다');
  ok(/downloadFolder: p\.downloadFolder/.test(app), '🔴 채널 편집이 다운로드 폴더를 싣는다(안 실으면 저장 시 빈 값으로 덮인다)');
  ok(/downloadFolder: \(ch\.downloadFolder/.test(app), '저장 patch 에도 들어 있다');

  const bundle = (() => {
    try {
      const d = path.join(__dirname, '..', 'renderer', 'dist', 'assets');
      const f = fs.readdirSync(d).filter((x) => x.endsWith('.js')).sort()[0];
      return fs.readFileSync(path.join(d, f), 'utf8');
    } catch { return ''; }
  })();
  ok(bundle ? bundle.includes('🔗 URL') : true, '번들에 반영됨(소스만 고치고 빌드를 잊으면 화면은 옛것)');
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
process.exit(fail ? 1 : 0);
