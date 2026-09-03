/**
 * Genspark AI 이미지 생성 엔진 (genspark.ai/ai_image · Nano Banana 2)
 *
 * 흐름:
 *   1. Playwright 로 genspark.ai/ai_image 진입 (사용자 크롬 프로필 복사 → 로그인 상속)
 *   2. 로그인 상태 확인 — 안 되어 있으면 사용자에게 수동 로그인 요청
 *   3. 세션 1회 셋업: Nano Banana 2 확인 → 설정에서 2K + 16:9 → 자동 프롬프트 OFF
 *   4. 그룹별: 프롬프트 입력 → 전송 → 새 이미지 등장 폴링 → src fetch → 저장
 *
 * 설계:
 *   - grok-engine.js 와 같은 인프라 (chromium.launchPersistentContext, 프로필 복사, 로그인 폴링)
 *   - Genspark 은 채팅 스레드형 — 같은 스레드에서 프롬프트만 순차 제출 (셋업 1회)
 *   - 결과 이미지는 인증된 직접 URL (https://www.genspark.ai/api/files/s/{id}) →
 *     page.context().request.get(src) 로 바이트 fetch (Grok 의 video src fallback 과 동일 패턴)
 *
 * ⚠️ Genspark 은 React SPA 라 칩/옵션이 모두 div (표준 button 아님). 셀렉터는 클래스+텍스트
 *    매칭 기반이며 사이트 UI 변경 시 GENSPARK_SELECTORS 한 곳만 수정하면 됨. (라이브 캡처 2026-06-01)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const GensparkStore = require('./tts/genspark-store');

// 사용자 데이터 디렉토리 (Flow/Grok 프로필과 분리)
const PROFILE_BASE = path.join(os.homedir(), '.flow-app', 'genspark-profiles');
const GENSPARK_URL = 'https://www.genspark.ai/ai_image';

// genspark.ai/ai_image 의 이미지 생성 흐름 selector (라이브 DOM 캡처 2026-06-01 기반).
const GENSPARK_SELECTORS = {
  // 모델 칩 — 텍스트 "Nano Banana 2" (기본 선택). model-button 은 설정/스타일 칩도 공유하므로 텍스트로 식별.
  modelButton:      'div.model-button',
  // 설정 칩 — 클릭하면 이미지 크기 / 종횡비 팝오버 열림
  settingButton:    'div.setting-button',
  // 이미지 크기 옵션 — 자식 span 텍스트 "자동"/"0.5K"/"1K"/"2K"/"4K", 선택됨 = .size-option.selected
  sizeOption:       'div.size-options div.size-option',
  sizeSelected:     'div.size-option.selected',
  // 종횡비 옵션 — 자식 div.ratio-label 텍스트 "16:9" 등, 선택됨 = .ratio-option.selected
  ratioOption:      'div.ratio-grid div.ratio-option',
  ratioSelected:    'div.ratio-option.selected',
  // 자동 프롬프트 토글 — class 에 'active' 있으면 ON. 클릭해서 OFF.
  autoPromptToggle: 'div.reflection-toggle.tooltip-wrapper',
  // 프롬프트 입력란 (React 제어 textarea)
  promptInput:      'textarea.search-input.j-search-input, textarea.search-input',
  // ★ 전송 버튼 — 텍스트가 있으면 .input-icon 안에 .enter-icon(검은 ↵ 원형)이 나타남.
  //   ⚠️ right-icon-group 의 다른 cursor-pointer 는 '마이크'(음성입력 → speakly.ai 로 이동) 라 절대 누르면 안 됨.
  //   반드시 .enter-icon / .input-icon 만 타겟. (라이브 검증 2026-06-01)
  sendButton:       'div.right-icon-group div.enter-icon, div.right-icon-group div.input-icon',
  // 생성 결과 이미지 — 인증된 직접 URL (context.request.get 으로 fetch 가능)
  resultImg:        'img[src*="/api/files/s/"]',
  // 로그인 안 됨 감지
  loginIndicator:   'a[href*="login" i], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("로그인")',
};

// ── 🎬 Genspark AI 비디오 (agents?type=video_generation_agent) ──────────────────
//   로이 요청(2026-09-03): "비디오 생성기능에서 젠스파크를 추가해줘. 이미지 생성과 같은 개념".
//   🔑 **셀렉터가 이미지 페이지와 거의 같다**(라이브 실측 2026-09-03) — 그래서 이 파일에 함께 둔다.
//     프로필·로그인·다이얼로그 처리·한도 감지(_detectLimitMessage)를 그대로 재사용해야 하고,
//     따로 떼면 그 네 가지가 두 벌이 되어 반드시 어긋난다.
const GENSPARK_VIDEO_URL = 'https://www.genspark.ai/agents?type=video_generation_agent';
const GENSPARK_VIDEO_SELECTORS = {
  // 모델 칩 — 기본 "Gemini Omni Flash"(로이 지정). 이미지 페이지와 같은 model-button.
  modelButton:      'div.model-button',
  // 설정 칩 — 클릭하면 종횡비 / 재생 시간 / 생성 횟수 팝오버가 열린다.
  //   ⚠ 실측 class = "model-button aspect-ratio-selector setting-button"
  settingButton:    'div.setting-button',
  // 종횡비 — Auto / 9:16 / 16:9. **이미지 페이지와 완전히 같은 구조**(선택됨 = .selected)
  ratioOption:      'div.ratio-grid div.ratio-option',
  ratioSelected:    'div.ratio-option.selected',
  // 재생 시간 — 슬라이더 + **숫자 입력**(3~10초). 숫자 입력이 있어 값 지정이 쉽다.
  durationInput:    'input.duration-input',
  durationSlider:   'input.duration-slider',
  // 생성 횟수 — 1 / 2. 이미지의 '크기'와 같은 div.size-options 를 재사용한다(팝오버 안).
  countOption:      'div.settings-section div.size-options > *',
  // 자동 프롬프트 토글 — 이미지와 동일(.active 면 ON → 우리 프롬프트를 그대로 쓰려면 끈다)
  autoPromptToggle: 'div.reflection-toggle.tooltip-wrapper',
  // 프롬프트 입력 / 전송 — 이미지와 동일
  promptInput:      'textarea.search-input.j-search-input, textarea.search-input',
  sendButton:       'div.right-icon-group div.enter-icon, div.right-icon-group div.input-icon',
  // 이미지 첨부(i2v) — `+` → 「로컬 파일 찾기」 → **filechooser** 로 setFiles
  //   ⚠ 「에셋」 패널은 **동영상** 업로드용이다(실측: "클릭하거나 드래그하여 동영상 업로드") — 우리 용도가 아니다.
  addEntryBtn:      'div.add-entry-btn',
  localFileItem:    'text=로컬 파일 찾기',
  // 첨부된 썸네일 — 붙으면 프롬프트 바에 data:image 썸네일이 생긴다
  attachedThumb:    'img[src^="data:image"], img[src^="blob:"]',
  // 결과 영상 — ⏳ 실물 생성으로 확정 전. 여러 후보를 넓게 시도한다(못 찾으면 덤프 로그).
  resultVideo:      'video[src], video source[src]',
};
/**
 * 길이 범위 폴백(실측: Gemini Omni Flash 는 input.duration-input min=3 max=10).
 * 🔴 **모델마다 다르다** — Seedance 2.5 는 4~30초, Wan 3.0 은 2~30초, Veo 3.1 은 4/6/8초뿐이다.
 *   그래서 엔진은 **페이지의 min/max 를 읽어** 그 범위로 맞춘다. 이 상수는 못 읽을 때의 폴백이다.
 */
const GS_VIDEO_MIN_SEC = 3;
const GS_VIDEO_MAX_SEC = 10;

/**
 * Genspark 비디오 모델 목록(라이브 실측 2026-09-03 · 23개 중 우리 용도에 맞는 것).
 *   ⛔ 제외한 3개: `Fal Lipsync V3`(립싱크) · `ByteDance Video Upscaler`(업스케일러) ·
 *      `Kling V3 Motion Control`(참조 **비디오**가 필요) — 우리 파이프라인(그룹 이미지 → 영상)과 무관.
 *   🔑 `res`(해상도)·`sec`(길이)는 로이가 고를 때 판단 근거로 UI 에 그대로 보여 준다.
 *      **720p 모델은 업스케일이 붙는다**(우리 목표는 1920x1080).
 */
const GENSPARK_VIDEO_MODELS = [
  { name: '모델 자동 선택',        note: '작업에 맞는 모델을 Genspark 이 고름' },
  { name: 'Seedance 2.5',          note: '4~30초 · 1080p · 이미지 30장' },
  { name: 'Seedance v2',           note: '4~15초 · 1080p · 이미지 9장' },
  { name: 'MiniMax H3',            note: '2K · 이미지 9장' },
  { name: 'MiniMax H3 Max',        note: '2K · 더 빠름 · 이미지 9장' },
  { name: 'Wan 3.0',               note: '2~30초 · 1080p · 이미지 10장' },
  { name: 'Gemini Omni Flash',     note: '3~10초 · 720p(업스케일 필요)' },
  { name: 'Grok Imagine Video',    note: '1~15초 · 1080p · 이미지 7장' },
  { name: 'FLUX 3 Video',          note: '5~20초 · 1080p · 이미지 10장' },
  { name: 'PixVerse C1',           note: '1~15초 · 1080p · 이미지 7장' },
  { name: 'Kling V3',              note: '3~15초 · 720p · 첫/마지막 프레임' },
  { name: 'Happy Horse',           note: '3~15초 · 720p/1080p · 이미지 9장' },
  { name: 'Gemini Veo 3.1',        note: '4·6·8초 · 최대 4K · 이미지 3장' },
  { name: 'Gemini Veo 3',          note: '4·6·8초 · 720p' },
  { name: 'Kling O3',              note: '3~15초 · 720p · 이미지 1~4장 필요' },
  { name: 'PixVerse V6',           note: '5·8초 · 720p/1080p' },
  { name: 'Seedance Pro Fast',     note: '5·10초 · 1080p · 빠르고 저렴' },
  { name: 'Wan V2.7',              note: '5초 · 480p/720p' },
  { name: 'Vidu Q3',               note: '1~16초 · 1080p · 이미지 1~4장' },
  { name: 'Runway',                note: '5·10초 · 720p · 이미지 필요' },
];
/** 품질 등급(실측): Standard / Ultra */
const GENSPARK_VIDEO_TIERS = ['Standard', 'Ultra'];

/**
 * (은퇴) 사용자의 기본 크롬 프로필을 genspark-profiles/userchrome/ 로 복사하려던 함수.
 *
 * 🔴 2026-08-19 확인 — **이 기능은 한 번도 작동한 적이 없다.** (grok-engine.js 의 같은 함수와 동일 버그)
 *    완료 판정을 `userchrome/Default/Cookies` 존재로 했는데, 요즘 크롬은 쿠키를
 *    **`Default/Network/Cookies`** 에 둔다 → 그 파일은 생길 수가 없다. 그래서 매 실행마다
 *    10~30초짜리 복사를 헛돌린 뒤 "Cookies 복사 실패" 를 찍고 격리 프로필로 폴백해 왔다.
 *
 * 🔑 그럼 경로만 고치면 되지 않나? **고치면 오히려 깨진다.** 지금 실제로 로그인돼 있는 건
 *    격리 프로필(`~/.flow-app/genspark-profiles/<id>`) 이고, 복사가 성공하면 그 순간부터 앱이
 *    `userchrome`(= 평소 크롬 Default 프로필의 사본) 을 쓰게 된다. 이 PC 의 크롬은 프로필이
 *    24개이고 Genspark 로그인은 Default 에 없다 → **잘 되던 로그인이 사라진다.**
 *    게다가 "계정 = 프로필" 인 현재 설계(⚙ Genspark 멀티계정의 🔑 로그인 버튼)와도 어긋난다.
 *
 * 그래서 **의도적으로 no-op** 으로 남긴다(항상 null → 격리 프로필 사용 = 지금까지의 실제 동작).
 * 다른 계정으로 쓰려면 ⚙ Genspark 멀티계정에서 계정을 추가하고 🔑 로그인을 한 번 하면 된다.
 */
async function _ensureUserChromeProfileCopy(_log) {
  return null;
}

/** 이미지 버퍼에서 width/height 추출 (PNG IHDR / JPEG SOF). 실패 시 null. */
function _readImageSize(b) {
  try {
    // PNG: 89 50 4E 47 ... IHDR width@16 height@20 (BE)
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    // JPEG: FF D8 ... SOFn(FFC0..FFCF except C4/C8/CC) → [len2][prec1][h2][w2]
    if (b[0] === 0xFF && b[1] === 0xD8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xFF) { i++; continue; }
        const m = b[i + 1];
        const isSOF = (m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC;
        if (isSOF) {
          return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
        }
        const len = (b[i + 2] << 8) | b[i + 3];
        if (len <= 0) break;
        i += 2 + len;
      }
    }
  } catch (_) {}
  return null;
}

class GensparkEngine {
  constructor(opts = {}) {
    this.profileId = opts.profileId || 'default';
    this.profileDir = null;
    this.logger = typeof opts.logger === 'function' ? opts.logger : () => {};
    this.context = null;
    this.page = null;
    this._setupDone = false;   // 세션 1회 셋업 (2K/16:9/자동프롬프트OFF) 완료 플래그
  }

  log(msg) { this.logger(msg); }

  /** 떠있는 모달/다이얼로그가 클릭을 가로채면 ESC 로 닫기 (제네릭) */
  async _dismissAnyDialog() {
    try {
      const sel = '[role="dialog"][data-state="open"], [data-state="open"][role="dialog"], .modal.show, [aria-modal="true"]';
      let dialog = await this.page.$(sel);
      let attempts = 0;
      while (dialog && attempts < 3) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(400);
        dialog = await this.page.$(sel);
        attempts++;
      }
      if (attempts > 0) this.log(`[Genspark] dialog 닫음 (ESC ${attempts}회)`);
    } catch {}
  }

  async start(opts = {}) {
    // 페이지가 닫혔으면 컨텍스트도 폐기 후 재시작
    if (this.page && this.page.isClosed && this.page.isClosed()) {
      try { await this.context?.close(); } catch {}
      this.context = null;
      this.page = null;
      this._setupDone = false;
    }
    if (this.context) return;

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
    //     자동화 컨텍스트가 시작하자마자 닫힌다(2026-08-26 아내 PC 실사고).
    require('./core/chrome-profile').cleanProfile(this.profileDir);

    this.log('[Genspark] 브라우저 시작 (Genspark AI 이미지)...');
    const _gsLaunchOpts = {
      headless: false,
      viewport: null,
      args: [
        '--start-maximized',
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
      this.context = await chromium.launchPersistentContext(this.profileDir, { ..._gsLaunchOpts, channel: 'chrome' });
    } catch (e1) {
      // ① 프로필을 다시 정리하고 정식 Chrome 을 한 번 더 — 「시작하자마자 닫힘」 은 대개 이걸로 낫는다.
      this.log('[Genspark] ⚠ Chrome 실행 실패 — 프로필 정리 후 1회 재시도: ' + String(e1.message).slice(0, 90));
      _CP.cleanProfile(this.profileDir);
      await new Promise((r) => setTimeout(r, 1200));
      try {
        this.context = await chromium.launchPersistentContext(this.profileDir, { ..._gsLaunchOpts, channel: 'chrome' });
        this.log('[Genspark] ✅ 재시도로 Chrome 실행 성공');
      } catch (e2) {
        // ② 그래도 안 되면 번들 Chromium 폴백. 그것도 없으면 **사람 말로** 알린다(영어 스택트레이스 금지).
        this.log('[Genspark] ⚠ Chrome 재시도도 실패 — 번들 Chromium 폴백');
        try {
          this.context = await chromium.launchPersistentContext(this.profileDir, _gsLaunchOpts);
        } catch (e3) {
          throw new Error(_CP.explainLaunchError(e3, 'Genspark'));
        }
      }
    }
    this.page = this.context.pages()[0] || await this.context.newPage();
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // 🔑 비디오 경로는 같은 프로필·같은 브라우저에서 **다른 URL** 을 쓴다(opts.url).
    await this.page.goto(opts.url || GENSPARK_URL, { waitUntil: 'load', timeout: 30000 });
    await this.page.waitForTimeout(3000);
    await this._dismissAnyDialog();

    // 로그인 상태 확인
    // 로그인 전용 모드(login())에서는 자동 감지를 건너뜀 — 셀렉터가 사이트 UI 변경에 취약해
    //   false positive/negative 로 창이 일찍 닫히는 문제 때문. 대신 main 이 '로그인 완료' 다이얼로그로 대기시킨다.
    const loginIndicator = opts.skipLoginWait ? null : await this.page.$(GENSPARK_SELECTORS.loginIndicator);
    if (loginIndicator) {
      this.log('[Genspark] 로그인이 필요합니다. 브라우저에서 Genspark 계정으로 로그인하세요. (한 번 로그인하면 이후엔 자동)');
      // 로그인 표시가 사라질 때까지 최대 5분 폴링.
      //   ⚠ document.querySelector 는 :has-text() 미지원(Playwright 전용) → 페이지에서 직접 쓰면 SyntaxError 로
      //     즉시 throw → 예전엔 창이 바로 닫혔음. 그래서 Playwright page.$(셀렉터)로 메인 프로세스에서 폴링한다.
      //   OAuth(구글 등) 진행 중에는 genspark.ai 가 아니므로 판단을 미룬다(다른 도메인에서 표시가 없다고 로그인 완료로 오인 방지).
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        await this.page.waitForTimeout(2000);
        let onSite = false;
        try { onSite = /genspark\.ai/i.test(this.page.url()); } catch { break; }
        if (!onSite) continue;
        const still = await this.page.$(GENSPARK_SELECTORS.loginIndicator).catch(() => null);
        if (!still) break;
      }
      this.log('[Genspark] 로그인 감지 — 진행합니다.');
    } else {
      this.log('[Genspark] 이미 로그인되어 있습니다.');
    }
  }

  // 로그인 전용 — 브라우저를 열어 로그인(최대 5분 대기) 후 쿠키 저장하고 닫음. (멀티계정 로그인)
  async login(onConfirm) {
    await this.start({ skipLoginWait: true });   // 창만 열고(자동 감지 X) 사용자 로그인 대기
    // onConfirm: main 이 넘긴 '로그인 완료' 다이얼로그 대기. 사용자가 누를 때까지 창 유지.
    if (typeof onConfirm === 'function') { try { await onConfirm(); } catch {} }
    this.log('[Genspark] 로그인 완료 — 쿠키 저장 후 창을 닫습니다.');
    await this.stop();    // persistent context close → 쿠키 디스크 저장
    return { ok: true };
  }

  async stop() {
    if (this.context) {
      try { await this.context.close(); } catch {}
      this.context = null;
      this.page = null;
      this._setupDone = false;
    }
  }

  /**
   * Genspark 로그인 페이지로 이동 — 사용자가 미리 로그인해두는 용도.
   * 자동화 크롬 시작 후 genspark.ai 로그인 페이지로 직행.
   * 이미 로그인돼 있으면 genspark 이 자동으로 메인 페이지로 redirect.
   */
  async openLoginPage() {
    await this.start();   // 브라우저 시작 (start 가 ai_image 까지 이동 + 로그인 체크)
    // start() 가 이미 로그인 상태 확인을 함. 로그인 안 됐으면 사용자가 그 창에서 로그인하면 됨.
  }

  /**
   * 설정 적용: Nano Banana 2 확인 → 설정에서 2K + 16:9 → 자동 프롬프트 OFF.
   * ⚠️ 매 생성마다 호출해야 함 — Genspark 은 첫 제출 후 채팅 스레드로 넘어가면서
   *    크기/종횡비가 기본값(자동/정사각형)으로 리셋되기 때문. (그룹1만 16:9, 그룹2+ 정사각형 버그 해소)
   * 각 단계는 실패해도 throw 하지 않고 로그 후 진행 (셀렉터 취약성 대비).
   * @param {boolean} verbose 첫 호출만 상세 로그 (반복 호출은 간결하게)
   */
  async _applySettings(verbose = true) {
    const cfg = GensparkStore.load();
    // 적용 결과(팝오버 안에서 바로 확인) — 끝에 반환해서 호출부가 재오픈 없이 검증에 사용.
    // 크기(이미지 크기) 옵션은 새 Genspark UI(2026-07)에서 제거됨 — 이제 설정 팝오버엔 '종횡비'만.
    //   → _sizeOk 기본 true(크기 요구 없음). 만약 옛 UI라 크기 옵션이 있으면 아래 3단계에서 검증해 덮어씀.
    let _sizeOk = true, _sizeSel = '', _ratioOk = false, _ratioSel = '';
    await this._dismissAnyDialog();

    // 1. 모델 확인 (Nano Banana 2 가 기본 선택 — 검증만, 아니면 경고)
    try {
      const modelTexts = await this.page.$$eval(GENSPARK_SELECTORS.modelButton,
        els => els.map(e => (e.textContent || '').trim()));
      const hasNB2 = modelTexts.some(t => /Nano Banana 2/i.test(t));
      if (!hasNB2) this.log(`[Genspark] ⚠️ Nano Banana 2 모델 칩 못 찾음 (현재: ${modelTexts.join(' / ').slice(0, 60)}) — 그대로 진행`);
      else if (verbose) this.log('[Genspark] 모델: Nano Banana 2 확인');
    } catch (e) {
      this.log(`[Genspark] 모델 확인 예외(무시): ${e.message}`);
    }

    // 2. 설정 팝오버 열기 — 옵션이 실제로 보일 때까지 대기 (애니메이션/리렌더 대비). 안 열리면 1회 재시도.
    try {
      const settingBtn = this.page.locator(GENSPARK_SELECTORS.settingButton).first();
      let opened = false;
      for (let attempt = 0; attempt < 2 && !opened; attempt++) {
        await settingBtn.click({ timeout: 5000 }).catch(() => {});
        // 팝오버 열림 감지 = '종횡비' 옵션 등장(새 UI엔 크기 옵션이 없으므로 ratioOption 기준).
        opened = await this.page.waitForSelector(GENSPARK_SELECTORS.ratioOption, { timeout: 3500, state: 'visible' })
          .then(() => true).catch(() => false);
      }
      await this.page.waitForTimeout(400);  // 옵션 위치 안정화
      if (!opened) this.log('[Genspark] ⚠️ 설정 팝오버 옵션이 안 보임 — 그래도 시도');
    } catch (e) {
      this.log(`[Genspark] ⚠️ 설정 버튼 클릭 실패: ${e.message}`);
    }

    // 3. 이미지 크기 선택 — 새 UI(2026-07)엔 크기 옵션이 없음(종횡비만). 옵션이 있으면(옛 UI) 선택·검증, 없으면 스킵.
    try {
      const sizeLoc = this.page.locator(GENSPARK_SELECTORS.sizeOption, { hasText: cfg.imageSize });
      if (await sizeLoc.count()) {
        let sel = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await sizeLoc.first().scrollIntoViewIfNeeded({ timeout: 2000 }); } catch (_) {}
          try { await sizeLoc.first().click({ timeout: 4000 }); }
          catch (_) { await sizeLoc.first().click({ timeout: 4000, force: true }).catch(() => {}); }
          await this.page.waitForTimeout(300);
          sel = await this.page.$eval(GENSPARK_SELECTORS.sizeSelected, el => (el.textContent || '').trim()).catch(() => '');
          if (sel.includes(cfg.imageSize)) break;
        }
        _sizeSel = sel; _sizeOk = sel.includes(cfg.imageSize);
        if (verbose || !sel.includes(cfg.imageSize)) {
          this.log(`[Genspark] 이미지 크기: ${cfg.imageSize} 선택 (현재 선택=${sel || '?'})`);
        }
      } else {
        // 새 UI: 크기 옵션 없음 → 스킵(요구 없음, _sizeOk 기본 true 유지).
        _sizeSel = '(크기옵션없음)';
        if (verbose) this.log('[Genspark] 이미지 크기 옵션 없음 — 새 UI(종횡비만), 스킵');
      }
    } catch (e) {
      this.log(`[Genspark] ⚠️ 크기 선택 실패: ${e.message}`);
    }

    // 4. 종횡비 선택 — 프로젝트 비율(쇼츠=9:16) override 우선, 없으면 cfg.ratio(기본 16:9).
    const _ratio = this._aspectRatio || cfg.ratio || '16:9';
    try {
      const ratioLoc = this.page.locator(GENSPARK_SELECTORS.ratioOption, { hasText: _ratio });
      if (await ratioLoc.count()) {
        let sel = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await ratioLoc.first().scrollIntoViewIfNeeded({ timeout: 2000 }); } catch (_) {}
          try { await ratioLoc.first().click({ timeout: 4000 }); }
          catch (_) { await ratioLoc.first().click({ timeout: 4000, force: true }).catch(() => {}); }
          await this.page.waitForTimeout(300);
          sel = await this.page.$eval(GENSPARK_SELECTORS.ratioSelected, el => (el.textContent || '').trim()).catch(() => '');
          if (sel.includes(_ratio)) break;
        }
        _ratioSel = sel; _ratioOk = sel.includes(_ratio);
        // 이 세션에서 실제로 맞춘 비율을 기억한다 — 나중에 팝오버가 안 열려 확인만 못 했을 때 근거가 된다.
        if (_ratioOk) this._ratioConfirmed = _ratio;
        if (verbose || !sel.includes(_ratio)) {
          this.log(`[Genspark] 종횡비: ${_ratio} 선택 (현재 선택=${sel || '?'})`);
        }
      } else {
        this.log(`[Genspark] ⚠️ 종횡비 '${_ratio}' 못 찾음 — 기본값 유지`);
      }
    } catch (e) {
      this.log(`[Genspark] ⚠️ 종횡비 선택 실패: ${e.message}`);
    }

    // 5. 설정 팝오버 닫기
    try {
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(400);
    } catch {}

    // 6. 자동 프롬프트 OFF — class 에 'active' 있으면 클릭해서 제거
    try {
      const toggle = await this.page.$(GENSPARK_SELECTORS.autoPromptToggle);
      if (toggle) {
        let cls = (await toggle.getAttribute('class')) || '';
        if (/\bactive\b/.test(cls)) {
          await toggle.click();
          await this.page.waitForTimeout(400);
          cls = (await toggle.getAttribute('class')) || '';
          if (/\bactive\b/.test(cls)) {
            await toggle.click({ force: true });
            await this.page.waitForTimeout(400);
            cls = (await toggle.getAttribute('class')) || '';
          }
          this.log(/\bactive\b/.test(cls)
            ? '[Genspark] ⚠️ 자동 프롬프트 OFF 적용 실패 (여전히 active) — 그대로 진행'
            : '[Genspark] 자동 프롬프트 OFF 적용');
        } else if (verbose) {
          this.log('[Genspark] 자동 프롬프트 이미 OFF');
        }
      } else {
        this.log('[Genspark] ⚠️ 자동 프롬프트 토글 못 찾음 — 그대로 진행');
      }
    } catch (e) {
      this.log(`[Genspark] ⚠️ 자동 프롬프트 토글 실패: ${e.message}`);
    }

    // 적용 결과 반환 — 팝오버 안에서 이미 확인했으므로 호출부는 재오픈 없이 이 값으로 검증.
    return {
      sizeOk: _sizeOk, ratioOk: _ratioOk,
      sizeSel: _sizeSel, ratioSel: _ratioSel,
      wantSize: cfg.imageSize, wantRatio: (this._aspectRatio || cfg.ratio || '16:9'),
    };
  }

  /** textarea 에 텍스트 채우고 전송. 여러 줄(\n) 도 지원 — React setter 로 값 주입(타이핑 X)
   *  이라 \n 이 Enter 제출로 새지 않음. 단일/배치 공용. (라이브 검증 2026-06-01) */
  async _fillAndSubmit(text) {
    const inputSel = GENSPARK_SELECTORS.promptInput;
    const promptEl = await this.page.$(inputSel);
    if (!promptEl) throw new Error(`프롬프트 입력란 못 찾음 (selector: ${inputSel})`);
    await promptEl.click();
    // React 제어 textarea: native setter 로 값 주입 + input 이벤트 (멀티라인 안전)
    await this.page.evaluate(({ sel, val }) => {
      const el = document.querySelector(sel.split(',')[0].trim()) || document.querySelector('textarea.search-input');
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, { sel: inputSel, val: text });
    await this.page.waitForTimeout(500);
    // 전송 — 텍스트가 들어가면 나타나는 .enter-icon(검은 ↵) 을 기다렸다가 클릭.
    //   ⚠️ 마이크 버튼(speakly.ai 로 이동) 은 절대 누르지 않음 — sendButton 셀렉터가 .enter-icon/.input-icon 만 잡음.
    let submitted = false;
    try {
      const enterBtn = await this.page.waitForSelector(GENSPARK_SELECTORS.sendButton, { timeout: 4000, state: 'visible' });
      if (enterBtn) { await enterBtn.click({ timeout: 5000 }); submitted = true; }
    } catch (e) {
      this.log(`[Genspark] 전송 버튼(enter-icon) 대기/클릭 실패 — Enter 키 백업: ${e.message}`);
    }
    if (!submitted) {
      // 백업: textarea 포커스 후 Enter (Genspark 의 enter-icon = Enter 제출)
      try { await (await this.page.$(inputSel))?.click(); } catch (_) {}
      await this.page.keyboard.press('Enter').catch(() => {});
    }
  }

  /** 결과 이미지 src 를 fetch → 올바른 확장자로 저장 → {path,width,height} 반환. 실패 시 throw. */
  async _fetchAndSave(src, outputPath) {
    const res = await this.page.context().request.get(src);
    if (!res.ok()) throw new Error(`이미지 fetch 실패: HTTP ${res.status()}`);
    const buf = await res.body();
    // Genspark 은 JPEG 를 주는데 outputPath 는 .png — 실제 포맷에 맞춰 확장자 교정
    let finalPath = outputPath;
    try {
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      let ext = '';
      if (ct.includes('jpeg') || ct.includes('jpg')) ext = '.jpg';
      else if (ct.includes('png')) ext = '.png';
      else if (ct.includes('webp')) ext = '.webp';
      else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';
      else if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
      else if (buf[0] === 0x52 && buf[8] === 0x57) ext = '.webp';
      if (ext && path.extname(outputPath).toLowerCase() !== ext) {
        finalPath = outputPath.replace(/\.[^.\\/]+$/, '') + ext;
      }
    } catch (_) {}
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.writeFileSync(finalPath, buf);
    const dim = _readImageSize(buf) || { width: 0, height: 0 };
    return { path: finalPath, width: dim.width, height: dim.height };
  }

  /** 현재 결과 이미지 src 를 DOM 순서대로(중복 제거) 반환 — DOM 순서 = 채팅 입력 순서 */
  async _resultSrcsInOrder() {
    const srcs = await this.page.$$eval(GENSPARK_SELECTORS.resultImg, els => els.map(e => e.src)).catch(() => []);
    const seen = new Set(); const out = [];
    for (const s of srcs) { if (s && !seen.has(s)) { seen.add(s); out.push(s); } }
    return out;
  }

  /** 배치 미완료(Failure 타일 등) 시 결과 카드 DOM 구조를 로그로 덤프 — 진단용.
   *  목적: "부분 저장(성공분만 올바른 그룹에)" 개선을 위해 Failure 타일의 정확한 마크업 수집.
   *  실패 상황을 일부러 재현하기 어려우므로, 자연 발생 시 자동으로 로그에 남긴다. */
  async _dumpResultCards() {
    try {
      const info = await this.page.evaluate(() => {
        const out = { failures: [], cards: [] };
        // 1) "Failure" 텍스트 요소와 그 부모 체인 (3단계)
        const fe = [...document.querySelectorAll('*')].filter(el =>
          el.children.length === 0 && /^failure$/i.test((el.textContent || '').trim()));
        for (const el of fe.slice(0, 4)) {
          const chain = [];
          let p = el;
          for (let i = 0; i < 4 && p; i++) {
            chain.push(`${p.tagName}.${String(p.className || '').split(/\s+/).slice(0, 2).join('.')}`);
            p = p.parentElement;
          }
          out.failures.push(chain.join(' < '));
        }
        // 2) 결과 이미지의 그리드 컨테이너 추정 → 카드들을 순서대로 (img 유무 + 텍스트)
        const imgs = [...document.querySelectorAll('img[src*="/api/files/s/"]')];
        if (imgs.length) {
          let grid = imgs[imgs.length - 1].parentElement;
          for (let i = 0; i < 6 && grid; i++) {
            const kids = [...grid.children];
            if (kids.length >= 2 && kids.filter(k => k.querySelector && (k.querySelector('img[src*="/api/files/s/"]') || /failure/i.test(k.textContent || ''))).length >= 2) break;
            grid = grid.parentElement;
          }
          if (grid) {
            out.gridClass = String(grid.className || '').slice(0, 60);
            out.cards = [...grid.children].slice(-12).map((k, idx) => ({
              i: idx,
              cls: String(k.className || '').split(/\s+/).slice(0, 2).join('.'),
              img: !!(k.querySelector && k.querySelector('img[src*="/api/files/s/"]')),
              txt: (k.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
            }));
          }
        }
        return out;
      });
      if (info.failures.length) this.log(`[Genspark] [DUMP Failure타일] ${info.failures.join(' || ')}`);
      if (info.cards.length) this.log(`[Genspark] [DUMP 결과카드] grid=${info.gridClass || '?'} cards=${JSON.stringify(info.cards)}`);
      if (!info.failures.length && !info.cards.length) this.log('[Genspark] [DUMP] Failure 타일/결과 그리드 미검출');
    } catch (e) {
      this.log(`[Genspark] [DUMP] 결과카드 덤프 실패(무시): ${e.message}`);
    }
  }

  /** NSFW/Failure(모더레이션 차단) 타일이 결과에 떴는지 — 떴으면 그 컷은 재시도해도 안 나옴.
   *  리프 요소 중 텍스트가 정확히 "NSFW"/"Failure" 인 것 탐지(큰 컨테이너 오탐 방지). */
  async _hasNsfwTile() {
    try {
      return await this.page.evaluate(() => {
        const els = [...document.querySelectorAll('div,span,p')].filter((el) => el.children.length === 0);
        return els.some((el) => { const t = (el.textContent || '').trim(); return /^nsfw$/i.test(t) || /^failure$/i.test(t); });
      });
    } catch (_) { return false; }
  }

  /** 사용 한도/차단/플랜 관련 안내 메시지 감지 — 발견 시 텍스트 반환, 없으면 null.
   *  (예: "5시간 제한에 근접했습니다.", "limit reached", "더 이상 ..." 등) */
  async _detectLimitMessage() {
    try {
      return await this.page.evaluate(() => {
        const RE = /(한도|제한|사용량|초과|남은|세션|재설정|limit|quota|credit|too many|rate.?limit|upgrade|플랜|업그레이드|내일|reset|session)/i;
        // 토스트/배너 + 모달 팝업("세션 한도 도달" 등 role=dialog/alertdialog·modal·popup)도 검사.
        const sels = '[role="alert"],[role="status"],[role="dialog"],[role="alertdialog"],[class*="toast" i],[class*="error" i],[class*="limit" i],[class*="banner" i],[class*="notice" i],[class*="warn" i],[class*="modal" i],[class*="dialog" i],[class*="popup" i]';
        for (const el of Array.from(document.querySelectorAll(sels))) {
          const t = (el.textContent || '').trim();
          if (t && t.length < 200 && RE.test(t)) return t;
        }
        // 폴백: 배너 클래스가 위 목록과 안 맞아도, '강한' 제한 문구(예 "AI Image 5시간 제한에 도달했습니다.
        //   ...재설정됩니다")는 본문 직접 텍스트에서 잡는다. 강문구라 오탐 위험 낮음.
        const STRONG = /(\d+\s*시간\s*제한|제한에\s*도달|재설정됩니다|한도에?\s*도달|limit\s*reached|usage\s*limit|rate.?limit)/i;
        for (const el of Array.from(document.querySelectorAll('div,span,p,section,li'))) {
          const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
          if (own && own.length < 200 && STRONG.test(own)) return own;
        }
        return null;
      });
    } catch (_) { return null; }
  }

  /**
   * 프롬프트 N개 → 이미지 N장 한 번에 생성 (줄바꿈으로 나열 → Genspark 이 줄당 1장).
   * 결과는 입력 순서대로 매핑 (DOM 순서 = 입력 순서, 라이브 검증 2026-06-01).
   * @param {object} args
   *   prompts     : string[] 각 줄 = 한 이미지 프롬프트
   *   outputPaths : string[] prompts 와 1:1 (절대경로)
   *   abortSignal : () => boolean
   * @returns Array< { path?, width?, height?, error? } >  (prompts 와 같은 길이/순서)
   */
  async generateImagesBatch({ prompts, outputPaths, abortSignal, onSaved }) {
    const N = prompts.length;
    const fail = (msg) => prompts.map(() => ({ error: msg }));
    const limited = (msg) => prompts.map(() => ({ limit: true, error: msg })); // 한도/제한 — 순환에서 다음 엔진으로

    const limit = GensparkStore.checkDailyLimit();
    if (!limit.allowed) return limited(limit.reason);
    if (!N) return [];

    // 브라우저 + 설정 보장
    if (this.page && this.page.isClosed && this.page.isClosed()) {
      try { await this.context?.close(); } catch {}
      this.context = null; this.page = null;
    }
    await this.start();
    if (abortSignal && abortSignal()) return fail('사용자 중단');

    // 설정(크기/비율) 확정 — _applySettings 가 팝오버 안에서 바로 확인한 결과를 그대로 사용.
    //   (별도 재오픈 검증은 불필요한 추가 클릭이라 제거 — 적용 단계에서 이미 .selected 확인함)
    //   1K/16:9 가 맞을 때까지 최대 3회 재적용. 끝내 안 되면 이 배치를 생성하지 않고 실패 반환
    //   → 잘못된 크기 이미지가 폴더에 섞이는 미스매치 원천 차단.
    let _verified = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      _verified = await this._applySettings(!this._appliedOnce);
      this._appliedOnce = true;
      if (abortSignal && abortSignal()) return fail('사용자 중단');
      if (_verified && _verified.sizeOk && _verified.ratioOk) {
        if (attempt > 1) this.log(`[Genspark] ✅ 설정 확인: 크기=${_verified.sizeSel} · 비율=${_verified.ratioSel}`);
        break;
      }
      this.log(`[Genspark] ⚠️ 설정 미일치 (시도 ${attempt}/3) — 크기=${(_verified && _verified.sizeSel) || '?'}(원함 ${_verified && _verified.wantSize}) · 비율=${(_verified && _verified.ratioSel) || '?'}(원함 ${_verified && _verified.wantRatio}) — 재적용`);
      if (abortSignal && abortSignal()) return fail('사용자 중단');
    }
    // 🔑 팝오버가 안 열려 **확인만** 못 한 경우와, 설정이 실제로 틀린 경우를 가른다.
    //   Genspark 는 한 번 고른 비율을 세션 내내 유지하므로, 이미 맞춘 적이 있으면 확인 실패 = 설정 오류가 아니다.
    //   🔴 2026-08-26 아내 PC: 팝오버가 안 열려 `종횡비 '16:9' 못 찾음` → 3회 재시도 후 배치 포기 →
    //      G8·G9 가 통째로 실패했다(그 세션에서 앞서 16:9 적용은 성공했었다).
    const _ratioKept = _verified && _verified.sizeOk && !_verified.ratioOk
      && this._ratioConfirmed && this._ratioConfirmed === _verified.wantRatio;
    if (_ratioKept) {
      this.log('[Genspark] ⚠️ 비율 옵션을 확인하지 못했지만 이 세션에서 이미 ' + this._ratioConfirmed + ' 로 맞춘 적이 있어 그대로 진행합니다.');
    } else if (!_verified || !_verified.sizeOk || !_verified.ratioOk) {
      const msg = `Genspark 설정 적용 실패 (원함 ${_verified ? _verified.wantSize : '1K'}/${_verified ? _verified.wantRatio : '16:9'} · 실제 크기=${_verified ? (_verified.sizeSel || '?') : '?'}/비율=${_verified ? (_verified.ratioSel || '?') : '?'}) — 잘못된 크기 방지 위해 이 배치를 생성하지 않음`;
      this.log(`[Genspark] ❌ ${msg}`);
      return fail(msg);
    }
    if (abortSignal && abortSignal()) return fail('사용자 중단');

    const t0 = Date.now();
    try {
      // 제출 전 기존 이미지 스냅샷
      const beforeSrcs = new Set(await this._resultSrcsInOrder());

      // 줄바꿈으로 나열해 한 번에 제출
      await this._fillAndSubmit(prompts.join('\n'));
      this.log(`[Genspark] ${N}개 프롬프트 한 번에 제출 — ${N}장 대기`);

      // N 장 새 이미지 등장 폴링
      const POLL = 3000;
      const TIMEOUT_MS = Math.max(4 * 60 * 1000, N * 45 * 1000);
      const GRACE_MS = 180 * 1000;   // 막판 1~2장만 남았을 때 추가로 더 기다리는 유예 (안정 우선 — 미스매치 방지)
      const startedAt = Date.now();
      let newSrcs = [];
      let limitMsg = null;
      let _gracedLogged = false;
      let nsfwSeen = false, nsfwAt = 0;
      let lastCount = 0, lastProgressAt = Date.now(); // 진행 정체(스톨) 감지용
      while (true) {
        if (abortSignal && abortSignal()) return fail('사용자 중단');
        await this.page.waitForTimeout(POLL);
        newSrcs = (await this._resultSrcsInOrder()).filter(s => !beforeSrcs.has(s));
        const elapsedMs = Date.now() - startedAt;
        const elapsed = Math.round(elapsedMs / 1000);
        if (newSrcs.length >= N) {
          // 안정화: 한 번 더 확인 (로딩 중 transient 회피)
          await this.page.waitForTimeout(1500);
          newSrcs = (await this._resultSrcsInOrder()).filter(s => !beforeSrcs.has(s));
          if (newSrcs.length >= N) { this.log(`[Genspark] ${newSrcs.length}장 감지 (${elapsed}초)`); break; }
        }
        // 진행 정체(스톨) 감지 — 새 이미지 개수가 늘면 진행시각 갱신. 75초간 새 장이 없고 아직 부족하면
        //   (거의 다 됐을 땐 제외 — 막판 유예로 처리) 타임아웃까지 헛대기 말고 조기 종료 → 상위가 단건 재생성.
        if (newSrcs.length > lastCount) { lastCount = newSrcs.length; lastProgressAt = Date.now(); }
        const almostDoneStall = N >= 2 && newSrcs.length >= N - 1;
        if (!almostDoneStall && newSrcs.length < N && elapsed >= 45 && (Date.now() - lastProgressAt) > 75000) {
          this.log(`[Genspark] ${elapsed}초·${newSrcs.length}/${N}에서 75초 정체 — 이 배치 종료 후 빠진 컷 단건 재생성`);
          break;
        }
        // 사용 한도/제한 메시지 감지 → 조기 중단(순환의 다음 엔진으로).
        //   0장뿐 아니라 부분완료(예 3/6)에서 5시간 제한이 걸린 경우도 잡아야 하므로 newSrcs.length < N 이면 검사.
        //   (이전엔 ===0 만 검사 → 3/6 에서 제한 걸리면 타임아웃까지 4~5분 헛대기)
        if (newSrcs.length < N && elapsed >= 20) {
          const msg = await this._detectLimitMessage();
          if (msg) {
            limitMsg = msg;
            this.log(`[Genspark] ⚠️ 사용 한도/제한 메시지 감지: "${msg}" — 남은 ${N - newSrcs.length}장 중단, 다음 엔진으로`);
            break;
          }
        }
        // 🚫 NSFW/Failure(모더레이션) 타일 감지 → 막힌 컷은 영영 안 나옴. 감지 후 잠깐만(다른 장 마무리)
        //   더 기다리고 종료 → 450초 헛대기 방지. 어느 컷인지·우회(순화/대체)는 상위(pipeline)에서 처리.
        if (newSrcs.length < N && !nsfwSeen && elapsed >= 12) {
          if (await this._hasNsfwTile()) { nsfwSeen = true; nsfwAt = elapsedMs; this.log(`[Genspark] ⚠️ NSFW(모더레이션) 타일 감지 — 막힌 컷은 생성 불가`); }
        }
        if (nsfwSeen && (elapsedMs - nsfwAt) > 12000) { this.log('[Genspark] NSFW로 일부 미완료 — 대기 종료'); break; }
        // ⏱ 막판 유예 — 5장(N-1) 이상 완료됐는데 마지막 1~2장이 안 끝나면, 기본 타임아웃에서
        //   멈추지 말고 GRACE_MS 까지 더 기다린다. (이전: 6장 중 5장 떠도 타임아웃에 6장 통째로 버림)
        const almostDone = N >= 2 && newSrcs.length >= N - 1;
        const effTimeout = almostDone ? TIMEOUT_MS + GRACE_MS : TIMEOUT_MS;
        if (almostDone && elapsedMs >= TIMEOUT_MS && !_gracedLogged) {
          _gracedLogged = true;
          this.log(`[Genspark] 막판 ${N - newSrcs.length}장 대기 — 최대 ${Math.round(GRACE_MS / 1000)}초 추가 유예 (배치 통째 버림 방지)`);
        }
        if (elapsedMs >= effTimeout) break;
        this.log(`[Genspark] 배치 생성 대기... ${newSrcs.length}/${N} (${elapsed}초)`);
      }

      if (newSrcs.length < N) {
        // 개수 불일치 → 순서 매핑 신뢰 불가. 안전하게 전체 실패 처리(오매칭 방지 — 재시도 권장).
        // 진단: Failure 타일/결과 카드 구조를 로그에 남김 → "성공분만 부분 저장" 개선의 근거 수집.
        await this._dumpResultCards();
        if (limitMsg) {
          return limited(`Genspark 사용 한도/제한으로 보임: "${limitMsg}" — 잠시 후(보통 몇 시간) 다시 시도하세요.`);
        }
        if (nsfwSeen) {
          // 모더레이션 차단 — 같은 프롬프트 재시도는 무의미. 상위에서 순화/대체엔진으로 우회하도록 blocked 표시.
          return prompts.map(() => ({ blocked: true, reason: 'NSFW/모더레이션 차단' }));
        }
        return fail(`배치 미완료 — ${N}장 중 ${newSrcs.length}장만 확인 (재시도 필요)`);
      }

      // 입력 순서대로 매핑해 저장 (newSrcs 는 DOM 순서 = 입력 순서)
      const results = [];
      for (let i = 0; i < N; i++) {
        try {
          const r = await this._fetchAndSave(newSrcs[i], outputPaths[i]);
          GensparkStore.markUsed();
          results.push(r);
          if (r && r.path && onSaved) { try { onSaved(i, r.path); } catch {} } // 저장 즉시 매핑 통지
        } catch (e) {
          results.push({ error: e.message });
        }
      }
      const okCount = results.filter(r => r.path).length;
      const dim0 = results.find(r => r.width);
      this.log(`[Genspark] ✅ 배치 저장 ${okCount}/${N}${dim0 ? ` · 크기 ${dim0.width}x${dim0.height} (비율 ${(dim0.width / dim0.height).toFixed(2)})` : ''} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return results;
    } catch (e) {
      return fail(`Genspark 배치 예외: ${e.message}`);
    }
  }

  /** 프롬프트 1개 → 이미지 1장 (배치의 단일 케이스 래퍼). */
  async generateImage({ prompt, outputPath, abortSignal }) {
    if (!prompt || !prompt.trim()) return { error: '빈 프롬프트' };
    if (!outputPath) return { error: 'outputPath 필수' };
    const [r] = await this.generateImagesBatch({ prompts: [prompt], outputPaths: [outputPath], abortSignal });
    return r || { error: '알 수 없는 오류' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  🎬 비디오 (agents?type=video_generation_agent)
  // ══════════════════════════════════════════════════════════════════════════

  /** 비디오 페이지로 진입(브라우저는 재사용). 이미지 페이지에 있었으면 URL 만 옮긴다. */
  async startVideo() {
    await this.start({ url: GENSPARK_VIDEO_URL });
    let onVideo = false;
    try { onVideo = /video_generation_agent/.test(this.page.url()); } catch (_) {}
    if (!onVideo) {
      // 이미 이미지 페이지에 있던 브라우저를 재사용하는 경우 — 같은 창에서 URL 만 옮긴다.
      await this.page.goto(GENSPARK_VIDEO_URL, { waitUntil: 'load', timeout: 30000 });
      await this.page.waitForTimeout(2500);
      await this._dismissAnyDialog();
    }
    this._videoSetupDone = false;   // 페이지가 바뀌었으면 설정을 다시 맞춘다
  }

  /**
   * 모델 칩을 원하는 이름으로 맞춘다(로이 지정 기본 = Gemini Omni Flash).
   * ⚠ **못 찾으면 조용히 넘어가지 않는다** — Flow 에서 `_selectModel` 이 라벨을 못 찾고 조용히
   *   넘어가 「골라도 언제나 기본 모델」이던 사고가 있었다(v0.3.71). 로그를 남긴다.
   */
  async _selectVideoModel(want) {
    const target = String(want || '').trim();
    if (!target) return true;
    try {
      // 이미 그 모델이면 아무것도 하지 않는다(칩 라벨은 잘려 보일 수 있어 앞부분만 비교).
      const chips = await this.page.$$(GENSPARK_VIDEO_SELECTORS.modelButton);
      const chip0 = chips[0];
      const cur = chip0 ? (((await chip0.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()) : '';
      if (cur && target.toLowerCase().startsWith(cur.toLowerCase().replace(/\.\.\.$/, '').slice(0, 10))) {
        this.log(`[Genspark] 비디오 모델: ${cur} (이미 선택됨)`);
        return true;
      }
      if (!chip0) { this.log('[Genspark] ⚠ 모델 칩을 못 찾음'); return false; }

      await chip0.click({ timeout: 5000 });
      await this.page.waitForTimeout(1500);

      // 🔑 **정확한 제목 매칭** — 목록 행은 "New Seedance 2.5 Next-gen Seedance with…" 처럼 길고,
      //   `MiniMax H3` 는 `MiniMax H3 Max` 에도 포함된다. 그래서 **모델명과 글자까지 같은 리프 요소**를
      //   찾아 그 행을 클릭한다(이미지 경로의 .ratio-label 방식과 같은 발상).
      const clicked = await this.page.evaluate((name) => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        const leaves = [...document.querySelectorAll('div,span,p,h1,h2,h3,h4,strong,b')]
          .filter((el) => vis(el) && el.children.length === 0 && txt(el) === name);
        if (!leaves.length) return false;
        // 클릭은 그 제목의 조상 중 「행」에 해야 한다(제목만 누르면 안 먹는 경우가 있다).
        let el = leaves[0];
        for (let i = 0; i < 5 && el.parentElement; i++) {
          const p = el.parentElement;
          if (txt(p).length > name.length + 10) { p.click(); return true; }
          el = p;
        }
        leaves[0].click();
        return true;
      }, target).catch(() => false);

      await this.page.waitForTimeout(1200);
      if (!clicked) {
        // 폴백: Playwright 텍스트 매칭(정확 일치)
        const exact = this.page.locator(`text="${target}"`).first();
        if (await exact.count()) { await exact.click({ timeout: 4000 }).catch(() => {}); await this.page.waitForTimeout(1000); }
      }
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.page.waitForTimeout(600);

      // 확인 — 칩 라벨이 바뀌었나
      const chips2 = await this.page.$$(GENSPARK_VIDEO_SELECTORS.modelButton);
      const now = chips2[0] ? (((await chips2[0].innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()) : '';
      const ok = !!now && target.toLowerCase().startsWith(now.toLowerCase().replace(/\.\.\.$/, '').slice(0, 8));
      if (ok) { this.log(`[Genspark] 비디오 모델 선택 ✓ ${target}`); return true; }
      // ⚠ 조용히 넘어가지 않는다 — Flow 에서 「골라도 언제나 기본 모델」이던 사고(v0.3.71) 재발 방지.
      this.log(`[Genspark] ⚠ 비디오 모델 「${target}」 선택을 확인하지 못했습니다 (칩 표시: ${now || '없음'}) — 그 상태로 진행합니다`);
      return false;
    } catch (e) {
      this.log(`[Genspark] ⚠ 모델 선택 중 오류: ${String(e.message).slice(0, 80)}`);
      return false;
    }
  }

  /** 품질 등급(Standard/Ultra) 선택 — 없으면 조용히 넘어간다(등급 UI 가 없는 모델도 있다). */
  async _selectVideoTier(tier) {
    const want = String(tier || '').trim();
    if (!want) return true;
    try {
      const trig = await this.page.$('.tier-dropdown-trigger');
      if (!trig) return true;
      const cur = ((await trig.innerText().catch(() => '')) || '').trim();
      if (cur.toLowerCase() === want.toLowerCase()) return true;
      await trig.click({ timeout: 4000 });
      await this.page.waitForTimeout(1200);
      const item = this.page.locator(`text="${want}"`).first();
      if (await item.count()) { await item.click({ timeout: 4000 }).catch(() => {}); await this.page.waitForTimeout(700); }
      await this.page.keyboard.press('Escape').catch(() => {});
      this.log(`[Genspark] 품질 등급: ${want}`);
      return true;
    } catch (_) { return true; }
  }

  /**
   * 설정 팝오버에서 종횡비 · 재생 시간 · 생성 횟수를 맞춘다.
   * 🔑 세션 1회만 — Genspark 은 같은 스레드에서 설정을 유지한다(이미지 경로와 같은 성질).
   */
  async _applyVideoSettings({ aspect = '16:9', durationSec = 5, count = 1 } = {}) {
    const S = GENSPARK_VIDEO_SELECTORS;
    const want = (aspect === '9:16') ? '9:16' : (aspect === '1:1' ? 'Auto' : '16:9'); // 1:1 은 목록에 없다 → Auto
    let dur = Math.round(Number(durationSec) || 5);
    let ratioOk = false, durOk = false;

    // ① 자동 프롬프트 OFF — 우리 프롬프트를 그대로 쓰게 한다(대본의 🎬 영상: 지시가 바뀌면 안 된다).
    try {
      const tg = await this.page.$(S.autoPromptToggle);
      if (tg) {
        const cls = (await tg.getAttribute('class')) || '';
        if (/\bactive\b/.test(cls)) {
          await tg.click({ timeout: 4000 });
          await this.page.waitForTimeout(600);
          this.log('[Genspark] 자동 프롬프트 OFF');
        }
      }
    } catch (_) {}

    // ② 설정 팝오버 열기
    try {
      const btn = await this.page.$(S.settingButton);
      if (!btn) { this.log('[Genspark] ⚠ 비디오 설정 칩(.setting-button)을 못 찾음 — 기본 설정으로 진행'); return { ratioOk, durOk }; }
      await btn.click({ timeout: 5000 });
      await this.page.waitForTimeout(1200);

      // ③ 종횡비
      const opts = await this.page.$$(S.ratioOption);
      for (const o of opts) {
        const t = ((await o.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
        if (t !== want) continue;
        const cls = (await o.getAttribute('class')) || '';
        if (/\bselected\b/.test(cls)) { ratioOk = true; break; }
        await o.click({ timeout: 4000 });
        await this.page.waitForTimeout(500);
        ratioOk = true;
        break;
      }
      if (!ratioOk) this.log(`[Genspark] ⚠ 종횡비 「${want}」 을 못 찾음 (있는 것: ${(await Promise.all(opts.map(async (o) => ((await o.innerText().catch(() => '')) || '').trim()))).join(', ')})`);

      // ④ 재생 시간 — 숫자 입력에 직접 넣는다(슬라이더 드래그보다 정확하다).
      try {
        const numEl = await this.page.$(S.durationInput);
        if (numEl) {
          // 🔴 **범위를 페이지에서 읽는다** — 모델마다 다르다(Omni Flash 3~10 · Seedance 2.5 4~30 ·
          //   Veo 3.1 은 4/6/8 만). 하드코딩하면 모델을 바꾼 순간 조용히 엉뚱한 길이가 나간다.
          const lo = Number(await numEl.getAttribute('min').catch(() => null)) || GS_VIDEO_MIN_SEC;
          const hi = Number(await numEl.getAttribute('max').catch(() => null)) || GS_VIDEO_MAX_SEC;
          const clamped = Math.max(lo, Math.min(hi, dur));
          if (clamped !== dur) this.log(`[Genspark] 재생 시간 ${dur}초 → ${clamped}초 (이 모델의 범위 ${lo}~${hi}초)`);
          dur = clamped;
          await this.page.evaluate(({ sel, v }) => {
            const el = document.querySelector(sel);
            if (!el) return;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, String(v));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, { sel: S.durationInput, v: dur });
          await this.page.waitForTimeout(400);
          const got = await numEl.inputValue().catch(() => '');
          durOk = String(got) === String(dur);
          if (!durOk) {
            // 폴백: 슬라이더에 값 주입
            await this.page.evaluate(({ sel, v }) => {
              const el = document.querySelector(sel);
              if (!el) return;
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(el, String(v));
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }, { sel: S.durationSlider, v: dur });
            await this.page.waitForTimeout(400);
            durOk = String(await numEl.inputValue().catch(() => '')) === String(dur);
          }
        }
      } catch (_) {}
      if (!durOk) this.log(`[Genspark] ⚠ 재생 시간 ${dur}초 설정 실패 — 페이지 기본값으로 나갑니다`);

      // ⑤ 생성 횟수 — 1 로 고정(그룹당 1개만 쓴다. 2 는 크레딧 배수일 뿐)
      try {
        const cs = await this.page.$$(S.countOption);
        for (const c of cs) {
          const t = ((await c.innerText().catch(() => '')) || '').trim();
          if (t !== String(count)) continue;
          const cls = (await c.getAttribute('class')) || '';
          if (!/\bselected\b/.test(cls)) { await c.click({ timeout: 3000 }).catch(() => {}); await this.page.waitForTimeout(400); }
          break;
        }
      } catch (_) {}

      await this.page.keyboard.press('Escape').catch(() => {});
      await this.page.waitForTimeout(500);
      this.log(`[Genspark] 비디오 설정 — 종횡비 ${want}${ratioOk ? '' : '(실패)'} · ${dur}초${durOk ? '' : '(실패)'} · ${count}회`);
    } catch (e) {
      this.log(`[Genspark] ⚠ 비디오 설정 중 오류: ${String(e.message).slice(0, 90)}`);
    }
    return { ratioOk, durOk, durationSec: dur };
  }

  /**
   * 시작 이미지 첨부(i2v) — `+` → 「로컬 파일 찾기」 → **filechooser** 로 파일 지정.
   * 🔴 **실패를 성공으로 넘기지 않는다.** 첨부가 안 된 채 생성하면 원본과 무관한 영상이 나오고
   *   크레딧만 나간다(Flow v0.3.71·v0.3.80 에서 실제로 겪은 사고). 호출부가 그 컷을 건너뛴다.
   * @returns {Promise<boolean>} 첨부 성공 여부
   */
  async _attachVideoSourceImage(imagePath) {
    const S = GENSPARK_VIDEO_SELECTORS;
    if (!imagePath || !fs.existsSync(imagePath)) { this.log('[Genspark] ⚠ 첨부할 이미지가 없습니다'); return false; }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const plus = await this.page.$(S.addEntryBtn);
        if (!plus) { this.log('[Genspark] ⚠ 첨부 버튼(+ .add-entry-btn)을 못 찾음'); return false; }
        // filechooser 를 먼저 걸어 둔다 — 클릭 뒤에 걸면 놓친다.
        const waitChooser = this.page.waitForEvent('filechooser', { timeout: 15000 });
        await plus.click({ timeout: 5000 });
        await this.page.waitForTimeout(800);
        const item = this.page.locator(S.localFileItem).first();
        if (!(await item.count())) { this.log('[Genspark] ⚠ 「로컬 파일 찾기」 항목을 못 찾음'); await this.page.keyboard.press('Escape').catch(() => {}); return false; }
        await item.click({ timeout: 5000 });
        const chooser = await waitChooser;
        await chooser.setFiles(imagePath);
        // 썸네일이 붙을 때까지 기다린다(업로드 처리 시간 — Flow 는 약 9초였다).
        try {
          await this.page.waitForSelector(S.attachedThumb, { timeout: 30000, state: 'visible' });
          this.log(`[Genspark] 시작 이미지 첨부 ✓ ${path.basename(imagePath)}`);
          return true;
        } catch (_) {
          this.log('[Genspark] ⚠ 첨부 썸네일이 나타나지 않음' + (attempt < 2 ? ' — 1회 재시도' : ''));
        }
      } catch (e) {
        this.log(`[Genspark] ⚠ 이미지 첨부 실패(${attempt}/2): ${String(e.message).split('\n')[0].slice(0, 90)}`);
        await this.page.keyboard.press('Escape').catch(() => {});
      }
      await this.page.waitForTimeout(1200);
    }
    return false;
  }

  /** 결과 영상 src 를 DOM 순서대로(중복 제거) 반환 */
  async _videoSrcs() {
    try {
      return await this.page.evaluate(() => {
        const out = [];
        for (const v of Array.from(document.querySelectorAll('video'))) {
          const cands = [v.currentSrc, v.src, ...Array.from(v.querySelectorAll('source')).map((s) => s.src)];
          for (const s of cands) {
            if (!s) continue;
            if (/^blob:/.test(s)) { out.push(s); continue; }
            if (/^https?:/.test(s)) out.push(s);
          }
        }
        return [...new Set(out)];
      });
    } catch (_) { return []; }
  }

  /** 결과 영상을 못 찾았을 때 무엇이 화면에 있었는지 남긴다(다음 사람이 셀렉터를 고칠 근거). */
  async _dumpVideoResultUI() {
    try {
      const d = await this.page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return {
          videos: Array.from(document.querySelectorAll('video')).map((v) => ({ src: (v.currentSrc || v.src || '').slice(0, 100), ready: v.readyState, dur: v.duration })),
          dl: Array.from(document.querySelectorAll('a[download], a[href*="download"], button')).filter(vis)
            .map((e) => ((e.innerText || '') + '|' + (e.getAttribute('href') || '')).replace(/\s+/g, ' ').trim().slice(0, 60)).filter((t) => /다운|download|저장/i.test(t)).slice(0, 6),
          imgs: Array.from(document.querySelectorAll('img[src*="/api/files/"]')).map((i) => i.src.slice(0, 90)).slice(0, 4),
          body: (document.body.innerText || '').replace(/\n{2,}/g, ' / ').slice(0, 400),
        };
      });
      this.log('[Genspark] [DUMP 비디오결과] ' + JSON.stringify(d).slice(0, 900));
    } catch (_) {}
  }

  /**
   * 그룹 이미지 1장 → 영상 1개. (Grok `generateVideoFromImage` 와 같은 계약)
   * @returns {{success:boolean, outputPath?:string, error?:string, limit?:boolean, limitMessage?:string}}
   */
  async generateVideoFromImage({ prompt, imagePath, outputPath, aspect = '16:9', durationSec = 5, abortSignal, model = 'Gemini Omni Flash', tier = 'Standard', requireImage = true }) {
    const S = GENSPARK_VIDEO_SELECTORS;
    const aborted = () => (typeof abortSignal === 'function' && abortSignal());
    if (!outputPath) return { success: false, error: 'outputPath 필수' };
    const t0 = Date.now();
    try {
      await this.startVideo();
      if (aborted()) return { success: false, error: '중단됨' };

      // 한도 먼저 — 헛되이 제출하지 않는다(이미지 경로와 같은 정책)
      const lim0 = await this._detectLimitMessage();
      if (lim0) { this.log(`[Genspark] ⛔ 한도/제한 감지: ${lim0.slice(0, 120)}`); return { success: false, limit: true, limitMessage: lim0, error: lim0 }; }

      if (!this._videoSetupDone) {
        await this._selectVideoModel(model);
        await this._selectVideoTier(tier);
        await this._applyVideoSettings({ aspect, durationSec, count: 1 });
        this._videoSetupDone = true;
      }

      // 시작 이미지 첨부 — 실패하면 **만들지 않는다**(원본과 무관한 영상 + 크레딧 낭비 방지)
      if (imagePath) {
        const ok = await this._attachVideoSourceImage(imagePath);
        if (!ok && requireImage) {
          return { success: false, error: '시작 이미지 첨부 실패 — 이 컷을 만들지 않았습니다(원본과 무관한 영상이 나오는 것을 막기 위해)' };
        }
      }

      const before = await this._videoSrcs();
      await this._fillAndSubmit(String(prompt || '').trim() || 'natural slow motion, subtle camera movement, cinematic');
      this.log('[Genspark] 비디오 생성 제출 — 결과를 기다립니다(보통 1~3분)');

      // 폴링 — 새 video src 가 안정적으로 두 번 잡히면 완성으로 본다(Grok 과 같은 판정).
      const deadline = Date.now() + 8 * 60 * 1000;
      let stable = null, stableHits = 0, lastLog = 0;
      while (Date.now() < deadline) {
        if (aborted()) return { success: false, error: '중단됨' };
        await this.page.waitForTimeout(4000);
        const lim = await this._detectLimitMessage();
        if (lim) { this.log(`[Genspark] ⛔ 생성 중 한도 감지: ${lim.slice(0, 120)}`); return { success: false, limit: true, limitMessage: lim, error: lim }; }
        const now = await this._videoSrcs();
        const fresh = now.filter((s) => !before.includes(s));
        if (fresh.length) {
          const cand = fresh[fresh.length - 1];
          if (cand === stable) stableHits++; else { stable = cand; stableHits = 1; }
          if (stableHits >= 2) break;
        }
        if (Date.now() - lastLog > 30000) { lastLog = Date.now(); this.log(`[Genspark] … 생성 중 (${Math.round((Date.now() - t0) / 1000)}초 경과)`); }
      }
      if (!stable || stableHits < 2) {
        await this._dumpVideoResultUI();
        return { success: false, error: `결과 영상을 찾지 못했습니다 (${Math.round((Date.now() - t0) / 1000)}초 대기) — 위 [DUMP 비디오결과] 로그를 확인하세요` };
      }

      // 저장 — https 는 request.get, blob 은 페이지에서 base64 로 꺼낸다.
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      if (/^blob:/.test(stable)) {
        const b64 = await this.page.evaluate(async (u) => {
          const r = await fetch(u); const b = await r.arrayBuffer();
          let s = ''; const bytes = new Uint8Array(b);
          for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
          return btoa(s);
        }, stable).catch(() => null);
        if (!b64) return { success: false, error: 'blob 영상을 읽지 못했습니다' };
        fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'));
      } else {
        const res = await this.page.context().request.get(stable);
        if (!res.ok()) return { success: false, error: `영상 다운로드 실패: HTTP ${res.status()}` };
        fs.writeFileSync(outputPath, await res.body());
      }
      const kb = (fs.statSync(outputPath).size / 1024).toFixed(0);
      if (Number(kb) < 20) { try { fs.rmSync(outputPath, { force: true }); } catch (_) {} return { success: false, error: `영상이 너무 작습니다(${kb}KB) — 저장하지 않았습니다` }; }
      GensparkStore.markUsed();
      this.log(`[Genspark] ✅ 영상 저장 ${path.basename(outputPath)} (${kb}KB · ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      return { success: true, outputPath };
    } catch (e) {
      return { success: false, error: `Genspark 비디오 예외: ${String(e.message).split('\n')[0].slice(0, 140)}` };
    }
  }
}

module.exports = {
  GensparkEngine, GENSPARK_SELECTORS, PROFILE_BASE,
  GENSPARK_VIDEO_URL, GENSPARK_VIDEO_SELECTORS, GS_VIDEO_MIN_SEC, GS_VIDEO_MAX_SEC,
  GENSPARK_VIDEO_MODELS, GENSPARK_VIDEO_TIERS,
};
