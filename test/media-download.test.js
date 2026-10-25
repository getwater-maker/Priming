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
  eq(MD.subLangPref('ko').join(','), 'ko-orig,ko,ko.*', '한국어 영상은 원본 자동자막 우선');
  eq(MD.subLangPref('ja').join(','), 'ja-orig,ja,ja.*', '일본어 영상은 **일본어** 원본 — ko 번역본을 받지 않는다');
  eq(MD.subLangPref('en-US').join(','), 'en-orig,en,en.*', '지역 코드가 붙어도 기본 언어로 자른다');
  eq(MD.subLangPref('').join(','), 'ko-orig,ko,ko.*,en-orig,en,en.*', '언어를 모를 때만 폴백 목록');
  // 🔴 실사고(틱톡): 자막 코드가 `eng-US` 라 정확 코드 `en` 과 안 맞아 **자막이 있는데도 매번 STT** 를 돌렸다.
  ok(MD.subLangPref('en', 'https://www.tiktok.com/@a/video/1').includes('en.*'), '🔑 유튜브가 아닌 사이트는 변종 코드(eng-US)를 잡는 와일드카드가 들어 있다');
  ok(MD.subLangPref('ko').indexOf('ko-orig') < MD.subLangPref('ko').indexOf('ko.*'),
    '⚠ 와일드카드는 **뒤**에 온다 — 정확 코드가 먼저 걸린다');
  // 🔴 실사고(2026-10-16): 유튜브에서 `en.*` 가 기계번역 자막 en-ar·en-ko … 를 하나씩 요청 → 429 로 영상 받기 전체 실패.
  //   yt-dlp 는 대소문자 구분 없이 맞춰서(실측) 꼬리 패턴으로는 못 가른다 → 유튜브 주소엔 와일드카드를 붙이지 않는다.
  for (const u of ['https://www.youtube.com/watch?v=LlhTEttKcwQ', 'https://youtu.be/LlhTEttKcwQ', 'https://m.youtube.com/watch?v=x', 'https://www.youtube.com/shorts/x'])
    eq(MD.subLangPref('en', u).join(','), 'en-orig,en', '유튜브 주소 = 원본 두 개만: ' + u.slice(8, 30));
  eq(MD.subLangPref('', 'https://youtu.be/x').join(','), 'ko-orig,ko,en-orig,en', '유튜브 · 언어 모름 = 원본만');
  const ytMatchI = (langs, code) => langs.some((l) => new RegExp('^(?:' + l + ')$', 'i').test(code));   // yt-dlp 와 같은 판정(대소문자 무시)
  ok(!['en-ar', 'en-ko', 'en-ja', 'en-US'].some((c) => ytMatchI(MD.subLangPref('en', 'https://youtu.be/x'), c)), '유튜브: 번역 자막(en-ar 등)을 집지 않는다');
  ok(ytMatchI(['en.*'], 'en-ar'), '판정력: 옛 en.* 는 en-ar 를 집었다');
}

console.log('\n[4-b] 내려온 자막 고르기 — 번역본을 조용히 집지 않는다');
{
  eq(MD.pickSubFile(['제목.eng-US.vtt'], MD.subLangPref('')), '제목.eng-US.vtt',
    '🔴 틱톡 실사례: 변종 코드 하나뿐이면 그것을 쓴다');
  eq(MD.pickSubFile(['t.ko.vtt', 't.ko-orig.vtt'], MD.subLangPref('ko')), 't.ko-orig.vtt',
    '원본(-orig)이 최우선');
  eq(MD.pickSubFile(['t.zh-Hant.vtt', 't.zh-orig.vtt'], MD.subLangPref('zh')), 't.zh-orig.vtt',
    '🔑 이름이 길어도(zh-Hant) 번역본을 안 집는다 — 길이 휴리스틱이 아니다');
  eq(MD.pickSubFile(['t.fr.vtt', 't.en.vtt'], MD.subLangPref('en')), 't.en.vtt',
    '-orig 가 없으면 **요청한 순서**를 존중한다');
  eq(MD.pickSubFile([], MD.subLangPref('ko')), null, '자막이 없으면 null');
}

console.log('\n[4-c] 비메오 주소 — 🔴 로그인 요구를 플레이어 주소로 우회');
{
  // 실측 stderr(2026-09-15) 그대로
  const LOGIN = 'ERROR: [vimeo] 76979871: The web client only works when logged-in. '
    + 'Use --cookies, --cookies-from-browser, --username and --password ... to provide account credentials';
  eq(MD.altUrl('https://vimeo.com/76979871', LOGIN), 'https://player.vimeo.com/video/76979871',
    '🔑 사용자가 붙여넣는 주소를 플레이어 주소로 바꾼다');
  eq(MD.altUrl('https://vimeo.com/channels/staffpicks/76979871', LOGIN), 'https://player.vimeo.com/video/76979871',
    '채널·그룹 경로에서도 번호만 뽑는다');
  eq(MD.altUrl('https://vimeo.com/76979871', 'ERROR: Video unavailable'), null,
    '⚠ 로그인 요구가 아닌 오류에는 손대지 않는다(쿠키가 있는 환경을 망치지 않는다)');
  eq(MD.altUrl('https://www.youtube.com/watch?v=abc123', LOGIN), null, '유튜브 주소는 건드리지 않는다');
  eq(MD.altUrl('https://player.vimeo.com/video/76979871', LOGIN), null, '이미 플레이어 주소면 무한 반복하지 않는다');
  ok(MD.needsVimeoPlayer(LOGIN) === true && MD.needsVimeoPlayer('ERROR: Video unavailable') === false,
    '판정 함수가 로그인 요구만 잡는다');
}

console.log('\n[5] 실패 문구 — 무엇을 해야 하는지 알려준다');
{
  { const m = MD._explain('ERROR: unable to download video data: HTTP Error 403: Forbidden');
    ok(/403/.test(m) && /요청 제한·실행 환경·버전/.test(m) && !/낡았을 때 나는 증상/.test(m), '403 원인을 버전 하나로 단정하지 않는다'); }
  ok(/429/.test(MD._explain('ERROR: unable to download video data: HTTP Error 429: Too Many Requests')), '429 는 「요청이 많아 잠시 막음」');
  ok(/비공개|연령|멤버십/.test(MD._explain('ERROR: Private video. Sign in if you have been granted access')), '비공개 영상');
  ok(/찾을 수 없/.test(MD._explain('ERROR: Video unavailable')), '삭제·지역제한');
  ok(/지원하지 않는/.test(MD._explain('ERROR: Unsupported URL: https://example.com/x')), '지원 안 하는 주소');
  ok(/네트워크/.test(MD._explain('ERROR: Unable to download webpage: getaddrinfo ENOTFOUND')), '네트워크 끊김');
  eq(MD._explain(''), '', '빈 stderr 는 빈 문자열(호출부가 기본 문구를 쓴다)');
  // 🔴 비메오 3종 — 예전엔 영어 원문이 그대로 화면에 떴다(무엇을 해야 하는지 알 수 없었다)
  ok(/DRM|저작권/.test(MD._explain('ERROR: This format is DRM protected; Try selecting another format')),
    'DRM 영상은 이유를 밝히고 우회하지 않는다');
  ok(/비메오|로그인/.test(MD._explain('ERROR: [vimeo] 1: The web client only works when logged-in. Use --cookies')),
    '비메오 로그인 요구를 사람 말로');
  ok(/임베드|외부 재생/.test(MD._explain('ERROR: [vimeo] 148751763: Unable to download webpage: HTTP Error 404: Not Found (player.vimeo.com)')),
    '임베드 차단(404)을 구분해 알려준다');
}

console.log('\n[5-a] 채널 전체 — 일반 영상 탭·항목 URL·안전한 폴더명');
{
  eq(MD.normalizeChannelUrl('https://www.youtube.com/@sample'), 'https://www.youtube.com/@sample/videos',
    '채널 루트는 일반 영상 탭(/videos)으로 고정');
  eq(MD.normalizeChannelUrl('https://www.youtube.com/@sample/shorts'), 'https://www.youtube.com/@sample/videos',
    '쇼츠 탭을 붙여넣어도 일반 영상 전체로 정규화');
  eq(MD.normalizeChannelUrl('https://www.youtube.com/channel/UC123/videos'), 'https://www.youtube.com/channel/UC123/videos',
    '이미 /videos 면 중복해서 붙이지 않는다');
  eq(MD.normalizeChannelUrl('https://vimeo.com/channels/staffpicks'), 'https://vimeo.com/channels/staffpicks',
    '유튜브 외 주소는 임의 변경하지 않는다');
  eq(MD.channelEntryUrl({ id: 'abcdefghijk', extractor: 'youtube' }),
    'https://www.youtube.com/watch?v=abcdefghijk', 'flat 항목의 유튜브 ID를 실제 영상 URL로 복원');
  eq(MD.channelEntryUrl({ id: 'x', webpage_url: 'https://example.com/video/x' }),
    'https://example.com/video/x', 'webpage_url이 있으면 우선 사용');
  eq(MD.safeFolderName('채널: 이름?'), '채널_ 이름_', '윈도우 금지문자를 채널 폴더명에서 제거');
  // 🔴 「채널 전체」 + 영상 주소 — yt-dlp 가 영상 한 편 정보만 준다(2026-09-26 실측) → 그 채널 주소로 다시 읽는다
  eq(MD.channelUrlOfVideo({ _type: 'video', channel_url: 'https://www.youtube.com/channel/UCx', uploader_url: 'https://www.youtube.com/@x' }),
    'https://www.youtube.com/channel/UCx', '영상 응답이면 channel_url 을 돌려준다');
  eq(MD.channelUrlOfVideo({ _type: 'video', uploader_url: 'https://www.youtube.com/@x' }),
    'https://www.youtube.com/@x', 'channel_url 이 없으면 uploader_url');
  eq(MD.channelUrlOfVideo({ _type: 'playlist', entries: [{ id: 'a' }] }), '', '목록 응답이면 그대로(다시 읽지 않는다)');
  eq(MD.channelUrlOfVideo({ _type: 'playlist', entries: [] }), '', '빈 목록(영상 없는 채널)도 다시 읽지 않는다 — 무한 반복 방지');
  eq(MD.normalizeChannelUrl('https://www.youtube.com/channel/UCx'), 'https://www.youtube.com/channel/UCx/videos',
    '돌려받은 채널 주소는 일반 영상 탭으로 정규화된다');
  const dlSrc = fs.readFileSync(path.join(__dirname, '..', 'core', 'media-download.js'), 'utf8');
  ok(/!o\._fromVideo && channelUrlOfVideo/.test(dlSrc), '다시 읽기는 한 번만(_fromVideo 가드)');
  {
    const mainSrc0 = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const seg = mainSrc0.slice(mainSrc0.indexOf("ipcMain.handle('stt-from-url'"), mainSrc0.indexOf("ipcMain.handle('stt-from-url'") + 20000);
    ok(!/showMessageBox/.test(seg) && /일반 영상 \$\{jobs\.length\}편을 받/.test(seg),
      '채널 전체는 확인 팝업 없이 바로 시작하고 편수는 로그로(로이 2026-10-24 — 멈춤은 ⏹ 중단)');
  }
}

console.log('\n[5-b] 전사 .txt 머리말 — 1줄 주소 · 2줄 제목 · 3줄 빈 줄 · 4줄부터 내용 (로이 확정)');
{
  // main.js 원문에서 함수를 뽑아 그대로 실행한다(복사본을 두면 앱과 갈라져도 통과한다)
  const src = read('main.js');
  const m = src.match(/function txtWithHead\(text, head\) \{[\s\S]*?\n\}/);
  ok(!!m, 'main.js 에 txtWithHead 가 있다');
  const txtWithHead = m ? eval(`(${m[0].replace('function txtWithHead', 'function')})`) : null;
  if (txtWithHead) {
    const out = txtWithHead('첫 문장입니다. 둘째 문장입니다.',
      { url: 'https://youtu.be/AAA', title: '제목입니다' });
    const lines = out.split('\n');
    eq(lines[0], 'https://youtu.be/AAA', '1줄 = 영상 주소');
    eq(lines[1], '제목입니다', '2줄 = 제목');
    eq(lines[2], '', '3줄 = 빈 줄');
    eq(lines[3], '첫 문장입니다. 둘째 문장입니다.', '4줄부터 내용');
    eq(txtWithHead(' 내용 ', null), '내용\n', '머리말이 없으면(🎧 STT 버튼) 예전처럼 내용만');
    eq(txtWithHead('본문', { url: 'u', title: '두 줄\n제목' }).split('\n')[1], '두 줄 제목',
      '⚠ 제목에 개행이 있어도 2줄을 침범하지 않는다(줄 규약이 깨진다)');
    ok(txtWithHead('본문', { url: 'u', title: '' }).split('\n')[1] === '',
      '제목을 못 읽어도 줄 수는 지킨다(4줄부터 내용)');
  }
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

  // 🔑 머리말도 **한 함수**가 만든다 — 자막 경로와 STT 경로가 갈리면 파일 형식이 조용히 달라진다
  const headCalls = (main.match(/txtWithHead\(/g) || []).length;
  ok(headCalls >= 3, `자막·STT 두 경로가 머리말 함수를 공유한다 (정의+호출 ${headCalls}곳)`);
  ok(/fs\.writeFileSync\(outTxt, txtWithHead\(text, head\)/.test(main), '자막 경로가 머리말을 붙인다');
  ok(/transcribeToTxt\(mediaFile, \{ outTxt, head[ ,}]/.test(main), 'STT 경로도 같은 머리말을 넘긴다');

  // 🔴 비메오: probe 만 바꾸고 download 를 옛 주소로 하면 그대로 막힌다 → **성공한 주소로 받는다**
  ok(/MD\.probeSmart\(url,/.test(main), 'probeSmart 로 대안 주소까지 시도한다');
  ok(/MD\.download\(dlUrl,/.test(main), '🔑 다운로드는 **probe 가 성공한 그 주소**로 한다');
  ok(!/MD\.probe\(url,/.test(main), '옛 직접 호출이 남아 있지 않다(한쪽만 고쳐지는 사고 방지)');

  ok(/ipcMain\.handle\('stt-from-url'/.test(main), 'IPC stt-from-url');
  ok(/ipcMain\.handle\('ytdlp-status'/.test(main), 'IPC ytdlp-status');
  ok(/ipcMain\.handle\('ytdlp-update'/.test(main), 'IPC ytdlp-update');
  ok(/sttFromUrl:/.test(pre) && /ytdlpStatus:/.test(pre) && /ytdlpUpdate:/.test(pre), 'preload 3개');
  ok(/MD\.listChannelVideos\(channelUrl,/.test(main), '채널 모드가 전체 영상 목록을 먼저 펼친다');
  ok(/filenameWithId: !!job\.idName, mediaId:/.test(main) && /outDir: channelDir, idName: true \}/.test(main), '채널 파일명에 영상 ID를 붙여 중복을 판별한다(채널 항목 = idName · 다시 받기도 이어받음)');
  // 🔴 2026-09-23 실사고: 단일 URL 에도 mediaId 를 넘겨 파일명에 없는 [ID] 로 찾다가 「받은 파일이 없습니다」로 전부 실패
  ok(/mediaId: job\.idName \? \(job\.id \|\| info\.id\) : ''/.test(main) && /jobs\.push\(\{ url, id: '', title: '', outDir \}\)/.test(main), '🔴 단일 URL 은 mediaId 를 넘기지 않는다(받은 파일을 못 찾는다 · 단일 항목엔 idName 없음)');
  ok(/win\.webContents\.send\('urldl-progress'/.test(main) && /onUrldlProgress:/.test(pre), '📊 진행 상황을 화면으로 보낸다');
  ok(/onProgress: \(p\) => \{ prog\.dl\.pct/.test(main), '다운로드 퍼센트를 진행 패널에 싣는다');
  ok(/onChunk:/.test(main) && /opts\.onChunk/.test(main), '전사 청크 진행을 진행 패널에 싣는다');
  ok(/r\.reused && fs\.existsSync\(outTxt\)/.test(main), '중단 후 재실행은 이미 전사한 영상을 건너뛴다');
  // ⚡ 받기와 전사를 겹친다(2026-09-23) — 다운로드 루프가 전사를 기다리지 않는다
  {
    const loop = main.slice(main.indexOf('const enqueueStt = (i, t) =>'), main.indexOf('await sttChain;'));
    ok(loop.length > 0, '전사 줄(enqueueStt)과 마감 대기(await sttChain)가 있다');
    const dlLoop = loop.slice(loop.indexOf('for (let i = 0; i < jobs.length; i++)'));
    ok(/enqueueStt\(i, \{/.test(dlLoop), 'STT 가 필요한 영상은 전사 줄에 세운다');
    ok(!/await transcribeToTxt\(/.test(dlLoop), '🔑 다운로드 루프 안에서 전사를 기다리지 않는다(순차로 되돌아가지 않게)');
    ok(/sttChain = sttChain\.then\(/.test(loop), '전사는 한 번에 하나씩(GPU 에 몰아넣지 않는다)');
    ok(/for \(const x of slots\) if \(x\) results\.push\(x\)/.test(main), '결과는 영상 순서 그대로 모은다');
  }

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
  ok(/rb-t">다운로드</.test(app) && !/rb-t">대본다운</.test(app), '📥 다운로드 버튼(옛 대본다운 · v0.9.17)');
  ok(!/rb-t">STT</.test(app) && !/rb-t">mp3</.test(app) && !/runExtractMp3|function runStt\(/.test(app), '리본 🎧 STT · 🎵 mp3 버튼은 없다(📂 내 파일 탭으로 합침)');
  ok(/function runFileJob\(\)[\s\S]{0,400}api\.pickMediaFiles\(\)[\s\S]{0,500}api\.extractMp3\(\{ files \}\)[\s\S]{0,400}api\.sttTranscribe\(\{ files \}\)/.test(app), '📂 내 파일: 한 번 고른 목록으로 mp3 → STT');
  ok(/stt: urlStt, forceStt: urlStt && urlForceStt/.test(app), '🔗 링크: STT 체크값을 IPC 로 넘긴다');
  ok(!/value="both"/.test(app), '화면의 받을 것 = 오디오·영상 둘(both 없음)');
  { const bar = (app.match(/data-testid="dl-linkbar"[\s\S]*?<\/div>/) || [''])[0];
    ok(bar && (bar.match(/<select/g) || []).length === 1 && !/>화질</.test(bar), '화질 칸이 없다 — 링크 줄의 고르기는 「다운로드」 하나(늘 최고 화질 · 로이 2026-10-14)'); }
  { const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    ok(/const wantSubs = saveSubs \|\| \(doStt && !forceStt\);/.test(mainSrc) && /if \(!txtFrom && doStt && r\.sub && !forceStt\)/.test(mainSrc), '자막 파일 저장과 STT 전사를 별도로 선택한다');
    ok(/ipcMain\.handle\('pick-media-files'/.test(mainSrc) && /ipcMain\.handle\('stt-transcribe', async \(_e, args = \{\}\)[\s\S]{0,120}args\.files/.test(mainSrc) && /ipcMain\.handle\('extract-mp3', async \(_e, args = \{\}\)[\s\S]{0,120}args\.files/.test(mainSrc), 'STT·mp3 가 고른 파일 목록(args.files)을 받는다'); }
  ok(/'-S', 'res,fps,vcodec:h264,acodec:m4a'/.test(dl), '🎞 영상 = 최고 해상도 · 같은 해상도면 H.264+AAC(정렬 없으면 AV1+Opus)');
  ok(!/rb-t">URL</.test(app), '옛 「URL」 버튼 라벨이 남지 않았다');
  ok(/pasteAndRunUrlDl/.test(app) && /📋 링크 붙여넣기/.test(app), '「📋 링크 붙여넣기」 버튼이 있다');
  ok(/clipboard-read-text/.test(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')), '클립보드는 main 에서 읽는다');
  ok(/urlMode, setUrlMode\] = useState\('audio'\)/.test(app), '받을 것 기본값은 MP3(로이 확정)');
  ok(/value="audio"[\s\S]{0,80}value="video"/.test(app), '오디오(mp3)·영상(mp4)을 고를 수 있다');
  ok(/urlChannelAll, setUrlChannelAll/.test(app) && /channel: urlChannelAll/.test(app),
    '채널 전체 체크값을 IPC에 전달한다');
  ok(/📺 유튜브 채널 전체/.test(app) && /data-testid="dl-channel"/.test(app), '채널 전체 옵션을 화면에 분명히 표시한다(켜고 끄는 버튼 · v0.9.18)');
  ok(/if \(urlOpen\) \{ setUrlOpen\(false\); return; \}/.test(app), 'ESC 로 닫힌다');
  ok(/urlOpen, tsOpen/.test(app), 'ESC deps 배열에 들어 있다');
  // 📁 받기 폴더 = 모든 채널 공통(⚙ 설정 → 📁 폴더 · 2026-10-14) — 채널편집에서는 뺐다
  ok(!/downloadFolder/.test(app), '채널편집에 옛 받기 폴더 칸이 남아 있지 않다');
  ok(/\['download', 'URL 받기'/.test(app), '⚙ 설정 → 📁 폴더에 「URL 받기」 칸');
  { const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    ok(/let outDir = args\.outDir \|\| \(retryJobs\.length && _lastDlRetry\.outDir\) \|\| appFolder\('download'\)/.test(mainSrc), 'stt-from-url 은 공통 받기 폴더를 쓴다(다시 받기는 지난 실행 폴더)');
    ok(!/pr && pr\.downloadFolder/.test(mainSrc), '채널 downloadFolder 를 더 이상 읽지 않는다'); }

  const bundle = (() => {
    try {
      const d = path.join(__dirname, '..', 'renderer', 'dist', 'assets');
      const f = fs.readdirSync(d).filter((x) => x.endsWith('.js')).sort()[0];
      return fs.readFileSync(path.join(d, f), 'utf8');
    } catch { return ''; }
  })();
  ok(bundle ? bundle.includes('다운로드 · STT') : true, '번들에 반영됨(소스만 고치고 빌드를 잊으면 화면은 옛것)');
}

// [자막 429] 자막만 실패해도 영상은 받는다(v0.9.38 · 2026-10-16 실사고) — 가짜 yt-dlp(node 스크립트)로 원문 download() 를 돈다
(async () => {
  console.log('\n[자막 429] 자막 받기가 막혀도 영상 받기는 끝까지 — 자막 없이 한 번 더');
  const os = require('os');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'md-sub429-'));
  const fake = path.join(T, 'fake-ytdlp.js');
  const callLog = path.join(T, 'calls.txt');
  fs.writeFileSync(fake, [
    "const fs = require('fs'); const a = process.argv.slice(2);",
    "fs.appendFileSync(process.env.FAKE_LOG, a.join(' ') + '\\n');",
    "const o = a[a.indexOf('-o') + 1].replace('%(title)s', 'T').replace('%(ext)s', 'mp4');",
    "if (!fs.existsSync(o)) fs.writeFileSync(o, 'video');",
    "if (a.includes('--write-subs') && process.env.FAKE_MODE === 'sub429') { process.stderr.write(\"ERROR: Unable to download video subtitles for 'en-ar': HTTP Error 429: Too Many Requests\\n\"); process.exit(1); }",
    "if (process.env.FAKE_MODE === 'videofail') { process.stderr.write('ERROR: Video unavailable\\n'); process.exit(1); }",
    'process.exit(0);',
  ].join('\n'));
  const tool = { cmd: process.execPath, args: [fake] };
  const logs = [];
  process.env.FAKE_LOG = callLog;
  process.env.FAKE_MODE = 'sub429';
  const out1 = path.join(T, 'a');
  const r = await MD.download('https://youtu.be/x', { tool, outDir: out1, mode: 'video', subs: true, language: 'en', onLog: (l) => logs.push(l) });
  const calls = fs.readFileSync(callLog, 'utf8').trim().split('\n');
  ok(r.video && fs.existsSync(r.video) && r.sub === null, '자막 429 → 영상은 받았고 자막은 없음(→ STT 가 맡는다)');
  ok(calls.length === 2 && calls[0].includes('--write-subs') && !/--write-subs|--write-auto-subs|--sub-langs|--sub-format/.test(calls[1]), '두 번째 실행은 자막 인자를 모두 뺀다');
  ok(!calls[1].includes(' vtt ') && calls[1].includes('--no-overwrites'), '자막 값(vtt·언어 목록)도 함께 빠지고 나머지 인자는 그대로');
  ok(logs.some((l) => /자막을 못 받았습니다.*자막 없이 다시 받습니다/.test(l)), '로그에 「자막 없이 다시」 안내');
  fs.writeFileSync(callLog, '');
  process.env.FAKE_MODE = 'videofail';
  let threw = '';
  try { await MD.download('https://youtu.be/y', { tool, outDir: path.join(T, 'b'), mode: 'video', subs: true, language: 'en' }); } catch (e) { threw = e.message; }
  ok(threw && fs.readFileSync(callLog, 'utf8').trim().split('\n').length === 1, '판정력: 영상 자체 실패는 다시 하지 않고 그대로 실패');
  // ⏳ 영상 받기 403/429 = 일시 차단 → 기다렸다 두 번까지 다시(2026-10-16 실측: 5초 만에 403 → 몇 분 뒤 같은 영상 정상)
  console.log('\n[일시 차단] 403 이 나면 기다렸다 다시 — 두 번까지');
  const cnt = path.join(T, 'n.txt');
  fs.writeFileSync(fake, [
    "const fs = require('fs'); const a = process.argv.slice(2);",
    "fs.appendFileSync(process.env.FAKE_LOG, a.join(' ') + '\\n');",
    "const n = Number(fs.existsSync(process.env.FAKE_CNT) ? fs.readFileSync(process.env.FAKE_CNT, 'utf8') : 0) + 1; fs.writeFileSync(process.env.FAKE_CNT, String(n));",
    "if (n <= Number(process.env.FAKE_FAILS)) { process.stderr.write('ERROR: unable to download video data: HTTP Error 403: Forbidden\\n'); process.exit(1); }",
    "const o = a[a.indexOf('-o') + 1].replace('%(title)s', 'T').replace('%(ext)s', 'mp4'); fs.writeFileSync(o, 'video'); process.exit(0);",
  ].join('\n'));
  process.env.FAKE_CNT = cnt; process.env.FAKE_MODE = '';
  for (const [fails, want] of [[2, true], [3, false]]) {
    fs.writeFileSync(callLog, ''); try { fs.unlinkSync(cnt); } catch (_) {}
    process.env.FAKE_FAILS = String(fails);
    const lg = [];
    let res = null, err = '';
    try { res = await MD.download('https://youtu.be/z', { tool, outDir: path.join(T, 'blk' + fails), mode: 'video', subs: false, _waitScale: 0, onLog: (l) => lg.push(l) }); } catch (e) { err = e.message; }
    const n = fs.readFileSync(callLog, 'utf8').trim().split('\n').length;
    if (want) ok(res && res.video && n === 3 && lg.filter((l) => /잠시 막았습니다\(403\)/.test(l)).length === 2, '403 두 번 → 기다렸다 다시 → 세 번째에 받음');
    else ok(!res && /403/.test(err) && n === 3, '세 번 다 403 이면 그만두고 「잠시 막음」으로 알린다(무한 반복 안 함)');
  }
  // 🔤 한글 파일 이름 — yt-dlp 2026.10.23 은 --encoding 없으면 CP949 로 내보낸다(2026-10-24 · 받은 mp3 를 못 찾던 사고)
  console.log('\n[인코딩] --encoding utf-8 이 있어야 한글 이름을 찾는다');
  fs.writeFileSync(fake, [
    "const fs = require('fs'); const a = process.argv.slice(2);",
    "const o = a[a.indexOf('-o') + 1]; const dir = require('path').dirname(o);",
    "const name = '년도 이야기 [kr1].mp3'; fs.writeFileSync(require('path').join(dir, name), 'audio');",
    "const utf8 = a[a.indexOf('--encoding') + 1] === 'utf-8' && a.includes('--encoding');",
    // CP949 「년」 = B3 E2 — UTF-8 로 읽으면 깨진다
    "process.stdout.write(Buffer.concat([Buffer.from('__PRIMING_BASE__'), utf8 ? Buffer.from('년') : Buffer.from([0xB3, 0xE2]), Buffer.from('도 이야기 [kr1].webm\\n')]));",
    "process.exit(0);",
  ].join('\n'));
  {
    let res = null, err = '';
    try { res = await MD.download('https://youtu.be/kr1', { tool, outDir: path.join(T, 'enc'), mode: 'audio', subs: false }); } catch (e) { err = e.message; }
    ok(res && res.audio && /년도 이야기 \[kr1\]\.mp3$/.test(res.audio), `한글 이름 mp3 를 찾는다 ${err}`);
    ok(/const YT_ENC_ARGS = \['--encoding', 'utf-8'\]/.test(fs.readFileSync(path.join(__dirname, '..', 'core', 'media-download.js'), 'utf8')), 'yt-dlp 실행에 --encoding utf-8');
  }
  // 🐢 429 줄이기(v0.9.116) — 정보 확인 재시도 · 정보 파일로 받기(두 번 묻지 않음) · 여러 편이면 요청 사이 쉼
  console.log('\n[429 줄이기] 정보 확인 재시도 · --load-info-json · 쉼');
  fs.writeFileSync(fake, [
    "const fs = require('fs'); const a = process.argv.slice(2);",
    "fs.appendFileSync(process.env.FAKE_LOG, a.join(' ') + '\\n');",
    "const n = Number(fs.existsSync(process.env.FAKE_CNT) ? fs.readFileSync(process.env.FAKE_CNT, 'utf8') : 0) + 1; fs.writeFileSync(process.env.FAKE_CNT, String(n));",
    "if (n <= Number(process.env.FAKE_FAILS)) { process.stderr.write('ERROR: [youtube] p1: HTTP Error 429: Too Many Requests\\n'); process.exit(1); }",
    "if (a.includes('--dump-single-json')) { process.stdout.write(JSON.stringify({ id: 'p1', title: 'P', duration: 9 }) + '\\n'); process.exit(0); }",
    "const o = a[a.indexOf('-o') + 1].replace('%(title)s', 'P').replace('%(ext)s', 'mp4'); fs.writeFileSync(o, 'video'); process.exit(0);",
  ].join('\n'));
  {
    const ij = path.join(T, 'info.json');
    fs.writeFileSync(callLog, ''); try { fs.unlinkSync(cnt); } catch (_) {}
    process.env.FAKE_FAILS = '2';
    const lg = [];
    const info = await MD.probe('https://youtu.be/p1', { tool, infoJsonFile: ij, paced: true, _waitScale: 0, onLog: (l) => lg.push(l) });
    const calls = fs.readFileSync(callLog, 'utf8').trim().split('\n');
    ok(info.id === 'p1' && calls.length === 3 && lg.filter((l) => /정보를 다시 읽습니다/.test(l)).length === 2, '정보 확인이 429 두 번 → 기다렸다 다시 → 세 번째에 읽음');
    ok(fs.existsSync(ij) && JSON.parse(fs.readFileSync(ij, 'utf8')).id === 'p1', '읽은 정보를 파일로 남긴다');
    ok(calls[2].includes('--sleep-requests 1') && calls[2].includes('--sleep-subtitles 2'), '여러 편(paced)이면 요청 사이 쉼 인자');
    fs.writeFileSync(callLog, ''); try { fs.unlinkSync(cnt); } catch (_) {}
    process.env.FAKE_FAILS = '0';
    const res = await MD.download('https://youtu.be/p1', { tool, outDir: path.join(T, 'lij'), mode: 'video', subs: false, infoJsonFile: ij });
    const c1 = fs.readFileSync(callLog, 'utf8').trim();
    ok(res.video && c1.includes('--load-info-json ' + ij) && !c1.includes('https://youtu.be/p1'), '정보 파일이 있으면 주소 대신 --load-info-json(유튜브에 다시 묻지 않음)');
    ok(!c1.includes('--sleep-requests'), '한 편(paced 아님)은 쉼 인자 없음 — 단일 주소는 예전 속도');
    fs.writeFileSync(callLog, ''); try { fs.unlinkSync(cnt); } catch (_) {}
    process.env.FAKE_FAILS = '1';
    const res2 = await MD.download('https://youtu.be/p1', { tool, outDir: path.join(T, 'lij2'), mode: 'video', subs: false, infoJsonFile: ij, _waitScale: 0 });
    const c2 = fs.readFileSync(callLog, 'utf8').trim().split('\n');
    ok(res2.video && c2.length === 2 && c2[0].includes('--load-info-json') && !c2[1].includes('--load-info-json') && c2[1].endsWith('https://youtu.be/p1'), '막혀서 다시 받을 땐 남긴 정보를 버리고 주소로');
    ok(MD.isBlocked({ message: 'x', raw: 'HTTP Error 429' }) && MD.isBlocked(new Error('유튜브가 요청이 많다며 잠시 막았습니다(429)')) && !MD.isBlocked(new Error('Video unavailable')), 'isBlocked: 429·403 만 막힘으로 본다');
    const bot = 'ERROR: [youtube] x: Sign in to confirm you’re not a bot. This helps protect our community.';
    ok(MD.isBlocked({ message: MD._explain(bot), raw: bot }) && /로봇이 아닌지/.test(MD._explain(bot)) && !/로그인·쿠키로 우회합니다/.test(MD._explain(bot)), '「로봇 확인」(2026-10-24 실측 문구) = 막힘 · 사람 말 안내(우회 안 함)');
    ok(!MD.isBlocked({ message: 'x', raw: 'ERROR: Sign in to confirm your age' }), '연령 확인은 막힘이 아니다(쉬어도 안 풀림)');
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    ok(/BLOCK_PAUSE_MIN = \[3, 10, 20\]/.test(mainJs) && /i--; continue;/.test(mainJs) && /f\.endsWith\(`\[\$\{job\.id\}\]\$\{ext\}`\)/.test(mainJs) && /doStt \? \['\.txt'\]/.test(mainJs), 'main: 막히면 쉬었다 같은 영상부터 · 이미 전사한 영상은 유튜브에 묻지 않음');
  }
  // 🧩 JS 실행기 — 버전을 모르거나 옛 yt-dlp 면 붙이지 않는다(--js-runtimes 를 모르는 판이 깨지지 않게)
  const js = fs.readFileSync(path.join(__dirname, '..', 'core', 'media-download.js'), 'utf8');
  ok(!fs.readFileSync(callLog, 'utf8').includes('--js-runtimes'), '버전 없는 도구(가짜)에는 --js-runtimes 를 붙이지 않는다');
  ok(/JS_RT_MIN_YTDLP = '2025\.11\.01'/.test(js) && /Number\(m\[1\]\) >= 22/.test(js), 'node 22 이상 · yt-dlp 2025.11 이후만');
  try { fs.rmSync(T, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
  process.exit(fail ? 1 : 0);
})();
