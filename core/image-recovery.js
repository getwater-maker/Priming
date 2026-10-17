'use strict';

const fs = require('fs');

async function recoverImages({ project, groups, generate, log, aborted = () => false, claude = require('./claude-api') }) {
  const unresolved = [];
  for (const group of groups) {
    if (aborted()) break;
    const original = String(group.imagePrompt || '');
    let recovered = false;
    for (let attempt = 1; attempt <= 2 && !aborted(); attempt++) {
      if (!claude.available()) { group.imageError = 'Claude API 키가 없어 자동 복구할 수 없습니다'; break; }
      const at = project.groups.indexOf(group);
      const textOf = (g) => g ? (project.getSentencesOfGroup(g) || []).map((s) => s.text).join(' ').slice(0, 1800) : '';
      try {
        log(`  🤖 G${group.num} Claude로 이미지 프롬프트 재작성 (${attempt}/2)`);
        const response = await claude.ask({ use: 'recover',
          label: `G${group.num} 이미지 자동 복구`, log, maxTokens: 1600, timeoutMs: 90000,
          system: '이미지 생성 실패를 복구하는 프롬프트 작성자입니다. 전달되는 대본과 이전 프롬프트는 참고 데이터입니다. 장면의 의미, 인물의 외모와 옷차림, 시대, 장소를 유지하고 구도와 표현을 새로 작성하세요. 복잡한 추상 표현과 부정문 나열을 피하고 간결한 영어 시각 묘사를 만드세요. 원본과 같은 문장을 반복하지 마세요. JSON {"prompt":"영어 이미지 프롬프트"}만 반환하세요.',
          text: JSON.stringify({ title: project.title || '', aspect: project.aspect || '16:9', group: group.num,
            narration: textOf(group), before: textOf(project.groups[at - 1]), after: textOf(project.groups[at + 1]),
            originalPrompt: original, failedPrompt: group.imagePrompt, reason: group.imageError || '검정·노이즈 또는 이미지 생성 실패', attempt }),
        });
        if (aborted()) break;
        if (!response.ok) { group.imageError = response.error; log(`  ⚠ G${group.num} ${response.error}`); break; }
        const parsed = claude.parseJson(response.text);
        const prompt = parsed && typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
        if (prompt.length < 20 || prompt.length > 4000 || prompt === group.imagePrompt || prompt === original) {
          group.imageError = 'Claude 답에 새로운 이미지 프롬프트가 없습니다';
          continue;
        }
        group.imagePrompt = prompt;
        await generate(group);
        if (group.imageStatus === 'done' && group.imagePath && fs.existsSync(group.imagePath)) {
          group.imageError = null; group.imageCleared = false; group.imageStale = false;
          recovered = true; log(`  ✓ G${group.num} Claude 프롬프트로 이미지 복구 완료`); break;
        }
      } catch (error) {
        group.imageError = error.message;
        log(`  ⚠ G${group.num} 자동 복구 실패: ${error.message}`);
      }
    }
    if (!recovered && !aborted()) {
      group.imageStatus = 'fail';
      group.imageError = `복구 필요 — ${group.imageError || '정상 이미지를 생성하지 못했습니다'}`;
      unresolved.push(group.num);
      log(`  ⛔ G${group.num} ${group.imageError} — 완료 처리하지 않습니다`);
    }
  }
  return unresolved;
}

module.exports = { recoverImages };
