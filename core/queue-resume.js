'use strict';
// 진행 이력이 있는 미완료 작업을 새 작업보다 먼저 처리한다. 같은 우선순위에서는 큐 순서를 보존한다.
function resumePlan(plan, items) {
  const byId = new Map((items || []).map((it) => [it.id, it]));
  const priority = (entry) => {
    const it = byId.get(entry.id);
    if (!it) return 2;
    if (it.status === 'done' && it.run?.completed) return 2;
    return it.run?.startedAt || ['interrupted', 'failed', 'running', 'done'].includes(it.status) ? 0 : 1;
  };
  return [...plan].sort((a, b) => priority(a) - priority(b));
}
module.exports = { resumePlan };
