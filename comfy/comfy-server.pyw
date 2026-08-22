# -*- coding: utf-8 -*-
"""
로컬 ComfyUI **서버**만 띄우는 런처 (창 없음)
=============================================================================
왜 이 파일이 필요한가 (2026-08-22 실측)
  v0.3.27 은 시작프로그램에 「Comfy Desktop.exe」 바로가기를 넣어 부팅 때 서버가
  뜨도록 했다. 그런데 **Comfy Desktop v1.0.39 부터 그 전제가 깨졌다.**
    · 실측: 부팅 18분 뒤 Comfy Desktop 프로세스 8개가 살아 있는데 **열린 포트가 0개**.
    · `%APPDATA%\\Comfy Desktop\\last-session.json` = `{"kind":"dashboard"}`
      → 이제 앱은 **대시보드(런처)** 로 뜨고, ComfyUI 서버는 **사람이 인스턴스를
        클릭해 열 때만** 시작된다. 앱 로그도 `user-tier`·`git bootstrap` 4줄에서 멈춘다.
  즉 "앱을 띄우면 서버가 뜬다" 가 더는 참이 아니다. → **서버를 직접 띄운다.**
  이 방식은 Comfy Desktop UI 의 동작이 또 바뀌어도 깨지지 않는다.

이 파일이 쓰이는 곳 (둘이 **같은 런처**를 쓴다 — 갈라지면 다음 사람이 엉뚱한 쪽을 고친다)
  ① 부팅 자동 실행 : `shell:startup` 의 「ComfyUI 서버 (Priming 이미지용).lnk」
       대상    : <installPath>\\standalone-env\\pythonw.exe
       인수    : -s "D:\\Priming\\comfy\\comfy-server.pyw"
  ② 앱이 스스로 켠다 : core/comfy-launch.js 가 같은 명령을 spawn 한다.

⚠ 함정 3개 — 전부 이 저장소가 이미 한 번씩 밟은 것들이다
  1. **pythonw.exe 는 콘솔이 없어 sys.stdout/stderr 가 무효다.** 그 상태로 ComfyUI 의
     tqdm 진행바·logging 이 출력하면 예외가 나면서 **포트조차 안 열리고 조용히 죽는다**
     (v0.2.95 OmniVoice 에서 실측). → **main.py 를 불러오기 전에** 진짜 파일 핸들로 바꾼다.
  2. **bat 을 거치지 않는다.** cmd.exe 는 자식이 끝날 때까지 기다리므로 서버가 사는 내내
     검은 창이 화면에 남는다(v0.2.94·v0.2.95 실측).
  3. `--disable-auto-launch` 를 반드시 붙인다. 없으면 서버가 뜰 때마다 **브라우저가 열린다**.

설계 — 경로를 하드코딩하지 않는다
  Comfy Desktop 이 관리하는 `installations.json` 을 **정본으로 읽는다**. 그래서 사용자가
  ComfyUI 를 다시 설치하거나 다른 드라이브로 옮겨도 따라간다(모델 경로 yaml 도 그쪽이 만든다).
"""
import json
import os
import runpy
import socket
import sys

PORT = int(os.environ.get('PRIMING_COMFY_PORT') or 8188)
APPDATA = os.environ.get('APPDATA') or ''
CD_DIR = os.path.join(APPDATA, 'Comfy Desktop')
LOG_DIR = os.path.join(os.path.expanduser('~'), '.shots-maker', 'logs')
LOG_PATH = os.path.join(LOG_DIR, 'comfy-server.log')
LOG_MAX = 5 * 1024 * 1024          # 넘으면 새로 쓴다 — ComfyUI 는 로그가 많다(무한 증식 방지)


# ── ① 출력 리다이렉트 — 반드시 ComfyUI 를 불러오기 **전에** (위 함정 1) ────────────
def _open_log():
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        mode = 'a'
        try:
            if os.path.getsize(LOG_PATH) > LOG_MAX:
                mode = 'w'
        except OSError:
            pass
        return open(LOG_PATH, mode, encoding='utf-8', buffering=1, errors='replace')
    except Exception:
        return None


_log = _open_log()
if _log is not None:
    sys.stdout = _log
    sys.stderr = _log


def say(msg):
    print('[priming-launcher] ' + str(msg), flush=True)


# ── ② 이미 떠 있으면 아무것도 하지 않는다 ────────────────────────────────────────
#  부팅 바로가기와 앱이 동시에 켜려 할 수 있다. 두 번 띄우면 뒤에 온 쪽이 포트를 못 잡고
#  ComfyUI 가 **다른 포트로 밀려** 우리 앱(8188 고정)이 못 찾는 상태가 된다.
def port_busy(port):
    s = socket.socket()
    s.settimeout(1.0)
    try:
        return s.connect_ex(('127.0.0.1', port)) == 0
    finally:
        try:
            s.close()
        except Exception:
            pass


# ── ③ 어느 ComfyUI 를 띄울지 = Comfy Desktop 의 installations.json 이 정본 ────────
def find_instance():
    """(installPath, instanceId) 또는 (None, None). 로컬 설치만, 최근 실행한 것 우선."""
    try:
        with open(os.path.join(CD_DIR, 'installations.json'), encoding='utf-8') as f:
            items = json.load(f)
    except Exception as e:
        say('installations.json 을 읽지 못했습니다 — %s' % e)
        return None, None
    best = None
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        if it.get('sourceId') == 'cloud':
            continue                                   # 클라우드 인스턴스는 띄울 대상이 아니다
        p = it.get('installPath')
        if not p or not os.path.isfile(os.path.join(p, 'ComfyUI', 'main.py')):
            continue
        rank = it.get('lastLaunchedAt') or 0
        if best is None or rank > best[0]:
            best = (rank, p, it.get('id'))
    if best is None:
        return None, None
    return best[1], best[2]


def main():
    if port_busy(PORT):
        say('이미 %d 포트에 서버가 있습니다 — 그대로 둡니다.' % PORT)
        return 0

    install, inst_id = find_instance()
    if not install:
        say('로컬 ComfyUI 설치를 찾지 못했습니다. Comfy Desktop 에서 인스턴스를 한 번 설치·실행하세요.')
        return 2

    comfy_dir = os.path.join(install, 'ComfyUI')
    main_py = os.path.join(comfy_dir, 'main.py')

    # 🔑 **실행 파이썬은 `ComfyUI\\.venv` 다 — `standalone-env` 가 아니다.**
    #   standalone-env 는 기반 인터프리터일 뿐이고, torch 는 uv 가 만든 venv 안에 있다.
    #   실측(2026-08-22): standalone-env\\pythonw.exe 로 돌리면
    #     `ModuleNotFoundError: No module named 'torch'` 로 즉사한다.
    #     .venv\\Scripts\\pythonw.exe → torch 2.12.1+cu130 · cuda True.
    py_dir = os.path.join(comfy_dir, '.venv', 'Scripts')
    want = os.path.join(py_dir, 'pythonw.exe')
    if not os.path.isfile(want):
        # uv 가 pythonw 를 안 만든 판이면 python.exe 로라도 돈다(콘솔 창이 뜰 수 있음).
        alt = os.path.join(py_dir, 'python.exe')
        want = alt if os.path.isfile(alt) else ''
    running = os.path.abspath(sys.executable)
    if want and os.path.dirname(running).lower() != py_dir.lower():
        if os.environ.get('PRIMING_COMFY_REEXEC'):
            say('파이썬 재지정이 이미 한 번 있었습니다 — 그대로 진행합니다(%s).' % running)
        else:
            say('이 인스턴스 전용 파이썬으로 다시 실행합니다: %s' % want)
            os.environ['PRIMING_COMFY_REEXEC'] = '1'
            os.execv(want, [want, '-s', os.path.abspath(__file__)])

    argv = [main_py, '--port', str(PORT), '--disable-auto-launch']

    # 모델 경로 — Comfy Desktop 이 만들어 두는 yaml. 이게 없으면 **모델 목록이 비어**
    # 「로컬 ComfyUI 에 모델 'krea2_turbo…' 가 없습니다」 로 생성이 통째로 실패한다.
    yml = os.path.join(CD_DIR, 'instance-model-paths', '%s.yaml' % inst_id) if inst_id else ''
    if yml and os.path.isfile(yml):
        argv += ['--extra-model-paths-config', yml]
    else:
        say('⚠ 모델 경로 yaml 을 못 찾았습니다(%s) — 모델 목록이 비어 있을 수 있습니다.' % yml)

    # 입·출력 폴더도 Comfy Desktop 과 같은 곳을 쓴다(첨부·결과 파일이 딴 데 생기지 않게).
    try:
        with open(os.path.join(CD_DIR, 'settings.json'), encoding='utf-8') as f:
            st = json.load(f)
        for key, flag in (('inputDir', '--input-directory'), ('outputDir', '--output-directory')):
            v = st.get(key)
            if v and os.path.isdir(v):
                argv += [flag, v]
    except Exception:
        pass

    say('ComfyUI 서버 시작 — port %d · %s' % (PORT, comfy_dir))
    say('  python: %s' % running)
    say('  argv  : %s' % ' '.join(argv[1:]))
    os.chdir(comfy_dir)                 # main.py 가 상대경로(custom_nodes 등)를 쓴다
    sys.path.insert(0, comfy_dir)
    sys.argv = argv
    runpy.run_path(main_py, run_name='__main__')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        import traceback
        say('서버가 예외로 종료됐습니다:')
        traceback.print_exc()
        sys.exit(1)
