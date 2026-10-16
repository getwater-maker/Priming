'use strict';
// 제작 버튼의 진행 표시 계약. 단순 편집/저장과 자체 진행 패널이 있는 다운로드·출판 등은 별도 경로.
const ACTIONS = {
  'tts-build': ['tts', 'TTS 생성', true],
  'tts-group': ['tts', '그룹 TTS', true],
  'tts-sentences': ['tts', '클립 TTS', true],
  'image-build': ['image', '이미지 생성', true],
  'regen-group': ['image', '이미지 재생성', true],
  'edit-group-image': ['image', '이미지 수정', true],
  'video-build': ['video', '비디오 생성'],
  'video-group': ['video', '그룹 비디오'],
  'export-vrew': ['out', '최종 출력'],
  'generate-prompts-api': ['out', '프롬프트 생성'],
  'claude-regen-prompt': ['out', '프롬프트 다시 쓰기'],
  'claude-vision-check': ['out', '이미지 검수'],
  'relink-work': ['out', '작업 파일 이어받기'],
  'intro-video-prep': ['out', '도입부 영상 준비'],
};
function scope(projects, args = {}) {
  return (projects || []).filter(p => args.shortsNum == null || p.shortsNum === args.shortsNum).map(p => {
    let groups = p.groups || [];
    if (args.groupNum != null) groups = groups.filter(g => g.num === args.groupNum);
    if (Array.isArray(args.items)) groups = groups.filter(g => args.items.some(x => x.groupNum === g.num));
    let ids = null;
    if (args.groupNum != null) ids = new Set(groups.flatMap(g => g.sentenceIds || []));
    if (Array.isArray(args.items)) ids = new Set(args.items.map(x => {
      const g = groups.find(g => g.num === x.groupNum);
      return g && g.sentenceIds[x.sentIdx];
    }).filter(Boolean));
    return {...p, groups, _progressSentenceIds: ids}; // 文장 배열은 원래 순서 유지(화면 ord와 동일)
  });
}
module.exports = { ACTIONS, scope };
