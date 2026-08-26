/**
 * Grok Imagine 비디오 변환 엔진 (이미지 → 진짜 움직이는 영상)
 *
 * 흐름:
 *   1. Playwright 로 grok.com/imagine 진입 (프로필에 로그인 세션이 남아 있다)
 *   2. 로그인 상태 확인 — 안 되어 있으면 사용자에게 수동 로그인 요청
 *   3. 비디오 모드 · 해상도 · 길이 · 🔇오디오 끄기 · 종횡비 설정
 *   4. 입력 이미지 업로드 → 모션 프롬프트 입력
 *   5. 제출 → `/imagine/post/<UUID>` 로 이동 → 폴링으로 완료 대기
 *   6. 완성된 mp4 를 URL 로 직접 받아 outputPath 에 저장
 *
 * 인프라:
 *   - flow-engine.js 와 같은 패턴 (chromium.launchPersistentContext = 프로필에 쿠키 영속)
 *   - anti-detect.js 의 humanDelay / 일일 한도 (별도 store: tts/grok-store.js)
 *   - 로그인 자동화는 없다 — 계정당 한 번 직접 로그인(⚙ Grok(X) 멀티계정 → 🔑 로그인)하면
 *     그 프로필에 세션이 남아 이후 자동. (프로필 = 계정)
 *
 * 🔑 셀렉터 정책 (2026-08-19 전면 재설정 — 그 전 UI 개편으로 통째로 깨졌던 경험):
 *   **클래스·nth-child 를 쓰지 않고 aria-label / role 만 앵커로 쓴다.** 아래 GROK_SELECTORS 주석 참조.
 *   또 깨지면 로그의 `[DUMP 칩바]` 한 줄로 새 aria-label 을 바로 알 수 있다(_dumpChipBar).
 *
 * ⚠️ 완성 판정은 반드시 `_findMainVideo()` 를 쓴다 — 페이지에 **완성된 <video> 가 여러 개**
 *    (좌측 히스토리 썸네일) 깔려 있어서, 그냥 <video> 를 집으면 **예전 영상**을 내려받는다.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const GrokStore = require('./tts/grok-store');

// 사용자 데이터 디렉토리 (Flow 프로필과 분리)
const PROFILE_BASE = path.join(os.homedir(), '.flow-app', 'grok-profiles');
const GROK_URL = 'https://grok.com/imagine';

// grok.com/imagine 의 비디오 생성 흐름 selector — 2026-08-19 **전면 재설정**(실측).
//
// 🔴 왜 갈아엎었나: 2026-08 개편으로 옛 칩 컨테이너
//    `form div.flex.flex-wrap.items-center` 가 **사라졌다(매치 0개)**. 거기에 매달려 있던
//    셀렉터 7개(비디오/이미지 칩·480p·720p·6s·10s·비율 트리거)가 한꺼번에 죽어
//    "비디오 칩 못 찾음" → 영상 생성이 통째로 실패했다.
// 🔑 그래서 **클래스·위치(nth-child)에 의존하지 않는다.** 칩이 전부 `role="radio"` 가 되면서
//    비활성 칩은 텍스트조차 없어졌으므로(`has-text("비디오")` 도 실패) 사이트가 접근성 때문에
//    유지할 수밖에 없는 **aria-label** 을 앵커로 쓴다.
//    실측 aria-label: `생성 모드`(이미지·비디오·에이전트) / `비디오 해상도`(480p·720p·1080p) /
//    `동영상 길이`(6s·10s·15s) / `종횡비` / `Video audio` / `업로드` / `제출`
//    ⚠ 1080p·15s 는 **로그인 상태에서만** 보인다(로그아웃이면 480p/720p·6s 만).
// ⚠ 비율 메뉴는 항목이 `[role="menuitemradio"]` 이고 라벨이 한국어이며 맨 앞에 **「Auto」가
//    새로 생겨 6개**가 됐다 → 옛 nth-child(4)/(5) 는 한 칸씩 밀려 **엉뚱한 비율**을 골랐다.
//    반드시 텍스트("16:9"/"9:16")로 고른다.
const GROK_SELECTORS = {
  // 모션 프롬프트 입력 — 이제 textarea 가 아니라 contenteditable div(role=textbox) 다.
  promptInput:       'form [role="textbox"], form [contenteditable="true"], form textarea',
  // 이미지 업로드 — 여전히 form 안의 숨은 input[type=file] (accept=image/*, multiple)
  fileInput:         'form input[type="file"]',
  // 생성 모드 칩 (role=radio · aria-label). 선택 여부는 aria-checked 로 확인한다.
  videoModeChip:     'form [role="radio"][aria-label="비디오"], form [role="radio"][aria-label="Video"]',
  imageModeChip:     'form [role="radio"][aria-label="이미지"], form [role="radio"][aria-label="Image"]',
  // 옵션 그룹(라디오그룹) — 개별 칩은 이 그룹 안에서 **텍스트**로 고른다(_pickRadio).
  resGroup:          'form [role="radiogroup"][aria-label*="해상도"], form [role="radiogroup"][aria-label*="esolution" i]',
  durGroup:          'form [role="radiogroup"][aria-label*="길이"], form [role="radiogroup"][aria-label*="uration" i]',
  // 🔊 영상 오디오 토글 — 새로 생겼고 **기본이 켜짐(aria-pressed="true")**.
  //    우리는 TTS 를 따로 얹으므로 반드시 끈다(끄면 실제로 오디오 트랙 없는 mp4 가 나온다 — 실측).
  audioToggle:       'form button[aria-label="Video audio"], form button[aria-label*="오디오"]',
  // 종횡비 — 트리거에 aria-label 이 붙어 위치 의존이 사라졌다(현재 값은 버튼 텍스트에 표시).
  aspectChipTrigger: 'form button[aria-label="종횡비"], form button[aria-label*="spect" i]',
  aspectMenuItem:    '[role="menuitemradio"], [role="menuitem"], [role="option"]',
  submitButton:      'form button[type="submit"]',
  // 완성된 본편 영상. ⚠ **`main` 조상이 없어졌다** — 옛 `main article video` 는 0개였다.
  //    그리고 좌측 히스토리 썸네일마다 완성된 <video> 가 깔려 있어서 이 셀렉터만으로는
  //    **남의 예전 영상**을 집는다 → 실제 판정은 반드시 `_findMainVideo()` 를 쓴다.
  videoElement:      'article video, video',
  // 다운로드 버튼(우측 aside). URL 직접 다운로드가 1순위이므로 이건 폴백 전용.
  downloadButton:    'aside button[aria-label*="다운로드"], button[aria-label*="다운로드"], button[aria-label*="Download" i]',
  // 로그인 안 됨 감지 — 로그아웃이면 「가입하기 / 로그인」 모달이 뜬다.
  loginIndicator:    'a[href*="login" i], button:has-text("가입하기"), button:has-text("Sign in"), button:has-text("Log in"), button:has-text("로그인")',
};

/**
 * (은퇴) 사용자의 기본 크롬 프로필을 grok-profiles/userchrome/ 로 복사하려던 함수.
 *
 * 🔴 2026-08-19 확인 — **이 기능은 한 번도 작동한 적이 없다.** 완료 판정을
 *    `userchrome/Default/Cookies` 존재로 했는데, 요즘 크롬은 쿠키를
 *    **`Default/Network/Cookies`** 에 둔다 → 그 파일은 생길 수가 없다.
 *    그래서 매 실행마다 10~30초짜리 복사를 헛돌린 뒤 "Cookies 복사 실패" 를 찍고
 *    결국 격리 프로필(`grok-profiles/default`)로 폴백해 왔다.
 *
 * 🔑 그럼 경로만 고치면 되지 않나? **고치면 오히려 깨진다.** 지금 실제로 로그인돼 있는 건
 *    격리 프로필(`grok-profiles/default`) 이고, 복사가 성공하면 그 순간부터 앱이
 *    `userchrome`(= 평소 크롬 Default 프로필의 사본) 을 쓰게 된다. 이 PC 의 크롬은
 *    프로필이 24개이고 grok 로그인은 Default 에 없다 → **잘 되던 로그인이 사라진다.**
 *    게다가 프로필당 계정을 지정하는 현재 설계(🔑 로그인 버튼)와도 어긋난다.
 *
 * 그래서 **의도적으로 no-op** 으로 남긴다(항상 null → 격리 프로필 사용 = 지금까지의 실제 동작).
 * 다른 계정으로 쓰려면 ⚙ Grok(X) 멀티계정에서 계정을 추가하고 🔑 로그인을 한 번 하면 된다.
 */
async function _ensureUserChromeProfileCopy(_log) {
  return null;
}

class GrokEngine {
  constructor(opts = {}) {
    this.profileId = opts.profileId || 'default';
    // profileDir 는 start() 에서 결정 — profileId='default' 면 사용자 크롬 프로필 복사 시도,
    // 명시적 profileId 면 그 격리 프로필 사용.
    this.profileDir = null;
    this.logger = typeof opts.logger === 'function' ? opts.logger : () => {};
    this.context = null;
    this.page = null;
    this._aspectRatio = null;   // '9:16'(쇼츠) 이면 6s + 9:16 Vertical 강제 (UI 가 생성 전 설정)
  }

  log(msg) { this.logger(msg); }

  /** dialog-portal 의 open backdrop 이 있으면 ESC 로 닫아 클릭 가로챔 방지 */
  async _dismissAnyDialog() {
    try {
      let dialog = await this.page.$('#dialog-portal [data-state="open"]');
      let attempts = 0;
      while (dialog && attempts < 3) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(400);
        dialog = await this.page.$('#dialog-portal [data-state="open"]');
        attempts++;
      }
      if (attempts > 0) this.log(`[Grok] dialog backdrop 닫음 (ESC ${attempts}회)`);
    } catch {}
  }

  // 해상도 선택 — 라디오그룹에서 **텍스트로** 고른다(480p · 720p · 1080p).
  //   720p 이상은 한도(빨간 계기판)로 막힐 수 있다 → 막혔으면 480p 로 선제 전환해서
  //   영상 생성을 멈추지 않고 계속 진행한다. 반환값 = 실제 선택된 해상도.
  async _selectResolutionChip(want) {
    const target = /^(480p|720p|1080p)$/.test(String(want)) ? String(want) : '480p';
    try {
      if (target === '480p') {
        const r = await this._pickRadio(GROK_SELECTORS.resGroup, '480p');
        if (!r.ok) this.log(`[Grok] ⚠ 해상도 480p 선택 실패(${r.reason}) — 현재 값 유지`);
        return '480p';
      }
      // 1순위: 빨간 계기판 aria-label = 가장 신뢰할 수 있는 한도 신호.
      //   (검증됨 2026-06-07: 한도여도 칩 자체는 활성이라 칩 검사만으론 못 잡는다)
      const lim = await this._check720pLimit();
      let blocked = lim.limited;
      const limitLabel = lim.label;

      if (!blocked) {
        const probe = await this._pickRadio(GROK_SELECTORS.resGroup, target);
        if (probe.ok && probe.checked) { this.log(`[Grok] 해상도 ${target} 선택`); return target; }
        // 2순위(보조): 그 칩이 없거나 disabled → 막힘으로 본다.
        const opt = (probe.options || []).find((o) => o.t === target);
        blocked = !!(opt && opt.dis) || probe.reason === 'option-missing';
        if (!blocked && probe.ok) {
          // 클릭은 됐지만 aria-checked 를 못 읽음 — 표시만 못 읽은 것일 수 있으니 그대로 진행.
          this.log(`[Grok] 해상도 ${target} 클릭(확인 불가) — 그대로 진행`);
          return target;
        }
        if (probe.reason === 'group-missing') {
          this.log('[Grok] ⚠ 해상도 그룹을 못 찾음 — 비디오 모드가 아닐 수 있다. 현재 값 유지');
          return target;
        }
      }
      if (blocked) {
        this.log(`[Grok] ⚠️ ${target} 한도/비활성 감지 — 480p 로 선제 전환 (영상은 계속 생성)${limitLabel ? ` | ${limitLabel}` : ''}`);
        if (!limitLabel) await this._dumpResChips();   // 계기판 aria-label 을 못 잡은 경우만 마크업 덤프
        await this._pickRadio(GROK_SELECTORS.resGroup, '480p');
        return '480p';
      }
      return target;
    } catch (e) {
      this.log(`[Grok] 해상도 선택 예외(무시): ${e.message}`);
      return target;
    }
  }

  // 720p 한도 감지 (검증됨 2026-06-07, openclaude 실측).
  //   grok.com 은 720p 한도 도달 시 칩을 비활성화하지 않는다(720p 칩은 계속 활성/클릭 가능).
  //   대신 입력창 우하단에 빨간 계기판 아이콘을 띄운다:
  //     <button class="... text-fg-danger" aria-label="동영상 (720p, 10초) 생성 한도에 도달했습니다: 오후 6:01에 다시 사용 가능">
  //       <svg class="lucide lucide-gauge"> ... </svg>
  //   → 이 aria-label("한도에 도달") + 빨간 계기판(text-fg-danger)이 유일하게 신뢰할 수 있는 한도 신호.
  //   반환: { limited: boolean, label: string }  (label = aria-label, 재사용 시각 포함)
  async _check720pLimit() {
    try {
      return await this.page.evaluate(() => {
        const gauges = [...document.querySelectorAll('svg.lucide-gauge')];
        for (const g of gauges) {
          const btn = g.closest('button') || g.parentElement;
          const cls = (btn && btn.className) || '';
          const aria = (btn && btn.getAttribute('aria-label')) || '';
          const danger = /text-fg-danger|danger/i.test(cls);
          const limitTxt = /한도에\s*도달|limit\s*reached|generation\s*limit/i.test(aria);
          const is720 = /720p|720/i.test(aria);
          if ((danger || limitTxt) && is720) return { limited: true, label: aria.trim() };
          if (danger && limitTxt) return { limited: true, label: aria.trim() };
        }
        return { limited: false, label: '' };
      });
    } catch (_) {
      return { limited: false, label: '' };
    }
  }

  // 요청(전체) 한도 팝업 감지 — "요청 한도에 도달했습니다 / Upgrade to SuperGrok".
  //   720p 한도(_check720pLimit, 자동 480p 전환)와는 다른, 계정 전체 요청 한도.
  //   이게 뜨면 재시도해도 소용없으므로 작업을 멈춰야 한다. 반환: { limited, reset }(reset=재사용 시각 텍스트).
  // 재설정/재사용 시각 텍스트 추출 — "20일 (월) 오후 3:23에 재설정" · "7월 14일 오후 6:01에 다시 사용" · "오후 6:01에 다시 사용"
  _extractReset(txt) {
    txt = String(txt || '');
    let m = txt.match(/(\d{1,2}월\s*)?\d{1,2}일[^\n]{0,14}?(오전|오후)\s*\d{1,2}:\d{2}[^\n]{0,10}?(재설정|다시\s*사용|available)/);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
    m = txt.match(/(오전|오후)\s*\d{1,2}:\d{2}[^\n]{0,10}?(재설정|다시\s*사용|available)/);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
    return '';
  }
  async _checkRequestLimit() {
    try {
      let txt = await this.page.evaluate(() => (document.body ? document.body.innerText : '') || '');
      // 중단 신호: 요청(전체) 한도 · 주간 한도(100%) · 480p 생성 한도 · SuperGrok 업그레이드 권유 · request limit.
      //   ※ 720p 한도는 _check720pLimit 가 480p 전환으로 처리하므로 여기서 제외(잘못 멈춤 방지).
      if (!/요청\s*한도에?\s*도달|주간\s*한도|한도의?\s*100\s*%|Upgrade to SuperGrok|request\s*limit\s*reached|weekly\s*limit|480p.{0,12}한도/i.test(txt)) {
        return { limited: false, reset: '' };
      }
      let reset = this._extractReset(txt);
      // 주간 한도는 '빨간 시계' 아이콘을 눌러야 재설정 날짜가 팝업에 뜬다 → 후보 버튼 클릭 시도(best-effort).
      if (!reset) {
        try {
          const clicked = await this.page.evaluate(() => {
            const cands = Array.from(document.querySelectorAll('button,[role="button"],[aria-label]'));
            const el = cands.find((e) => {
              const cls = (e.className && e.className.baseVal != null) ? e.className.baseVal : (e.className || '');
              const al = (e.getAttribute && e.getAttribute('aria-label')) || '';
              return /text-fg-danger|text-red|clock|시계/i.test(String(cls)) || /한도|재설정|시계|clock|limit/i.test(al);
            });
            if (el) { (el.closest('button') || el).click(); return true; }
            return false;
          });
          if (clicked) { await this.page.waitForTimeout(700); txt = await this.page.evaluate(() => (document.body ? document.body.innerText : '') || ''); reset = this._extractReset(txt); }
        } catch (_) {}
      }
      if (!reset) {
        // 재설정 날짜를 못 읽음 → 하단/팝업 텍스트 덤프(셀렉터 정밀화용, 사용자가 로그 공유하면 고정)
        try { this.log('[Grok] [DUMP 한도영역] ' + String(txt).replace(/\s+/g, ' ').slice(-400)); } catch {}
      }
      return { limited: true, reset: reset || '' };
    } catch (_) {}
    return { limited: false, reset: '' };
  }

  // 720p 막힘이 의심될 때 해상도 그룹 DOM 을 로그로 덤프 — 계기판/disabled 마크업 확인용.
  async _dumpResChips() {
    try {
      const html = await this.page.$eval(
        GROK_SELECTORS.resGroup,
        el => (el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 400)
      ).catch(() => null);
      if (html) this.log(`[Grok] [DUMP 해상도그룹] ${html}`);
    } catch (_) {}
  }

  /**
   * 칩바(입력창 아래 옵션 줄) 전체를 로그로 덤프 — **사이트 UI 가 또 바뀌었을 때의 1차 증거.**
   * 2026-08 개편에서 우리가 셀렉터를 다시 잡는 데 결정적이었던 정보(aria-label·role·텍스트)를
   * 그대로 남긴다. 다음에 "비디오 칩 못 찾음" 이 나면 이 줄만 보내면 바로 고칠 수 있다.
   */
  async _dumpChipBar() {
    try {
      const d = await this.page.evaluate(() => {
        const f = document.querySelector('form');
        if (!f) return { noForm: true, url: location.href };
        return {
          url: location.href,
          groups: [...f.querySelectorAll('[role="radiogroup"]')].map((r) => ({
            aria: r.getAttribute('aria-label'),
            opts: [...r.querySelectorAll('[role="radio"]')].map((b) => ({
              t: (b.innerText || '').trim() || b.getAttribute('aria-label') || '',
              on: b.getAttribute('aria-checked'),
            })),
          })),
          buttons: [...f.querySelectorAll('button')].map((b) => ({
            aria: b.getAttribute('aria-label'), type: b.getAttribute('type'),
            t: (b.innerText || '').trim().slice(0, 12), pressed: b.getAttribute('aria-pressed'),
          })),
          textboxes: [...f.querySelectorAll('[role="textbox"],textarea,[contenteditable="true"]')]
            .map((e) => ({ tag: e.tagName, aria: e.getAttribute('aria-label'), ph: e.placeholder || null })),
          files: f.querySelectorAll('input[type="file"]').length,
        };
      });
      this.log(`[Grok] [DUMP 칩바] ${JSON.stringify(d).slice(0, 1500)}`);
    } catch (e) {
      this.log(`[Grok] [DUMP 칩바] 실패: ${e.message}`);
    }
  }

  // ── 새 UI 공통 헬퍼 (2026-08-19 개편) ──────────────────────────────────────
  /**
   * 라디오그룹 안에서 **텍스트로** 칩을 고른다 (클래스·nth-child 에 의존하지 않는다).
   *   groupSel: GROK_SELECTORS.resGroup / durGroup
   *   text:     칩에 보이는 글자 ('480p' · '6s' …)
   * 반환 { ok, checked, options, reason } — options 는 그 그룹에 실제로 있는 칩들(진단·로그용).
   *   ⚠ 로그인 상태에 따라 칩 구성이 다르다(로그아웃: 480p/720p·6s / 로그인: +1080p·10s·15s).
   */
  async _pickRadio(groupSel, text) {
    try {
      const g = await this.page.$(groupSel);
      if (!g) return { ok: false, checked: false, options: [], reason: 'group-missing' };
      const options = await g.$$eval('[role="radio"]', (els) => els.map((e) => ({
        t: (e.innerText || '').trim() || e.getAttribute('aria-label') || '',
        on: e.getAttribute('aria-checked') === 'true',
        dis: !!e.disabled || e.getAttribute('aria-disabled') === 'true',
      })));
      const want = String(text).trim();
      if (options.find((o) => o.t === want && o.on)) return { ok: true, checked: true, options };  // 이미 선택됨
      const hit = await g.$(`[role="radio"]:has-text("${want}")`);
      if (!hit) return { ok: false, checked: false, options, reason: 'option-missing' };
      await hit.click({ timeout: 5000 }).catch(() => {});
      await this.page.waitForTimeout(350);
      const checked = await hit.evaluate((e) => e.getAttribute('aria-checked') === 'true').catch(() => false);
      return { ok: true, checked, options };
    } catch (e) {
      return { ok: false, checked: false, options: [], reason: e.message };
    }
  }

  /**
   * 🔑 **본편 영상 찾기** — 이번 개편에서 가장 중요한 함수.
   *
   * 새 UI 는 좌측 히스토리 스트립의 썸네일마다 **완성된 <video>** 를 깔아 둔다(50x50).
   * 그래서 "https src + readyState≥2 + duration>1" 만 보면 **그 계정의 예전 영상**을 집어
   * 엉뚱한 mp4 가 .vrew 에 실린다 — 2026-08-19 실측으로 실제 재현했다(화면은 '생성 중 13%'
   * 인데 10.04초짜리 다른 영상을 내려받았다). 조용히 틀리므로 실패보다 나쁘다.
   *
   * 판별식 3개 — 전부 만족해야 완성으로 본다:
   *   ① 페이지 URL `/imagine/post/<UUID>` 의 UUID 가 **video src 경로에 들어 있다**
   *      (실측: assets.grok.com/users/<uid>/generated/<postUUID>/generated_video.mp4?cache=1)
   *   ② `closest('button')` 이 없다 → 사이드바 썸네일 배제
   *   ③ readyState ≥ 2 이고 duration > 1
   * postId 를 못 읽으면(결과 페이지가 아니면) **아무것도 완성으로 보지 않는다**(fail-closed).
   */
  async _findMainVideo() {
    try {
      return await this.page.evaluate(() => {
        const m = (location.pathname || '').match(/\/imagine\/post\/([0-9a-fA-F-]{8,})/);
        const postId = m ? m[1] : '';
        const all = [...document.querySelectorAll('video')];
        // 진행률(생성 중 N%) — 있으면 아직 만드는 중이라는 신호(타임아웃 연장용)
        const pctEl = [...document.querySelectorAll('div,span,p')].find(
          (e) => e.children.length === 0 && /^\d{1,3}\s*%$/.test((e.textContent || '').trim()));
        const progress = pctEl ? pctEl.textContent.trim() : null;
        if (!postId) return { postId: '', total: all.length, video: null, progress };
        let best = null;
        for (const v of all) {
          const src = v.currentSrc || v.src || '';
          if (!/^https/i.test(src)) continue;
          if (v.closest('button')) continue;         // ② 사이드바 히스토리 썸네일
          if (src.indexOf(postId) < 0) continue;     // ① 이 post 의 영상이 아니다
          const r = v.getBoundingClientRect();
          const dur = isFinite(v.duration) ? v.duration : 0;
          const cand = {
            src, dur: Math.round(dur * 100) / 100, w: v.videoWidth, h: v.videoHeight,
            ready: v.readyState >= 2 && dur > 1,     // ③
            area: Math.round(r.width * r.height),
          };
          if (!best || cand.area > best.area) best = cand;
        }
        return { postId, total: all.length, video: best, progress };
      });
    } catch (_) {
      return { postId: '', total: 0, video: null, progress: null };
    }
  }

  async start(opts = {}) {
    // 페이지가 닫혔으면 컨텍스트도 폐기 후 재시작
    if (this.page && this.page.isClosed && this.page.isClosed()) {
      try { await this.context?.close(); } catch {}
      this.context = null;
      this.page = null;
    }
    if (this.context) return;

    // 첫 호출 시 profileDir 결정.
    // - profileId='default' (기본): 사용자 크롬 프로필 복사 시도 → 평소 크롬 로그인 세션 활용.
    // - 명시적 profileId: 격리 프로필 (기존 동작 유지).
    if (!this.profileDir) {
      if (this.profileId === 'default') {
        const userCopy = await _ensureUserChromeProfileCopy(this.log.bind(this)).catch(() => null);
        this.profileDir = userCopy || path.join(PROFILE_BASE, 'default');
      } else {
        this.profileDir = path.join(PROFILE_BASE, this.profileId);
      }
    }

    fs.mkdirSync(this.profileDir, { recursive: true });
    // 잠금 파일 제거 + 크래시 표시 정상화 (이전 비정상 종료 흔적)
    //   ⚠ 락만 지우면 부족하다 — Preferences.exit_type='Crashed' 가 남으면 복원 안내가 떠
    //     자동화 컨텍스트가 시작하자마자 닫힌다(2026-08-26 아내 PC 실사고: Grok 가 그렇게 죽었다).
    require('./core/chrome-profile').cleanProfile(this.profileDir);

    this.log('[Grok] 브라우저 시작 (Grok Imagine)...');
    const _grokLaunchOpts = {
      headless: false,
      viewport: null,                                // 시스템 화면 크기 그대로 (축소 방지)
      args: [
        '--start-maximized',                         // 전체 화면으로 시작
        '--disable-blink-features=AutomationControlled',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      acceptDownloads: true,
      permissions: ['clipboard-read', 'clipboard-write'],
    };
    // 시스템 정식 Chrome 우선 → Playwright 전용 Chromium 다운로드 불필요(새 PC 호환). 없으면 번들 Chromium 폴백.
    const _CP = require('./core/chrome-profile');
    this.context = null;
    try {
      this.context = await chromium.launchPersistentContext(this.profileDir, { ..._grokLaunchOpts, channel: 'chrome' });
    } catch (e1) {
      // ① 프로필을 다시 정리하고 정식 Chrome 을 한 번 더 — 「시작하자마자 닫힘」 은 대개 이걸로 낫는다.
      this.log('[Grok] ⚠ Chrome 실행 실패 — 프로필 정리 후 1회 재시도: ' + String(e1.message).slice(0, 90));
      _CP.cleanProfile(this.profileDir);
      await new Promise((r) => setTimeout(r, 1200));
      try {
        this.context = await chromium.launchPersistentContext(this.profileDir, { ..._grokLaunchOpts, channel: 'chrome' });
        this.log('[Grok] ✅ 재시도로 Chrome 실행 성공');
      } catch (e2) {
        // ② 그래도 안 되면 번들 Chromium 폴백. 그것도 없으면 **사람 말로** 알린다(영어 스택트레이스 금지).
        this.log('[Grok] ⚠ Chrome 재시도도 실패 — 번들 Chromium 폴백');
        try {
          this.context = await chromium.launchPersistentContext(this.profileDir, _grokLaunchOpts);
        } catch (e3) {
          throw new Error(_CP.explainLaunchError(e3, 'Grok'));
        }
      }
    }
    this.page = this.context.pages()[0] || await this.context.newPage();
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // waitUntil 'networkidle' → 'load' — grok.com SPA 는 백그라운드 API 호출이 끊이지 않아
    //   networkidle(0.5초 무통신)에 30초 안에 못 닿아 타임아웃나는 케이스가 잦음(특히 Flow 크롬이
    //   동시에 떠 있을 때). load 면 DOM 준비 즉시 진행. (아래 generateVideoFromImage 의 재진입과 동일 정책)
    await this.page.goto(GROK_URL, { waitUntil: 'load', timeout: 30000 });
    await this.page.waitForTimeout(3000);

    // 페이지 로드 직후 dialog 가 떠있으면 닫기 (광고/안내/Premium 확인 등)
    await this._dismissAnyDialog();

    // 로그인 상태 확인
    // 로그인 전용 모드(login())에서는 자동 감지를 건너뜀 — 셀렉터가 사이트 UI 변경에 취약해
    //   false positive/negative 로 창이 일찍 닫히는 문제 때문. 대신 main 이 '로그인 완료' 다이얼로그로 대기시킨다.
    const loginIndicator = opts.skipLoginWait ? null : await this.page.$(GROK_SELECTORS.loginIndicator);
    if (loginIndicator) {
      this.log('[Grok] 로그인이 필요합니다. 브라우저에서 X 계정으로 로그인하세요. (한 번 로그인하면 이후엔 자동)');
      // 로그인 표시가 사라질 때까지 최대 5분 폴링.
      //   ⚠ document.querySelector 는 :has-text() 미지원(Playwright 전용) → 페이지에서 직접 쓰면 SyntaxError 로
      //     즉시 throw → 예전엔 창이 바로 닫혔음. 그래서 Playwright page.$(셀렉터)로 메인 프로세스에서 폴링한다.
      //   X(x.com) 로그인 진행 중에는 grok.com 이 아니므로 판단을 미룬다(오인 방지).
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        await this.page.waitForTimeout(2000);
        let onSite = false;
        try { onSite = /grok\.com/i.test(this.page.url()); } catch { break; }
        if (!onSite) continue;
        const still = await this.page.$(GROK_SELECTORS.loginIndicator).catch(() => null);
        if (!still) break;
      }
      this.log('[Grok] 로그인 감지 — 진행합니다.');
    } else {
      this.log('[Grok] 이미 로그인되어 있습니다.');
    }
  }

  // 로그인 전용 — 브라우저를 열어 X 로그인(최대 5분 대기) 후 쿠키 저장하고 닫음. (멀티계정 로그인)
  async login(onConfirm) {
    await this.start({ skipLoginWait: true });   // 창만 열고(자동 감지 X) 사용자 로그인 대기
    // onConfirm: main 이 넘긴 '로그인 완료' 다이얼로그 대기. 사용자가 누를 때까지 창 유지.
    if (typeof onConfirm === 'function') { try { await onConfirm(); } catch {} }
    this.log('[Grok] 로그인 완료 — 쿠키 저장 후 창을 닫습니다.');
    await this.stop();
    return { ok: true };
  }

  async stop() {
    if (this.context) {
      try { await this.context.close(); } catch {}
      this.context = null;
      this.page = null;
    }
  }

  /**
   * 그록 로그인 페이지로 이동 — 사용자가 X 계정 로그인 미리 해두는 용도.
   * 자동화 크롬 시작 후 grok.com/login 페이지로 직행.
   * 이미 로그인돼 있으면 grok 이 자동으로 메인 페이지로 redirect.
   */
  async openLoginPage() {
    await this.start();   // 브라우저 시작 (start 가 grok.com/imagine 까지 이동)
    try {
      this.log('[Grok] 로그인 페이지로 이동');
      await this.page.goto('https://grok.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    } catch (e) {
      this.log(`[Grok] /login 이동 실패: ${e.message} — 메인 페이지에 머무름`);
    }
  }

  /**
   * 이미지 1장 → 비디오 1개 생성.
   * @param {object} args
   *   imagePath   : 입력 이미지 절대경로
   *   prompt      : 모션 프롬프트 (없으면 grok-store 의 defaultMotionPrompt 사용)
   *   outputPath  : 결과 mp4 저장 경로 (절대)
   *   abortSignal : () => boolean 형태. true 반환 시 중단
   * @returns { success, videoPath?, error? }
   */
  async generateVideoFromImage({ imagePath, prompt, outputPath, abortSignal }) {
    // 1. 일일 한도 체크
    const limit = GrokStore.checkDailyLimit();
    if (!limit.allowed) {
      return { success: false, error: limit.reason };
    }

    // 2. 입력 검증
    if (!imagePath || !fs.existsSync(imagePath)) {
      return { success: false, error: `입력 이미지 없음: ${imagePath}` };
    }
    if (!outputPath) return { success: false, error: 'outputPath 필수' };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const motion = (prompt && prompt.trim()) || limit.cfg.defaultMotionPrompt;

    try {
      // 3. 브라우저 시작 보장 (page 가 closed 면 start() 가 자동 재기동)
      //    start() 는 try 안에 둔다 — 진입(goto) 타임아웃 등 실패도 예외를 던지지 않고
      //    {success:false} 로 반환 → 상위(generateHookVideosGrok)가 'fail' 표시·재시도 가능.
      if (this.page && this.page.isClosed && this.page.isClosed()) {
        this.log('[Grok] 이전 세션이 닫혀있음 — 재시작');
        try { await this.context?.close(); } catch {}
        this.context = null;
        this.page = null;
      }
      await this.start();
      if (abortSignal && abortSignal()) return { success: false, error: '사용자 중단' };

      this.log(`[Grok] 비디오 생성 시작 — ${path.basename(imagePath)} · "${motion.substring(0, 40)}"`);

      // 4. /imagine 진입 (이전 결과 페이지 /imagine/post/... 에 있으면 메인으로 이동)
      if (!this.page.url().endsWith('/imagine') && !this.page.url().endsWith('/imagine/')) {
        // waitUntil 'networkidle' → 'load' — Grok SPA 의 background API 호출이 끊이지 않아
      // networkidle 가 timeout 되는 케이스 회피. load 면 DOM 준비됐을 때 즉시 진행.
      await this.page.goto(GROK_URL, { waitUntil: 'load', timeout: 30000 });
        await this.page.waitForTimeout(2000);
      }
      // 진입 후 떠있는 모든 dialog 닫기
      await this._dismissAnyDialog();
      if (abortSignal && abortSignal()) return { success: false, error: '사용자 중단' };

      // 5. "비디오" 모드 칩 클릭 — 이미지 → 비디오 변환의 핵심.
      //   2026-08 개편: 칩이 role="radio" 가 되어 **aria-label 로 잡고 aria-checked 로 검증**한다.
      //   (옛 검증법 "480p 칩이 등장하는지" 보다 직접적이고, 칩 구성이 바뀌어도 안 깨진다)
      const videoChip = await this.page.$(GROK_SELECTORS.videoModeChip);
      if (!videoChip) {
        await this._dumpChipBar();
        return { success: false, error: '"비디오" 칩 못 찾음 — 사이트 UI 가 또 바뀐 듯합니다 (로그의 [DUMP 칩바] 확인)' };
      }
      const _isVideoOn = async () => {
        try { return await videoChip.evaluate((e) => e.getAttribute('aria-checked') === 'true'); } catch { return false; }
      };
      if (!(await _isVideoOn())) {
        try {
          await videoChip.click({ timeout: 5000 });
        } catch (e) {
          this.log(`[Grok] 비디오 칩 일반 클릭 실패 — force 옵션 재시도: ${e.message}`);
          await this._dismissAnyDialog();
          await videoChip.click({ force: true, timeout: 5000 }).catch(() => {});
        }
        await this.page.waitForTimeout(1200);
      }
      if (await _isVideoOn()) {
        this.log('[Grok] "비디오" 모드 활성화 확인 (aria-checked)');
      } else {
        await this._dismissAnyDialog();
        await videoChip.click({ force: true }).catch(() => {});
        await this.page.waitForTimeout(1200);
        if (await _isVideoOn()) this.log('[Grok] "비디오" 모드 활성화 확인 (재시도 후)');
        else this.log('[Grok] ⚠️ "비디오" 모드 활성 검증 실패 — 그래도 진행');
      }

      // 5-2. 해상도 / 길이 / 🔊오디오 / 종횡비 적용
      //   쇼츠(9:16)면 6s + 9:16 강제, 롱폼은 16:9 + grok-store 설정값.
      const grokCfg = GrokStore.load();
      const _shorts = this._aspectRatio === '9:16';
      // 길이: UI 지정(this._videoDuration) 우선 → 없으면 쇼츠 6s / 롱폼 cfg. **15s 도 가능**(로그인 시 등장).
      const _wantDur = /^(6s|10s|15s)$/.test(String(this._videoDuration))
        ? String(this._videoDuration)
        : (!_shorts && /^(10s|15s)$/.test(String(grokCfg.videoDuration)) ? String(grokCfg.videoDuration) : '6s');
      const _wantRes = /^(480p|720p|1080p)$/.test(String(grokCfg.videoResolution)) ? String(grokCfg.videoResolution) : '480p';
      // ⚠ 비율 메뉴 라벨이 한국어("9:16 수직" · "16:9 와이드스크린")라 **숫자 문자열**로 매칭한다.
      //   "16:9" 와 "9:16" 은 서로의 부분문자열이 아니어서 substring 매칭이 안전하다.
      const _aspText = _shorts ? '9:16' : '16:9';
      let _actualRes = _wantRes;
      try {
        _actualRes = await this._selectResolutionChip(_wantRes);

        const dr = await this._pickRadio(GROK_SELECTORS.durGroup, _wantDur);
        if (!dr.ok || !dr.checked) {
          this.log(`[Grok] ⚠ 길이 ${_wantDur} 선택 실패(${dr.reason || '확인불가'}) — 있는 칩: ${(dr.options || []).map((o) => o.t).join('/') || '없음'}`);
        }

        // 🔊 영상 오디오 끄기 — 2026-08 신설 토글이고 **기본이 켜짐**이다.
        //   그냥 두면 Grok 이 만든 소리가 mp4 에 구워져 우리 TTS 와 겹친다.
        //   (끄면 실제로 오디오 트랙 없는 mp4 가 온다 — 2026-08-19 실측 확인)
        const audio = await this.page.$(GROK_SELECTORS.audioToggle);
        if (audio) {
          const on = await audio.getAttribute('aria-pressed').catch(() => null);
          if (on === 'true') {
            await audio.click({ timeout: 4000 }).catch(() => {});
            await this.page.waitForTimeout(400);
            const after = await audio.getAttribute('aria-pressed').catch(() => null);
            this.log(after === 'false'
              ? '[Grok] 🔇 영상 오디오 끔 (TTS 와 겹치지 않게)'
              : `[Grok] ⚠ 오디오 끄기 실패 (aria-pressed=${after}) — 소리가 들어간 mp4 가 올 수 있습니다`);
          } else {
            this.log(`[Grok] 🔇 영상 오디오 이미 꺼짐 (aria-pressed=${on})`);
          }
        } else {
          this.log('[Grok] ⚠ 영상 오디오 토글 없음 — mp4 에 소리가 들어갔는지 확인 필요');
        }

        // 종횡비 — 트리거(aria-label="종횡비") 클릭 → 메뉴에서 **텍스트**로 고른다.
        //   ⚠ 메뉴 첫 항목에 「Auto」가 새로 생겨 6개가 됐다 → 옛 nth-child(4)/(5) 는 한 칸씩 밀려
        //     9:16 을 요청하면 1:1 이, 16:9 를 요청하면 9:16 이 선택됐다(조용한 오작동).
        const aspectTrigger = await this.page.$(GROK_SELECTORS.aspectChipTrigger);
        if (aspectTrigger) {
          const cur = ((await aspectTrigger.innerText().catch(() => '')) || '').trim();
          if (cur.indexOf(_aspText) >= 0) {
            this.log(`[Grok] 비율 이미 ${_aspText}`);
          } else {
            await aspectTrigger.click({ timeout: 5000 }).catch(() => {});
            await this.page.waitForTimeout(600);
            const item = await this.page.$(`${GROK_SELECTORS.aspectMenuItem}:has-text("${_aspText}")`);
            if (item) {
              await item.click({ timeout: 5000 }).catch(() => {});
              await this.page.waitForTimeout(400);
              const now = ((await aspectTrigger.innerText().catch(() => '')) || '').trim();
              this.log(now.indexOf(_aspText) >= 0
                ? `[Grok] 비율 선택: ${_aspText}`
                : `[Grok] ⚠ 비율을 클릭했지만 표시값이 "${now}" — 확인 필요`);
            } else {
              const items = await this.page.$$eval(GROK_SELECTORS.aspectMenuItem,
                (els) => els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())).catch(() => []);
              this.log(`[Grok] ⚠️ 비율 "${_aspText}" 항목 못 찾음 — 메뉴: ${items.join(' | ') || '없음'} (현재 비율 유지)`);
              await this.page.keyboard.press('Escape').catch(() => {});
            }
          }
        } else {
          this.log('[Grok] ⚠️ 종횡비 트리거 못 찾음 — 현재 비율 유지');
        }
        this.log(`[Grok] 옵션: ${_actualRes} · ${_wantDur} · ${_aspText}${_shorts ? ' (쇼츠)' : ''}`);
      } catch (e) {
        this.log(`[Grok] 비디오 옵션 적용 중 예외 (무시): ${e.message}`);
      }

      // 6. 이미지 업로드 — hidden input[type=file]
      await this._dismissAnyDialog();
      const fileInput = await this.page.$(GROK_SELECTORS.fileInput);
      if (!fileInput) {
        return { success: false, error: `이미지 업로드 input 못 찾음 (selector: ${GROK_SELECTORS.fileInput})` };
      }
      await fileInput.setInputFiles(imagePath);
      await this.page.waitForTimeout(1500);
      this.log(`[Grok] 이미지 업로드: ${path.basename(imagePath)}`);
      if (abortSignal && abortSignal()) return { success: false, error: '사용자 중단' };

      // 6-b. ⚠️ 해상도 한도 재확인 — 이 위치가 핵심.
      //   해상도 선택(5-2)은 이미지 첨부 *전*이라 빨간 계기판이 아직 안 떠서 한도를 못 본다.
      //   계기판은 이미지 첨부 후에만 등장한다(실측 2026-06-07). 그래서 첨부 직후 한 번 더 본다.
      if (_wantRes !== '480p') {
        const lim2 = await this._check720pLimit();
        if (lim2.limited) {
          this.log(`[Grok] ⚠️ (이미지 첨부 후) ${_wantRes} 한도 감지 — 480p 로 선제 전환 (영상은 계속 생성) | ${lim2.label}`);
          const r = await this._pickRadio(GROK_SELECTORS.resGroup, '480p');
          this.log(r.ok && r.checked
            ? '[Grok] 480p 전환 완료 — 480p 로 진행'
            : `[Grok] ⚠️ 480p 전환 실패(${r.reason || '확인불가'}) — 그대로 진행 (생성 중 자동 강등 안전망에 의존)`);
        }
      }

      // 7. 모션 프롬프트 입력 — 일관된 타이핑 페이스.
      //    배경: Playwright keyboard.type 의 { delay } 옵션은 OS 스케줄링 의존이라
      //    자동제작 중(이미지/TTS 동시 진행으로 main thread 부하 ↑) vs 단독 호출 시
      //    실제 페이스가 흐트러져 사용자가 다른 속도로 느낌. 명시적 waitForTimeout 으로
      //    분리해서 부하와 무관한 일정 페이스 보장 (자동제작·선택그룹·범위 모두 동일).
      // 사용자 선택 고정 타이핑 속도 — 길이와 무관하게 글자당 동일 ms (일관성). grok-store.typingSpeed.
      //   'instant'=0(가장 빠름·setter 일괄) / 'fast'=4 / 'normal'=12 / 'slow'=28 ms/char
      const _SPEED_MS = { instant: 0, fast: 4, normal: 12, slow: 28 };
      const TYPING_INTERVAL_MS = _SPEED_MS[grokCfg.typingSpeed] != null ? _SPEED_MS[grokCfg.typingSpeed] : 12;
      const _len = motion.length;
      const promptEl = await this.page.$(GROK_SELECTORS.promptInput);
      if (promptEl) {
        await promptEl.click();
        if (TYPING_INTERVAL_MS === 0) {
          // instant — 한 번에 입력 (글자단위 sleep 없음). 가장 빠름.
          await this.page.keyboard.insertText(motion);
        } else {
          // 글자 단위 타이핑 + 고정 sleep (길이 무관 동일 페이스)
          for (const ch of motion) {
            await this.page.keyboard.type(ch);
            await this.page.waitForTimeout(TYPING_INTERVAL_MS);
          }
        }
        await this.page.waitForTimeout(500);
        this.log(`[Grok] 모션 프롬프트 입력: "${motion.substring(0, 60)}..." (${_len}자, 속도 ${grokCfg.typingSpeed}/${TYPING_INTERVAL_MS}ms)`);
      } else {
        this.log('[Grok] ⚠️ 프롬프트 입력 영역 못 찾음 — 빈 프롬프트로 진행');
      }
      if (abortSignal && abortSignal()) return { success: false, error: '사용자 중단' };

      // 8. Submit — submit 버튼 우선 + Enter 키 백업 (둘 다 시도해서 robust ↑)
      // 9. URL 이 /imagine/post/<UUID> 로 변경되는 것 감지 (timeout 30→90 초)
      //
      // 이전 30초 timeout 으로 인한 실패가 잦았음:
      //   - Grok 서버 부하 시 submit 응답이 30초 넘김
      //   - submit 버튼 클릭만으로 form 트리거 안 되는 케이스 발견
      //
      // 강화: 첫 시도 실패 시 한 번 더 (페이지 새로고침 + 재시도) — Grok UI 잔여 상태 해소.
      const _trySubmitAndWait = async () => {
        await this._dismissAnyDialog();
        const submitBtn = await this.page.$(GROK_SELECTORS.submitButton);
        if (submitBtn) {
          try { await submitBtn.click(); } catch (_) {}
        }
        // 버튼 클릭 후에도 안 됐을 케이스 대비해서 Enter 도 발사 (이미 페이지 전환된 경우엔 무시됨)
        try { await this.page.keyboard.press('Enter'); } catch (_) {}
        this.log('[Grok] 생성 요청 전송 — 결과 페이지로 이동 대기 (최대 90초)');
        // 제출 직후 짧은 간격 폴링 — 결과 URL 이동 vs 한도 토스트(요청/480p 한도)를 동시에 감시.
        //   한도 토스트는 몇 초 뒤 사라지므로, 90초 끝에 한 번 검사하면 놓친다 → 1.5초마다 즉시 잡는다.
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
          if (/\/imagine\/post\//.test(this.page.url())) return; // 결과 페이지 진입 = 성공
          const rl = await this._checkRequestLimit();
          if (rl.limited) { const e = new Error('한도 도달'); e._limit = rl; throw e; }
          await this.page.waitForTimeout(1500);
        }
        throw new Error('결과 페이지 이동 타임아웃(90초)');
      };
      // 한도 예외 → limitReached 결과로 변환 (상위가 작업 중단 + 안내 팝업)
      const _asLimit = (rl) => { this.log(`[Grok] ⛔ 한도 도달 감지 — 중단${rl.reset ? ` (${rl.reset})` : ''}`); return { success: false, limitReached: true, reset: rl.reset, error: `Grok 한도 도달${rl.reset ? ` (${rl.reset})` : ''}` }; };

      try {
        await _trySubmitAndWait();
        this.log(`[Grok] 결과 페이지 진입: ${this.page.url()}`);
      } catch (e) {
        // 한도(요청/480p) 감지면 재시도해도 소용없음 — 즉시 중단 반환
        if (e._limit) return _asLimit(e._limit);
        const rl0 = await this._checkRequestLimit();
        if (rl0.limited) return _asLimit(rl0);
        // 1차 실패 — 페이지 새로고침 + 1회 재시도
        this.log(`[Grok] 1차 submit 실패 (${e.message}) — 페이지 새로고침 후 1회 재시도`);
        try {
          await this.page.reload({ waitUntil: 'load', timeout: 30000 });
          await this.page.waitForTimeout(2000);
          // 이 시점 URL 이 결과 페이지(/imagine/post/...) 면 사실은 submit 이 됐는데
          // waitForURL 만 못 잡은 케이스 — 그대로 진행
          if (/\/imagine\/post\//.test(this.page.url())) {
            this.log(`[Grok] reload 후 이미 결과 페이지에 있음: ${this.page.url()}`);
          } else {
            await _trySubmitAndWait();
            this.log(`[Grok] 결과 페이지 진입(재시도): ${this.page.url()}`);
          }
        } catch (e2) {
          if (e2._limit) return _asLimit(e2._limit);
          const rl = await this._checkRequestLimit();
          if (rl.limited) return _asLimit(rl);
          return { success: false, error: `결과 페이지로 이동 안 됨 (재시도 후 실패: ${e2.message})` };
        }
      }

      // 10. 비디오 생성 완료 대기 (폴링) — 2026-08-19 전면 재작성.
      //
      // 🔴 옛 방식의 치명적 문제: "https src + readyState≥2 + duration>1 이 2회 연속 안정" 이면
      //    완성으로 봤다. 새 UI 는 **좌측 히스토리 썸네일마다 완성된 <video> 를 깔아 두므로**
      //    이 규칙이 **그 계정의 예전 영상**을 집는다(실측 재현: 화면은 '생성 중 13%' 인데
      //    10.04초짜리 다른 영상을 내려받았다). 조용히 틀린 mp4 가 .vrew 에 실리므로
      //    타임아웃 실패보다 나쁘다.
      // ✅ 새 방식: `_findMainVideo()` 가 **post UUID 일치 + 버튼 밖 + ready** 3조건을 모두 본다.
      //    post UUID 를 못 읽으면 아무것도 완성으로 보지 않는다(fail-closed).
      const POLL_INTERVAL = 4000;
      const TIMEOUT_MS = 8 * 60 * 1000;        // 진행률이 안 보일 때의 기본 상한
      const HARD_TIMEOUT_MS = 15 * 60 * 1000;  // 진행률 연장을 포함한 절대 상한
      const startedAt = Date.now();
      let _downgradeDetected = false;   // grok.com 이 스스로 480p 로 낮춘 경우
      let _lastPct = '';
      let _progressSeenAt = 0;
      let _offPostLogged = false;

      const _saveFromUrl = async (url, how) => {
        const res = await this.page.context().request.get(url);
        const buf = await res.body();
        // 안전장치: 정상 mp4 는 수백 KB 이상. 너무 작으면 에러 페이지/플레이스홀더로 본다.
        if (!buf || buf.length < 20000) throw new Error(`받은 파일이 너무 작다(${buf ? buf.length : 0} bytes)`);
        fs.writeFileSync(outputPath, buf);
        GrokStore.markUsed();
        this.log(`[Grok] ✅ 비디오 저장 완료 (${how}): ${outputPath} (${Math.round(buf.length / 1024)}KB)`);
        return { success: true, videoPath: outputPath, downgradedTo: _downgradeDetected ? '480p' : null };
      };

      while ((Date.now() - startedAt < TIMEOUT_MS || (Date.now() - _progressSeenAt) < 90 * 1000)
             && (Date.now() - startedAt < HARD_TIMEOUT_MS)) {
        if (abortSignal && abortSignal()) return { success: false, error: '사용자 중단' };
        await this.page.waitForTimeout(POLL_INTERVAL);

        // 720p → 480p 자동 강등 토스트 감지 (감지만 하면 된다 — grok.com 이 이미 480p 로 만들고 있다)
        if (!_downgradeDetected) {
          try {
            const toasts = await this.page.$$eval('[role="alert"], [role="status"], [data-sonner-toast]',
              (els) => els.map((e) => (e.textContent || '').trim()).filter((t) => t.length > 0));
            const hit = toasts.find((t) => /720p.*rate.*limit.*480p|switched\s+to\s+480p/i.test(t));
            if (hit) {
              _downgradeDetected = true;
              this.log(`[Grok] ⚠️ 720p 한도 도달 — grok.com 이 480p 로 자동 강등 ("${hit.slice(0, 80)}")`);
            }
          } catch (_) { /* 토스트 없으면 무시 */ }
        }

        const st = await this._findMainVideo();
        if (st.progress) {
          _progressSeenAt = Date.now();
          if (st.progress !== _lastPct) { _lastPct = st.progress; this.log(`[Grok] 생성 진행 ${st.progress}`); }
        }
        if (!st.postId) {
          // 결과 페이지를 벗어났다 — 여기서 어떤 <video> 도 믿을 수 없다(사이드바 썸네일뿐).
          if (!_offPostLogged) {
            _offPostLogged = true;
            this.log(`[Grok] ⚠ 결과 페이지(/imagine/post/…)가 아닙니다 — 현재 ${this.page.url()}`);
          }
          continue;
        }
        if (st.video && st.video.ready) {
          this.log(`[Grok] ✅ 본편 완성 감지 — ${st.video.dur}초 · ${st.video.w}x${st.video.h}`
            + ` (post ${String(st.postId).slice(0, 8)}… · 페이지 video ${st.total}개 중 본편만 채택)`);
          try {
            return await _saveFromUrl(st.video.src, 'URL 직접');
          } catch (eDirect) {
            this.log(`[Grok] URL 직접 다운로드 실패 (${eDirect.message}) — 다운로드 버튼으로 폴백`);
            const dlBtn = await this.page.$(GROK_SELECTORS.downloadButton);
            if (dlBtn) {
              try {
                const [download] = await Promise.all([
                  this.page.waitForEvent('download', { timeout: 90000 }),
                  dlBtn.click({ timeout: 5000 }),
                ]);
                await download.saveAs(outputPath);
                GrokStore.markUsed();
                this.log(`[Grok] ✅ 비디오 저장 완료 (다운로드 버튼): ${outputPath}`);
                return { success: true, videoPath: outputPath, downgradedTo: _downgradeDetected ? '480p' : null };
              } catch (eBtn) {
                this.log(`[Grok] 다운로드 버튼도 실패: ${eBtn.message} — 다음 폴링에서 재시도`);
              }
            } else {
              this.log('[Grok] 다운로드 버튼 못 찾음 — 다음 폴링에서 재시도');
            }
          }
        }

        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        this.log(`[Grok] 생성 대기 중... (${elapsed}초${_lastPct ? ` · ${_lastPct}` : ''})`);
      }

      return { success: false, error: `대기 시간 초과 — 비디오 미완성${_lastPct ? ` (마지막 진행률 ${_lastPct})` : ''} (timeout)` };
    } catch (e) {
      return { success: false, error: `Grok 자동화 예외: ${e.message}` };
    }
  }
}

module.exports = { GrokEngine, GROK_SELECTORS, PROFILE_BASE, _ensureUserChromeProfileCopy };
