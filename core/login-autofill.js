'use strict';
/**
 * login-autofill.js — 🔑 로그인 창에서 **아이디/비밀번호만 대신 입력**해 주는 반자동 도우미.
 *
 * 설계 의도(로이 결정 2026-08-19, "통합 + 자동입력(반자동)"):
 *   저장된 자격증명(core/account-creds.js, OS 암호화)을 로그인 폼에 채워 넣고,
 *   **CAPTCHA·2FA·차단 화면이 나오면 거기서 멈추고 사람에게 넘긴다.** 창은 그대로 열려 있으므로
 *   로이가 이어서 마무리하면 쿠키가 프로필에 저장되고, 그 다음부터는 로그인이 필요 없다.
 *
 * ⚠️ **정직한 한계 — 코드로 뚫을 수 없는 것들**:
 *   · **구글(Flow·Genspark)** 은 자동화 브라우저의 비밀번호 로그인을 **차단**한다
 *     ("이 브라우저 또는 앱은 안전하지 않을 수 있습니다"). 아이디까지는 들어가도 그 뒤가 막힐 수 있다.
 *   · **X(Grok)** 는 arkose **CAPTCHA** 와 **2FA** 를 요구할 수 있다. 둘 다 사람만 통과할 수 있다.
 *   그래서 이 모듈의 목표는 "완전 자동 로그인"이 아니라 **타이핑 대신해 주기 + 막힌 지점 알려주기** 다.
 *   반복 실패는 계정 잠금으로 이어질 수 있으므로 **재시도하지 않는다**(한 번 시도하고 넘긴다).
 *
 * 🔒 비밀번호는 **로그에 절대 남기지 않는다.** 아이디도 마스킹해서 남긴다.
 */

/** 아이디 마스킹 — 로그에 남길 때만 쓴다 (ab***@gmail.com) */
function maskId(s) {
  s = String(s || '');
  if (!s) return '(없음)';
  const at = s.indexOf('@');
  const head = at > 0 ? s.slice(0, at) : s;
  const tail = at > 0 ? s.slice(at) : '';
  const keep = head.slice(0, Math.min(2, head.length));
  return `${keep}${'*'.repeat(Math.max(1, head.length - keep.length))}${tail}`;
}

const SEL = {
  // ── X(트위터) ──────────────────────────────────────────────────────────────
  xUser: 'input[name="text"], input[autocomplete="username"]',
  xPass: 'input[name="password"], input[autocomplete="current-password"]',
  // ── 구글 ──────────────────────────────────────────────────────────────────
  gUser: 'input[type="email"], input#identifierId',
  gPass: 'input[type="password"][name="Passwd"], input[type="password"]',
  // 로그인 진입 버튼 (grok.com 로그아웃 모달 등)
  entry: 'button:has-text("로그인"), button:has-text("Sign in"), button:has-text("Log in"), a:has-text("로그인")',
};

/** '다음/Next/계속' 류 버튼을 눌러 다음 단계로 (Enter 키도 함께 시도) */
async function _advance(page) {
  const cands = [
    'button:has-text("다음")', 'button:has-text("Next")', 'button:has-text("계속")',
    '[role="button"]:has-text("다음")', '[role="button"]:has-text("Next")',
    'button:has-text("로그인")', 'button:has-text("Log in")', '#identifierNext button', '#passwordNext button',
  ];
  for (const s of cands) {
    const el = await page.$(s).catch(() => null);
    if (el) {
      const vis = await el.isVisible().catch(() => false);
      if (vis) { await el.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(1800); return true; }
    }
  }
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(1800);
  return false;
}

/** 사람만 통과할 수 있는 화면인지 검사 — 여기서 멈춰야 한다 */
async function detectBlocker(page) {
  try {
    const txt = await page.evaluate(() => (document.body ? document.body.innerText : '') || '');
    if (/이 브라우저 또는 앱은 안전하지 않을 수 있습니다|browser or app may not be secure/i.test(txt)) {
      return { kind: 'google-blocked', note: '구글이 자동화 브라우저의 로그인을 차단했습니다 — 이 창에서 직접 로그인하세요.' };
    }
    if (/인증 코드|verification code|2단계 인증|two-factor|authentication code|백업 코드/i.test(txt)) {
      return { kind: '2fa', note: '2단계 인증(인증 코드) 단계입니다 — 코드를 직접 입력하세요.' };
    }
    if (/로봇이 아닙니다|not a robot|captcha|퍼즐을 완료|arkose/i.test(txt)) {
      return { kind: 'captcha', note: 'CAPTCHA 단계입니다 — 직접 통과해 주세요.' };
    }
    if (/비정상적인 활동|unusual (login )?activity|일시적으로 잠|locked|suspend/i.test(txt)) {
      return { kind: 'flagged', note: '계정 보호 화면입니다 — 직접 확인해 주세요(반복 시도하지 마세요).' };
    }
    // CAPTCHA iframe (arkose/recaptcha) 은 텍스트가 안 잡히므로 프레임으로도 본다
    const hasCaptchaFrame = await page.evaluate(() => [...document.querySelectorAll('iframe')]
      .some((f) => /arkose|funcaptcha|recaptcha|hcaptcha/i.test(f.src || ''))).catch(() => false);
    if (hasCaptchaFrame) return { kind: 'captcha', note: 'CAPTCHA 가 떴습니다 — 직접 통과해 주세요.' };
  } catch (_) {}
  return null;
}

/** 보이는 입력칸에 값 채우기 — 성공하면 true */
async function _fill(page, sel, value) {
  const el = await page.$(sel).catch(() => null);
  if (!el) return false;
  if (!(await el.isVisible().catch(() => false))) return false;
  await el.click({ timeout: 4000 }).catch(() => {});
  await el.fill(String(value)).catch(async () => {
    // fill 이 안 먹는 커스텀 입력칸이면 타이핑으로
    await page.keyboard.type(String(value), { delay: 30 }).catch(() => {});
  });
  await page.waitForTimeout(500);
  return true;
}

/**
 * 로그인 폼 자동 입력 (1회 시도, 재시도 없음).
 *   page      : Playwright Page (이미 로그인 화면이 떠 있거나 뜰 수 있는 상태)
 *   service   : 'grok' | 'genspark' | 'flow'  (로그 문구·셀렉터 선택용)
 *   username/password : 복호화된 값 (로그에 남기지 않는다)
 *   log       : 로거
 * 반환 { attempted, filledUser, filledPass, blocker, note }
 */
async function autofill(page, { service, username, password, log } = {}) {
  const say = typeof log === 'function' ? log : () => {};
  const out = { attempted: false, filledUser: false, filledPass: false, blocker: null, note: '' };
  if (!username && !password) {
    say('[로그인] 저장된 자격증명이 없습니다 — 창에서 직접 로그인하세요.');
    return out;
  }
  out.attempted = true;
  const isX = service === 'grok';
  say(`[로그인] 자격증명 자동 입력 시도 (${maskId(username)}) — CAPTCHA·2단계 인증이 나오면 거기서 멈추고 넘깁니다.`);

  try {
    // 0) 로그아웃 모달의 「로그인」 버튼을 눌러 로그인 화면으로
    const entry = await page.$(SEL.entry).catch(() => null);
    if (entry && await entry.isVisible().catch(() => false)) {
      await entry.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }

    let blocker = await detectBlocker(page);
    if (blocker) { out.blocker = blocker.kind; out.note = blocker.note; say(`[로그인] ⏸ ${blocker.note}`); return out; }

    // 1) 아이디
    if (username) {
      out.filledUser = (await _fill(page, isX ? SEL.xUser : SEL.gUser, username))
                    || (await _fill(page, isX ? SEL.gUser : SEL.xUser, username));  // 서비스가 반대 폼을 쓸 때 대비
      if (out.filledUser) { say('[로그인] 아이디 입력'); await _advance(page); }
      else say('[로그인] ⚠ 아이디 입력칸을 못 찾음 — 직접 입력해 주세요.');
    }

    blocker = await detectBlocker(page);
    if (blocker) { out.blocker = blocker.kind; out.note = blocker.note; say(`[로그인] ⏸ ${blocker.note}`); return out; }

    // 2) 비밀번호
    if (password) {
      out.filledPass = (await _fill(page, isX ? SEL.xPass : SEL.gPass, password))
                    || (await _fill(page, 'input[type="password"]', password));
      if (out.filledPass) {
        say('[로그인] 비밀번호 입력 — 제출');
        await _advance(page);
      } else {
        say('[로그인] ⚠ 비밀번호 입력칸을 못 찾음 — 직접 입력해 주세요.');
      }
    }

    blocker = await detectBlocker(page);
    if (blocker) { out.blocker = blocker.kind; out.note = blocker.note; say(`[로그인] ⏸ ${blocker.note}`); return out; }

    if (out.filledUser || out.filledPass) {
      say('[로그인] 자동 입력 완료 — 화면을 확인하고, 남은 단계가 있으면 마무리한 뒤 [로그인 완료] 를 누르세요.');
    }
    return out;
  } catch (e) {
    out.note = e.message;
    say(`[로그인] 자동 입력 중 예외(무시하고 수동 진행): ${e.message}`);
    return out;
  }
}

module.exports = { autofill, detectBlocker, maskId };
