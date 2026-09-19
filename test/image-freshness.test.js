'use strict';
/**
 * 대본을 고친 뒤 옛 장면이 복원/재표시되던 회귀 방지.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const F = require('../core/group-freshness');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const pipe = fs.readFileSync(path.join(root, 'core', 'pipeline.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'renderer', 'src', 'App.jsx'), 'utf8');
let pass = 0;
function ok(value, label) { assert.ok(value, label); pass++; console.log('  ✓', label); }

console.log('\n[1] 그룹 내용 비교');
ok(F.sameGroupContent([{ text: '같은  문장' }], [{ text: ' 같은 문장 ' }]), '공백 차이는 같은 내용');
ok(!F.sameGroupContent([{ text: '새 문장' }], [{ text: '옛 문장' }]), '문장이 바뀌면 다른 내용');
ok(!F.sameGroupContent([{ text: '하나' }, { text: '둘' }], [{ text: '하나' }]), '문장 수가 바뀌면 다른 내용');
ok(!F.sameGroupContent([], []), '빈 그룹은 안전하게 복원하지 않는다');

console.log('\n[2] 스냅샷·인라인 수정 보호');
ok(/sameGroupContent\(sents, gs\.sentences \|\| \[\]\)/.test(main), '스냅샷 복원은 그룹 문장 내용까지 비교');
ok(/g\.imageStale = true;[\s\S]{0,100}g\.imageCleared = true/.test(main), '바뀐 그룹은 새 이미지 대상으로 표시하고 캐시 복원 차단');
ok(/g\.imagePath = null;[\s\S]{0,100}g\.imagePrompt = null;[\s\S]{0,140}g\.imageStale = true/.test(main), '인라인 문장 수정은 옛 이미지·프롬프트를 무효화');
ok(/g\.imagePromptStale = !g\.imagePrompt/.test(main), '대본에 새 프롬프트가 있으면 stale 로 덮어쓰지 않는다');
ok(/if \(g\.imageStale\) continue/.test(main), 'stale 그룹은 이미지 캐시 프리필 금지');
ok(/if \(g\.imageStale\) return false/.test(main), 'stale 그룹은 기존 영상이 있어도 이미지 생성 대상');

console.log('\n[3] 같은 파일명 덮어쓰기 화면 캐시 방지');
ok(/imageVersion: mediaVersion\(g\.imagePath\)/.test(pipe), 'DTO에 이미지 파일 버전 포함');
ok(/media\(c\.imagePath, c\.imageVersion\)/.test(app), '썸네일 URL에 이미지 버전 사용');
ok(/Cache-Control': 'no-store'/.test(main), 'media 응답 브라우저 캐시 금지');
ok(/imageStale[\s\S]{0,220}className="genoverlay"[\s\S]{0,80}새 이미지 필요/.test(app), '새 이미지 필요 안내는 생성 중과 같은 13px 오버레이 사용');

console.log(`\n✅ image-freshness: ${pass}/${pass}\n`);
