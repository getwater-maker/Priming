'use strict';
/**
 * world-ctx.js — 「세계」(롱폼 / 출판) 분리. 작업이 도는 중에도 출판 탭을 자유롭게 열 수 있게 한다(로이 2026-10-01).
 *
 * 🔴 문제: main.js 의 S.parsed · S.scriptPath · S.outRoot · S.preset · S.mode 는 「지금 보는 대본」 한 벌이라,
 *   롱폼 제작이 도는 중에 출판 탭으로 바꾸면 그 한 벌이 출판 원고로 바뀌어 작업 쪽 코드(300곳+)가 엉뚱한 것을 읽을 수 있었다.
 * 🔑 해법: 세계마다 자기 한 벌(slot)을 갖고, **IPC 호출이 시작된 세계**를 AsyncLocalStorage 로 끝까지 따라가게 한다.
 *   - S.parsed 등은 접근자(getter/setter) — 지금 실행 중인 흐름의 세계 칸을 읽고 쓴다. 기존 코드는 한 줄도 안 바꿔도 된다.
 *   - 흐름이 세계를 갖고 있지 않으면(시작 코드·타이머) 「보고 있는 세계(view)」를 쓴다 = 지금까지와 같다.
 *   - 롱폼 제작(make-all 등)은 롱폼 세계에서 시작했으므로 await 를 몇 번 거쳐도, 그 사이 화면이 출판으로 바뀌어도 롱폼 세계를 본다.
 *   - 출판 IPC 는 출판 세계에서 돈다 → 롱폼 작업의 S.* 를 건드리지 않는다.
 * 테스트: test/world-ctx.test.js (순수 — 일렉트론 없이 실행)
 */
const { AsyncLocalStorage } = require('async_hooks');

function createWorlds(S, opts = {}) {
  const names = opts.worlds || ['longform', 'book'];
  const keys = opts.keys || ['parsed', 'scriptPath', 'outRoot', 'preset'];
  const norm = opts.norm || ((w) => (names.includes(w) ? w : names[0]));
  const als = new AsyncLocalStorage();
  const slots = {};
  for (const n of names) slots[n] = Object.fromEntries(keys.map((k) => [k, null]));
  let view = names[0];

  const key = () => als.getStore() || view;
  for (const k of keys) {
    try { delete S[k]; } catch (_) {}
    Object.defineProperty(S, k, { get: () => slots[key()][k], set: (v) => { slots[key()][k] = v; }, enumerable: true, configurable: true });
  }
  // S.mode = 지금 흐름의 세계. 대입하면 「세계를 바꾼다」 — 같은 세계로의 대입(run-batch 의 S.mode='longform')은 아무 일도 없다.
  //   흐름이 이미 세계를 갖고 있을 때만 그 흐름을 새 세계로 옮긴다(enterWith). 시작 코드에서 enterWith 하면 이후 모든 비동기가 물든다.
  const switchTo = (w) => {
    w = norm(w);
    if (w === key()) return;
    view = w;
    if (als.getStore()) als.enterWith(w);
  };
  try { delete S.mode; } catch (_) {}
  Object.defineProperty(S, 'mode', { get: key, set: switchTo, enumerable: true, configurable: true });

  const api = {
    names, slots,
    key,                                  // 지금 흐름의 세계
    getView: () => view,                  // 화면이 보여 주는 세계
    setView: (w) => { view = norm(w); },  // 화면이 바뀜(set-mode · 원고 열기 응답)
    run: (w, fn) => als.run(norm(w), fn), // 그 세계로 fn 실행(비동기 포함)
    /** 화면이 보는 세계와 같은 세계의 흐름인가 — 화면으로 DTO 를 밀어 보낼지 판단 */
    isViewed: () => key() === view,
    /**
     * ipcMain.handle 을 감싼다 — 호출마다 worldFor(채널, 인자) 의 세계에서 실행.
     * 첫 인자 객체에 __world 가 있으면 그 세계를 쓰고 핸들러에는 넘기지 않는다(명시 > 채널 기본).
     */
    wrapHandle(ipcMain, worldFor) {
      const orig = ipcMain.handle.bind(ipcMain);
      ipcMain.handle = (ch, fn) => orig(ch, (e, ...args) => {
        let w;
        if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && typeof args[0].__world === 'string') {
          w = norm(args[0].__world);
          const { __world, ...rest } = args[0];
          args[0] = rest;
        } else w = norm(worldFor(ch, args, view));
        return als.run(w, () => fn(e, ...args));
      });
    },
  };
  return api;
}

module.exports = { createWorlds };
