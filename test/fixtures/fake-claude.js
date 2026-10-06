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
  if (mode === 'junk') { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '고칠 곳을 찾지 못했습니다.' })); return; }
  const table = [['느겼습니다', '느꼈습니다'], ['부인 할수록', '부인할수록'], ['없는낱말', '없는 낱말']];
  const items = table.filter(([w]) => input.includes(w)).map(([w, c]) => ({ 틀림: w, 바름: c }));
  items.push({ 틀림: '지어낸지적', 바름: '지어낸 지적' });   // 원문에 없는 지적 — 앱이 버려야 한다
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.005, result: '```json\n' + JSON.stringify(items) + '\n```' }));
});
