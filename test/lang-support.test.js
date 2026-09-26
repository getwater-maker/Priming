// 🌏 일본어·베트남어 지원 (2026-09-26)
//   ① 언어 판별 ② 문장 분리 ③ 자막 줄 나누기(일본어 글자 단위 · 베트남어 글자 세기) ④ TTS 전처리·언어 ⑤ 일본어 자막 글꼴 ⑥ 배선
//   ⑦ 🔑 한국어 무변경 — 기존 대본 전체를 **바꾸기 전 커밋(4bc557f)의 모듈**과 새 모듈로 각각 돌려 한 글자라도 다르면 실패.
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const L = require('../core/lang');
const S = require('../core/sentence-splitter');
const C = require('../core/caption-splitter');
const TP = require('../tts/text-pronouncer');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('[1] 언어 판별');
ok(L.detectLang('관계를 깨는 것은') === 'ko', '한글 → ko');
ok(L.detectLang('한국 日本 Việt') === 'ko', '한글이 한 글자라도 있으면 ko (한국어 경로 보호)');
ok(L.detectLang('昔々、ある村に') === 'ja', '가나 → ja');
ok(L.detectLang('三國志。') === 'cjk', '한자만 → cjk');
ok(L.detectLang('Mỗi sáng, anh dậy') === 'vi', '베트남어 전용 글자 → vi');
ok(L.detectLang('Hello world.') === null && L.detectLang('Café au lait') === null, '영어·프랑스어는 null(옛 동작)');
ok(L.ttsLangFor('Mỗi sáng', 'ko') === 'vi' && L.ttsLangFor('昔々、ある村に', 'ko') === 'ja', '채널이 ko 여도 문장 언어로 TTS');
ok(L.ttsLangFor('관계를', 'ko') === 'ko' && L.ttsLangFor('관계를', undefined) === undefined, '한국어 문장은 채널 값 그대로(캐시 키 무변경)');
ok(L.ttsLangFor('Hello', 'vi') === 'vi', '채널이 vi 면 그대로');

console.log('[2] 문장 분리');
ok(eq(S.splitIntoSentences('本当ですか？はい、そうです！では行きましょう。彼は山へ行きました。'),
  ['本当ですか？', 'はい、そうです！', 'では行きましょう。', '彼は山へ行きました。']), '일본어 — 옛 코드는 0문장, 이제 전각 ！？ 까지 4문장');
ok(eq(S.splitIntoSentences('Có thật không? Vâng, đúng vậy! Chúng ta đi thôi.'), ['Có thật không?', 'Vâng, đúng vậy!', 'Chúng ta đi thôi.']), '베트남어 3문장');
const hy = S.splitHybrid('## 導入\n\n[太郎] こんにちは。\n\n## Mở đầu\n\n[Minh] Xin chào.').items;
ok(hy[0].speaker === '太郎' && hy[1].speaker === 'Minh', '화자 이름 — 한자·라틴 확장');
ok(hy[0].isIntro && hy[1].isIntro, '도입부 표제 — 導入 · Mở đầu');
ok(eq(S.splitIntoSentences('50~60명이 왔다. 그래서!'), ['50~60명이 왔다.', '그래서!']), '한국어 분리 그대로');

console.log('[3] 자막 줄 나누기');
const JA = ['昔々、ある村に、貧しいけれど心の優しい若者が住んでいました。', '「おじいさん、どこへ行くのですか？」と、少年は尋ねました。',
  'ところが、その日は朝から激しい雨が降っていて、道はすっかりぬかるんでいました。', '彼女はそれを聞いて、しばらく黙ったまま窓の外を見つめていました。', '東京オリンピックは2021年に開催されました。'];
const NO_START = /^[、。，．！？」』）ーぁぃぅぇぉっゃゅょ々]/;
let over = 0, badStart = 0, badEnd = 0, split = 0, lossy = 0;
for (const t of JA) for (const m of [14, 16, 20]) {
  const ls = C.splitCaptionLines(t, m);
  if (ls.length > 1) split++;
  if (ls.join('') !== t) lossy++;
  for (const l of ls) { if (C.meaningfulLen(l) > m) over++; if (NO_START.test(l)) badStart++; if (/[「『（]$/.test(l)) badEnd++; }
}
ok(split >= 12, `일본어가 여러 줄로 나뉜다(옛 코드는 한 문장 = 한 줄) — ${split}/15`);
ok(lossy === 0, '글자 손실 없음');
ok(over === 0, '줄 글자수 상한 지킴');
ok(badStart === 0 && badEnd === 0, '줄머리·줄끝 금칙(구두점·작은 가나·괄호) 위반 0');
ok(!C.splitCaptionLines(JA[1], 20).some((l) => /^と/.test(l)), '「…」と 는 앞 인용에 붙는다');
ok(!C.splitCaptionLines('東京オリンピックは2021年に開催されました。', 10).some((l) => /^\d/.test(l) && /\d$/.test(C.splitCaptionLines('東京オリンピックは2021年に開催されました。', 10)[0])), '숫자 안에서 자르지 않는다');
ok(C.meaningfulLen('Ngày xửa ngày xưa,') === 14 && C.meaningfulLen('ngày') === 4, '베트남어 글자 수 — 성조 글자 포함(옛 코드: ngày=3)');
const VI = 'Ngày xửa ngày xưa, ở một ngôi làng nhỏ, có một chàng trai nghèo nhưng rất tốt bụng.';
ok(C.splitCaptionLines(VI, 20).every((l) => C.meaningfulLen(l) <= 20), '베트남어 줄이 20자를 넘지 않는다(옛 코드는 22자 줄)');
ok(C.meaningfulLen('관계를 깨는 것은') === 7, '한국어 글자 수 그대로');

console.log('[4] TTS 전처리');
ok(TP.processForTTS('50~60명', []) === '50에서 60명', '한국어 범위 = 「에서」 그대로');
ok(TP.processForTTS('50〜60人でした。', []) === '50から60人でした。', '일본어 범위 = 「から」(한국어 「에서」를 끼우지 않는다)');
ok(TP.processForTTS('Khoảng 50~60 người.', []) === 'Khoảng 50 đến 60 người.', '베트남어 범위 = 「đến」');

console.log('[5] 일본어 자막 글꼴');
const fontFile = path.join(ROOT, 'assets', 'fonts', 'NotoSansJP-Bold.otf');
ok(fs.existsSync(fontFile) && fs.statSync(fontFile).size > 1e6, 'Noto Sans JP Bold 가 앱에 들어 있다');
ok(fs.existsSync(path.join(ROOT, 'assets', 'fonts', 'NotoSansJP-OFL.txt')), 'OFL 라이선스 파일 동봉');
const FS = require('../core/font-store');
const CF = require('../core/caption-format');
const id = FS.fontIdentity(FS.readTables(fs.readFileSync(fontFile)).tables);
ok(CF.vrewFontName(id.family, id.weight) === 'Noto Sans JP-Vrew_700', 'Vrew 이름 = Noto Sans JP-Vrew_700 (Vrew 설치본의 ja 기본 글꼴과 같다)');
ok(FS.listFonts().some((f) => f.vrewName === 'Noto Sans JP-Vrew_700' && f.jaOnly), '글꼴 목록에 들어간다(한글 없음 표시)');
const VB = fs.readFileSync(path.join(ROOT, 'vrew', 'vrew-builder.js'), 'utf8');
ok(/JA_FONT = 'Noto Sans JP-Vrew_700'/.test(VB) && /baseFmtFor\(s\.text\)/.test(VB), '.vrew — 일본어 줄의 기본 글꼴 교체 배선');
ok(/\/\^Pretendard\//.test(VB), '사용자가 채널 글꼴을 바꿨으면 건드리지 않는다(Pretendard 일 때만)');

console.log('[6] 배선');
const PL = fs.readFileSync(path.join(ROOT, 'core', 'pipeline.js'), 'utf8');
ok(/Lang\.ttsLangFor\(s && s\.text, o\.language\)/.test(PL), 'TTS 언어 = 문장 판별(pipeline optsFor)');
ok(/베트남어 문장 \$\{viN\}개/.test(PL), '베트남어 + 한국어 목소리 경고');
const MJ = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
ok(/meta\.language = ytLangOf\(pr\)/.test(MJ) && /language: meta\.language \|\| 'ko'/.test(MJ), '유튜브 업로드 언어 = 문장 다수결');
ok(/defaultLanguage: o\.language \|\| 'ko'/.test(fs.readFileSync(path.join(ROOT, 'core', 'youtube-upload.js'), 'utf8')), 'youtube-upload 가 언어를 받는다');
const APP = fs.readFileSync(path.join(ROOT, 'renderer', 'src', 'App.jsx'), 'utf8');
ok(/<option value="ja">日本語/.test(APP) && /<option value="vi">Tiếng Việt/.test(APP), '채널 언어 선택지에 일본어·베트남어');
for (const f of ['core/lang.js', 'core/caption-splitter.js', 'core/sentence-splitter.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  ok(!/require\.main/.test(src) && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(src), `${f} — 렌더러 번들 안전(require.main 없음) · 제어문자 없음`);
}

console.log('[6b] 🔎 역대조 게이트');
const BCK = require('../core/tts-backcheck');
ok(BCK.scoreText('Mỗi sáng, anh dậy thật sớm.', 'Mỗi sáng anh dậy thật sớm', 'vi').score === 1, '베트남어 — 문장부호·대소문자 무시하고 같으면 100%');
const tb = BCK.scoreText('Đôi chân anh mỏi nhừ.', 'Đôi chân anh mọi nhừ', 'vi');
ok(tb.toneErrors === 1 && tb.score === 0.8, `베트남어 — 성조만 다른 낱말은 성조 오류로 센다(mỏi→mọi · ${tb.score})`);
ok(BCK.scoreText('此所でもただ', 'ここでもただ', 'ja').score < 1, '일본어 — 표기가 다르면 글자 점수는 떨어진다(그래서 루비 읽기와도 대조)');
ok(BCK.scoreText('ここでもただ', 'ここでもただ', 'ja').score === 1, '일본어 — 읽기와 같으면 100%');
ok(BCK.isHallucination('Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ những video hấp dẫn') && BCK.isHallucination('ご視聴ありがとうございました') && !BCK.isHallucination('Mỗi sáng, anh dậy'), 'Whisper 환각 문장 감지(음성 탓이 아님)');
{
  const WS = require('../core/wav-slice');
  const sr = 24000, n = sr; const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n * 2, 40);
  const wav = Buffer.concat([h, Buffer.alloc(n * 2, 1)]);
  const p = WS.parseWav(BCK.padWav(wav, 0.5));
  ok(Math.abs(p.durationSec - 2.0) < 0.001, `무음 0.5초 덧대기 — 1초 → ${p.durationSec}초(앞뒤) · 형식 유지`);
}
ok(BCK.PASS.vi === 0.9 && BCK.PASS.ja === 0.85 && BCK.MAX_RETRY === 2, '기준 vi 90% · ja 85% · 다시 만들기 최대 2번(2026-09-26 실측으로 정함)');
ok(/Lang\.isForeignLang\(bcLang\)/.test(PL) && /BC\.checkAudio\(res\.mp3Buffer, s\.text, bcLang, workDir, null, s\.ttsText\)/.test(PL), '합성 루프 — 외국어 문장만 역대조 · 루비 읽기도 대조');
ok(/역대조_보고/.test(PL) && /BC\.writeReport/.test(PL), '대본마다 결과표(역대조_보고.tsv)');
ok(/bc: s\.backcheck \|\| null, tt: s\.ttsText \|\| null/.test(MJ) && /ss\.bc\.audio === ss\.ttsAudioPath/.test(MJ) && /if \(ss\.tt\) s\.ttsText = ss\.tt/.test(MJ), '작업본에 역대조 결과·루비 읽기 저장·복원(같은 음성 파일일 때만)');

console.log('[6c] 🇯🇵 아오조라문고 표기');
const AO = [
  '-------------------------------------------------------', '【テキスト中に現れる記号について】', '', '《》：ルビ', '（例）私《わたくし》', '', '｜：ルビの付く文字列の始まりを特定する記号', '-------------------------------------------------------', '',
  '［＃５字下げ］一［＃「一」は中見出し］', '',
  '　私《わたくし》はその人を常に先生と呼んでいた。その時私はまだ若々しい｜書生《しょせい》であった。世間を憚《はばか》る遠慮である。［＃「遠慮」に傍点］', '',
  '底本：「こころ」新潮文庫', '入力：富田倫生',
].join('\n');
const PM = require('../core/project-model');
const aoItems = S.splitHybrid(AO).items.map((it) => new PM.Sentence({ text: it.text }));
ok(aoItems.length === 3, `머리말 기호 설명·장 제목 표시(見出し)·底本 정보가 문장이 되지 않는다 (${aoItems.length}문장)`);
ok(aoItems[0].text === '私はその人を常に先生と呼んでいた。' && aoItems[0].ttsText === 'わたくしはその人を常に先生と呼んでいた。', '루비 — 자막은 한자 · TTS 는 읽기');
ok(aoItems[1].text === 'その時私はまだ若々しい書生であった。' && aoItems[1].ttsText === 'その時私はまだ若々しいしょせいであった。', '｜ 로 시작점을 정한 루비');
ok(aoItems[2].text === '世間を憚る遠慮である。' && !/［|］|＃/.test(aoItems[2].text), '［＃…］ 주석은 자막·낭독 모두에서 빠진다');
const koBook = S.splitIntoSentences('사마천은 《사기》를 썼다. 그 시대 ｜ 왕이 없던 때.');
ok(eq(koBook, ['사마천은 《사기》를 썼다.', '그 시대 ｜ 왕이 없던 때.']), '🔑 한국어 문장의 《》·｜ 는 그대로(아오조라 처리는 일본어 문단에서만)');
ok(new PM.Sentence({ text: '관계를 깨는 것은.' }).ttsText === undefined, '표식이 없으면 ttsText 가 생기지 않는다');
ok(/s\.ttsText \|\| s\.text, attemptOpts/.test(PL) && /processText\(s\.ttsText \|\| s\.text\)/.test(PL), 'TTS·캐시 키가 루비 읽기(ttsText)를 쓴다');

console.log('[7] 🔑 한국어 무변경 — 기존 대본 전체를 옛 모듈(4bc557f)과 대조');
(() => {
  let old;
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-old-'));
    for (const f of ['core/sentence-splitter.js', 'core/caption-splitter.js', 'tts/text-pronouncer.js']) {
      const src = execFileSync('git', ['show', '4bc557f:' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 });
      fs.writeFileSync(path.join(tmp, path.basename(f)), src);
    }
    old = { S: require(path.join(tmp, 'sentence-splitter.js')), C: require(path.join(tmp, 'caption-splitter.js')), TP: require(path.join(tmp, 'text-pronouncer.js')) };
  } catch (e) { console.log('  (git 이력이 없어 건너뜀: ' + e.message.slice(0, 60) + ')'); return; }
  const dir = path.join(os.homedir(), '.priming-maker', 'projects');
  const files = new Set();
  try { for (const f of fs.readdirSync(dir)) { try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (j.scriptPath && fs.existsSync(j.scriptPath)) files.add(j.scriptPath); } catch (_) {} } } catch (_) {}
  if (!files.size) { console.log('  (이 PC 에 대본이 없어 건너뜀)'); return; }
  let nS = 0, diff = 0; const ex = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const a = old.S.splitHybrid(text).items, b = S.splitHybrid(text).items;
    if (a.length !== b.length) { diff++; if (ex.length < 3) ex.push(path.basename(f) + ' 문장 수 ' + a.length + '→' + b.length); continue; }
    for (let i = 0; i < a.length; i++) {
      nS++;
      const t = a[i].text;
      const same = t === b[i].text && (a[i].speaker || null) === (b[i].speaker || null) && a[i].isIntro === b[i].isIntro
        && old.C.splitCaptionLines(t, 20).join('|') === C.splitCaptionLines(t, 20).join('|')
        && old.C.splitCaptionLines(t, 7).join('|') === C.splitCaptionLines(t, 7).join('|')
        && old.C.meaningfulLen(t) === C.meaningfulLen(t)
        && old.TP.processForTTS(t, []) === TP.processForTTS(t, []);
      if (!same) { diff++; if (ex.length < 3) ex.push(path.basename(f) + ' : ' + t.slice(0, 40)); }
    }
  }
  ex.forEach((x) => console.log('    ' + x));
  ok(diff === 0, `대본 ${files.size}편 · 문장 ${nS}개 — 문장·화자·도입부·자막 줄(20/7)·글자 수·TTS 문자열이 옛 코드와 같다 (다름 ${diff})`);
})();

console.log('\n[6d] 보이스디자인 저장 — 외국어는 잘라낸 구간을 받아쓰기해 참조텍스트로');
{
  const m = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const body = m.slice(m.indexOf("ipcMain.handle('qwen-design-save'"), m.indexOf("ipcMain.handle('open-script'"));
  ok(m.includes('S.vdLastLang = lang'), '생성 때 언어를 기억한다(S.vdLastLang)');
  ok(body.includes('vdLang && outBuf !== src'), '잘랐을 때만 받아쓰기한다(외국어 · 자르지 않았으면 입력 그대로)');
  ok(body.includes("tts-backcheck').checkAudio(outBuf") && body.includes('refTextForCut(refText, c.heard'), '잘라낸 음성(outBuf)의 받아쓰기로 참조텍스트를 맞춘다');
  ok(body.indexOf('refText = nt') > 0 && body.indexOf('refText = nt') < body.indexOf('fs.writeFileSync(wavPath'), '바꾼 뒤에 .txt·서버 등록을 한다');
  ok(m.includes("lang !== 'Korean' && WS.suggestPauseRange"), '외국어는 끝을 문장 사이 쉼에서 자르도록 제안한다(한국어는 예전 그대로)');
  const BCm = require('../core/tts-backcheck');
  const O = '昔々、ある村に、貧しいけれど心の優しい若者が住んでいました。彼は毎朝早く起きて、山へ薪を拾いに行きました。';
  ok(BCm.refTextForCut(O, '昔向かいある村に貧しいけれど心の優しい若者が住んでいました', 'ja') === '昔々、ある村に、貧しいけれど心の優しい若者が住んでいました。', '받아쓰기 오인식이 있어도 첫 문장이면 원문 표기를 쓴다');
  ok(BCm.refTextForCut(O, '昔々ある村に貧しいけれど心の優しい若者が住んでいました彼は前', 'ja').endsWith('彼は前'), '문장 중간에서 끊겼으면 받아쓰기를 쓴다');
  ok(BCm.refTextForCut(O, '', 'ja') === O, '받아쓰기가 없으면 원문 그대로');
  // 쉼에서 자르기 — 합성 신호: 소리 2초 · 쉼 0.4초 · 소리 2초 · 끝 감쇠
  const WSm = require('../core/wav-slice');
  const sr = 16000, seg = (sec, amp) => Array.from({ length: Math.round(sr * sec) }, (_, i) => Math.round(amp * Math.sin(i / 8)));
  const smp = [...seg(0.3, 0), ...seg(2, 12000), ...seg(0.4, 0), ...seg(2, 12000), ...seg(0.5, 3000), ...seg(0.3, 0)];
  const pcm = Buffer.alloc(smp.length * 2); smp.forEach((v, i) => pcm.writeInt16LE(v, i * 2));
  const hd = Buffer.alloc(44); hd.write('RIFF', 0); hd.writeUInt32LE(36 + pcm.length, 4); hd.write('WAVEfmt ', 8); hd.writeUInt32LE(16, 16); hd.writeUInt16LE(1, 20); hd.writeUInt16LE(1, 22); hd.writeUInt32LE(sr, 24); hd.writeUInt32LE(sr * 2, 28); hd.writeUInt16LE(2, 32); hd.writeUInt16LE(16, 34); hd.write('data', 36); hd.writeUInt32LE(pcm.length, 40);
  const pr = WSm.suggestPauseRange(Buffer.concat([hd, pcm]), { minSec: 1 });
  ok(pr && pr.pauseAt >= 2.2 && pr.pauseAt <= 2.4 && pr.end < 2.8, `끝을 문장 사이 쉼에서 자른다 (쉼 ${pr && pr.pauseAt}초 · 끝 ${pr && pr.end}초)`);
}

console.log(`\n🌏 lang-support ${pass}/${pass + fail} ${fail ? '실패' : '통과'}`);
process.exit(fail ? 1 : 0);
