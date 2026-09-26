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

console.log(`\n🌏 lang-support ${pass}/${pass + fail} ${fail ? '실패' : '통과'}`);
process.exit(fail ? 1 : 0);
