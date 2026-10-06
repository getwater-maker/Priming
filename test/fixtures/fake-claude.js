// 🧪 가짜 claude — core/spell-check.js 테스트용(진짜 Claude 구독을 쓰지 않는다).
//   stdin 의 문단을 읽고 claude -p --output-format json 과 같은 꼴로 답한다.
//   FAKE_CLAUDE_MODE: ok(기본 · 아래 오타가 있으면 지적 · ```json 펜스로 감싼다) · login(로그인 만료) · hang(답하지 않음) · junk(목록 아님)
//   받은 인자는 FAKE_CLAUDE_ARGS 파일이 있으면 거기에 적는다(옵션을 빠뜨리지 않았는지 보는 용도).
const fs = require('fs');
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_ARGS) fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), input }), 'utf8');
  const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  if (mode === 'login') { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login' })); return; }
  // ✂🤖 끊어 읽기(core/cap-marks) 지시문이면 — 「번호<탭>글」 줄마다 쉼표 뒤·네 어절마다 " / " 를 넣어 답한다
  //   FAKE_CLAUDE_CAPMARKS_BAD=1 이면 2번 문장의 글자를 바꿔 답한다(앱이 그 문장을 버려야 한다)
  const sys = process.argv[process.argv.indexOf('--system-prompt') + 1] || '';
  if (/끊어 읽기/.test(sys)) {
    if (process.env.FAKE_CLAUDE_CAPMARKS_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_CAPMARKS_LOG, input.split('\n').filter(Boolean).length + '\n');
    const out = input.split('\n').filter(Boolean).map((line) => {
      const [n, t] = line.split('\t');
      const ws = t.split(' '); const parts = []; let cur = [];
      const per = /한 줄에 들어가지 않는다/.test(sys) ? 2 : 4;   // 2차(긴 덩어리) 요청은 두 어절마다
      ws.forEach((w, i) => { cur.push(w); if (/,$/.test(w) || cur.length === per || i === ws.length - 1) { parts.push(cur.join(' ')); cur = []; } });
      let body = parts.join(' / ');
      if (process.env.FAKE_CLAUDE_CAPMARKS_BAD && n === '2') body = body.replace(/./, 'X');
      return n + '\t' + body;
    }).join('\n');
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, result: out }));
    return;
  }
  if (mode === 'junk') { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '고칠 곳을 찾지 못했습니다.' })); return; }
  const table = [['느겼습니다', '느꼈습니다'], ['부인 할수록', '부인할수록'], ['없는낱말', '없는 낱말']];
  const items = table.filter(([w]) => input.includes(w)).map(([w, c]) => ({ 틀림: w, 바름: c }));
  items.push({ 틀림: '지어낸지적', 바름: '지어낸 지적' });   // 원문에 없는 지적 — 앱이 버려야 한다
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.005, result: '```json\n' + JSON.stringify(items) + '\n```' }));
});
