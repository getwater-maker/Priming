/**
 * API 키 저장/로드
 * 위치: ~/.flow-app/tts-secrets.json
 *
 * 1차: 평문 저장 (PrimingFlow 단독 사용 가정).
 * 추후 강화: AES 암호화 또는 Windows Credential Manager.
 *
 * 사용:
 *   SecretStore.set('azure', { key: 'xxx', region: 'eastasia' });
 *   const s = SecretStore.get('azure');
 *   SecretStore.has('gemini');          // Gemini TTS(음성) 전용 — 나노바나나 이미지는 'gemini-image'
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SECRET_DIR = path.join(os.homedir(), '.flow-app');
const SECRET_PATH = path.join(SECRET_DIR, 'tts-secrets.json');

// 🔑 Gemini 키 분리(v0.9.32 · 로이 2026-10-16) — 'gemini' = Gemini TTS(음성) 전용 · 'gemini-image' = 나노바나나(이미지) 전용.
//   예전엔 한 칸('gemini')을 둘이 같이 썼다 → 이미지 칸이 아직 없으면 그때의 키를 한 번만 옮겨 적는다(그 뒤로는 서로 따로).
const IMAGE_ID = 'gemini-image';
function splitGeminiOnce(all) {
  if (!all || typeof all !== 'object' || Object.prototype.hasOwnProperty.call(all, IMAGE_ID)) return false;
  const k = all.gemini && String(all.gemini.key || '').trim();
  if (!k) return false;
  all[IMAGE_ID] = { key: k, from: 'gemini' };
  return true;
}

function loadAll() {
  try {
    if (fs.existsSync(SECRET_PATH)) {
      const all = JSON.parse(fs.readFileSync(SECRET_PATH, 'utf-8'));
      if (splitGeminiOnce(all)) saveAll(all);
      return all;
    }
  } catch (e) {
    console.error('[secret-store] 로드 실패:', e.message);
  }
  return {};
}

function saveAll(data) {
  try {
    fs.mkdirSync(SECRET_DIR, { recursive: true });
    fs.writeFileSync(SECRET_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[secret-store] 저장 실패:', e.message);
    return false;
  }
}

function get(providerId) {
  const all = loadAll();
  return all[providerId] || null;
}

function set(providerId, secret) {
  const all = loadAll();
  all[providerId] = secret;
  return saveAll(all);
}

function remove(providerId) {
  const all = loadAll();
  delete all[providerId];
  return saveAll(all);
}

function has(providerId) {
  const s = get(providerId);
  return !!(s && Object.keys(s).length > 0);
}

module.exports = { get, set, remove, has, SECRET_PATH, IMAGE_ID, splitGeminiOnce };
