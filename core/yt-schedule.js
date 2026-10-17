'use strict';
/**
 * yt-schedule.js — ⏰ 예약 업로드 시각 계산 (v0.9.68 · 로이 2026-10-18 「이제 예약업로드를 하고 싶어」)
 *
 *   채널 설정 `ytSchedule = { on:boolean, time:'HH:MM' }` — 켜면 업로드 때 `status.publishAt` 을 실어 올린다
 *   (끄면 예전과 같다 = 비공개만). 시각은 **KST** 로 정하고 API 에는 UTC ISO 로 보낸다(전역 규칙: 화면·로그는 KST).
 *
 *   한 채널에 여러 편이 줄 서면 **하루에 한 편씩** 이어 붙인다 — 채널마다 「마지막으로 배정한 시각」을
 *   이 PC 에 적어 두고(~/.priming-maker/youtube-schedule.json) 그 다음 날 같은 시각을 준다. 업로드가 **성공한 뒤에만** 적는다.
 *   ⚠ 다른 PC·Studio 에서 잡은 예약은 모른다(그 PC 의 기록만 본다) — 채널 하나를 두 PC 에서 예약하면 같은 날이 겹칠 수 있다.
 *
 *   구글 규칙: publishAt 은 **미래**여야 하고 privacyStatus 는 private 이어야 한다. 지금부터 MARGIN 분 안쪽은 미래로 치지 않는다.
 * 테스트: test/yt-schedule.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const MARGIN_MIN = 30;

function storeFile() { return path.join(os.homedir(), '.priming-maker', 'youtube-schedule.json'); }
function _load() { try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')) || {}; } catch (_) { return {}; } }

/** 'H:MM' · 'HH:MM' → {h,m} | null */
function parseTime(s) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s || ''));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h <= 23 && mi <= 59 ? { h, m: mi } : null;
}
/** 채널 설정 → {on, time} (정규화 · 시각이 틀리면 꺼진 것으로) */
function normSchedule(v) {
  const t = v && parseTime(v.time);
  return t ? { on: !!v.on, time: `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}` } : { on: false, time: '' };
}

/** epoch ms → 'YYYY-MM-DD HH:MM' (KST) */
function kst(ms) { return new Date(ms + KST_MS).toISOString().slice(0, 16).replace('T', ' '); }

/**
 * 다음 예약 시각(epoch ms · UTC 기준 순간).
 * @param {{time:string, now?:number, last?:number|null, marginMin?:number}} a  last = 이 채널에 마지막으로 배정한 시각
 */
function nextSlot(a) {
  const t = parseTime(a.time);
  if (!t) return null;
  const now = a.now != null ? a.now : Date.now();
  const earliest = now + (a.marginMin != null ? a.marginMin : MARGIN_MIN) * 60000;
  const kstNow = now + KST_MS;                                           // KST 벽시계를 UTC 필드로 읽기 위해 9시간을 더한 값
  const dayStart = kstNow - (((kstNow % DAY_MS) + DAY_MS) % DAY_MS);    // 오늘 KST 00:00 (같은 방식의 값)
  let c = dayStart + (t.h * 60 + t.m) * 60000 - KST_MS;                  // 오늘 HH:MM KST 의 실제 순간
  while (c < earliest) c += DAY_MS;
  const last = Number(a.last) || 0;
  while (last && c <= last) c += DAY_MS;
  return c;
}

/** 이 채널에 마지막으로 배정한 시각(ms) — 과거면 의미 없다 */
function lastAssigned(channelId) {
  const v = Date.parse((_load()[channelId] || {}).last || '');
  return Number.isFinite(v) ? v : 0;
}
/** 업로드가 성공한 뒤 호출 — 이 채널의 마지막 배정 시각을 적는다(더 늦은 값만) */
function recordAssigned(channelId, ms) {
  try {
    const all = _load();
    const prev = Date.parse((all[channelId] || {}).last || '') || 0;
    if (ms > prev) all[channelId] = { last: new Date(ms).toISOString() };
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), JSON.stringify(all, null, 2), 'utf8');
    return true;
  } catch (_) { return false; }
}

/** 채널 설정이 켜져 있으면 이번 업로드의 publishAt(ISO UTC)과 KST 표시를 돌려준다. 꺼져 있으면 null */
function planFor(channelId, schedule, now) {
  const s = normSchedule(schedule);
  if (!s.on) return null;
  const ms = nextSlot({ time: s.time, now, last: lastAssigned(channelId) });
  return ms == null ? null : { ms, publishAt: new Date(ms).toISOString(), kst: kst(ms), time: s.time };
}

module.exports = { MARGIN_MIN, storeFile, parseTime, normSchedule, kst, nextSlot, lastAssigned, recordAssigned, planFor };
