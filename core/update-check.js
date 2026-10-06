'use strict';
/**
 * update-check.js — 🔄 「업데이트 확인·적용」 버튼의 판정(순수 함수 · 2026-10-06 로이 「끄지 않고 버튼으로 업그레이드」)
 *   적용 자체는 기존 라이트 업데이터(light-updater.applyUpdates — 시작 때 하는 것과 **같은 함수**)가 한다. 여기는 「받을 게 있는가」만 판정한다.
 *   · newer  = 원격 매니페스트 버전 > 설치본 버전 (적용 가능)
 *   · same   = 같다(최신)
 *   · older  = 원격이 더 낮다(받지 않는다 — 2026-09-19 역행 사고 방지와 같은 규칙)
 *   · deps   = 구성요소(의존성)가 바뀐 새 버전 — 파일 교체로 못 한다 → 설치파일 재설치 안내
 *   · none   = 매니페스트를 읽지 못했다(오프라인 등)
 *   ⚠ electron 을 쓰지 않는다(node 시험 가능) — 렌더러 번들에 들어가도 안전한 순수 코드.
 */
const crypto = require('crypto');
const { compareVersions } = require('./version-order');

const depsHash = (deps) => crypto.createHash('sha1').update(Buffer.from(JSON.stringify(deps || {}))).digest('hex');

function evaluate(manifest, localPkg) {
  const cur = String((localPkg && localPkg.version) || '');
  if (!manifest || typeof manifest !== 'object' || !manifest.files) return { state: 'none', current: cur, latest: '', message: '업데이트 서버(GitHub)에서 버전 정보를 읽지 못했습니다 — 인터넷 연결을 확인하세요' };
  const latest = String(manifest.version || '');
  if (manifest.deps && manifest.deps !== depsHash(localPkg && localPkg.dependencies)) {
    return { state: 'deps', current: cur, latest, message: `새 버전 ${latest} 은 구성요소가 바뀌어 설치파일 재설치가 필요합니다(GitHub Releases)` };
  }
  const c = compareVersions(latest, cur);
  if (c > 0) return { state: 'newer', current: cur, latest, message: `새 버전 ${latest} 이(가) 있습니다 (지금 ${cur})` };
  if (c < 0) return { state: 'older', current: cur, latest, message: `이 PC(${cur})가 서버(${latest})보다 높습니다 — 받지 않습니다` };
  return { state: 'same', current: cur, latest, message: `최신 버전입니다 (${cur})` };
}

module.exports = { evaluate, depsHash };
