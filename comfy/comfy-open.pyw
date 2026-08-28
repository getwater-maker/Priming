# -*- coding: utf-8 -*-
"""
comfy-open.pyw — ComfyUI 를 **웹 UI 로** 연다 (Comfy Desktop 앱 대신).

왜 이게 필요한가 (2026-08-28 실측):
  Comfy Desktop 앱을 열면 그쪽이 8188 을 가져가고, 부팅 런처가 띄운 우리 서버가 사라진다.
  Desktop 서버는 **127.0.0.1 바인딩**이라 그동안 **아내 PC 원격 이미지 생성이 죽는다**
  (우리 런처는 --listen 0.0.0.0). 게다가 Desktop 창을 닫으면 서버도 함께 꺼진다(onAppClose: quit).
  타이밍이 어긋나면 8189 로 밀려 **서버가 두 벌** 되고, 그건 v0.3.35 의 「장당 498초」 사고 조건이다.

  ⇒ 웹 UI 는 **같은 서버의 같은 화면**이다. 브라우저로 열면 위 문제가 전부 사라진다.
     커스텀 노드·모델 설치(Manager)도 런처의 --enable-manager 로 웹 UI 에서 그대로 된다.

쓰는 법 (바탕화면 바로가기가 이걸 부른다):
  comfy-open.pyw              서버가 없으면 띄우고, 준비되면 브라우저로 연다
  comfy-open.pyw --restart    지금 8188 을 쥔 서버를 끄고 우리 런처로 새로 띄운 뒤 연다
                              (커스텀 노드를 설치한 뒤 · Desktop 이 8188 을 가져갔을 때)

⚠ Desktop 앱은 **ComfyUI 버전 업데이트·인스턴스 관리**를 할 때만 쓴다. 그 작업이 끝나면
  Desktop 을 닫고 이 바로가기를 --restart 로 한 번 눌러 우리 서버(0.0.0.0)로 되돌린다.
"""

import os
import subprocess
import sys
import time
import urllib.request

PORT = int(os.environ.get('PRIMING_COMFY_PORT') or 8188)
URL = 'http://127.0.0.1:%d' % PORT
HERE = os.path.dirname(os.path.abspath(__file__))
LAUNCHER = os.path.join(HERE, 'comfy-server.pyw')
LOG_DIR = os.path.join(os.path.expanduser('~'), '.shots-maker', 'logs')
LOG = os.path.join(LOG_DIR, 'comfy-open.log')
READY_TIMEOUT = 180  # 콜드 스타트 실측 55~75초. 넉넉히.

# pythonw 는 콘솔이 없어 sys.stdout 이 무효다 — print 하면 조용히 죽을 수 있다(v0.2.95 와 같은 함정).
#   그래서 처음부터 파일에 쓴다.
def say(msg):
    line = '[%s] %s' % (time.strftime('%Y-%m-%d %H:%M:%S'), msg)
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass


def alert(msg):
    """실패는 사용자가 알아야 한다 — 바로가기로 실행하면 로그를 안 본다."""
    say('알림: ' + msg)
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, msg, 'ComfyUI', 0x40)
    except Exception:
        pass


def alive(timeout=3):
    try:
        with urllib.request.urlopen(URL + '/system_stats', timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def listener_pids():
    """이 포트를 LISTENING 으로 쥔 pid 들. netstat 파싱 — psutil 의존성을 만들지 않는다."""
    pids = set()
    try:
        out = subprocess.run(['netstat', '-ano', '-p', 'TCP'], capture_output=True, text=True, timeout=20).stdout
    except Exception:
        return []
    for ln in out.splitlines():
        parts = ln.split()
        if len(parts) >= 5 and parts[3].upper() == 'LISTENING' and parts[1].endswith(':%d' % PORT):
            try:
                pids.add(int(parts[4]))
            except ValueError:
                pass
    return sorted(pids)


def kill_server():
    pids = listener_pids()
    if not pids:
        say('%d 포트에 리스너가 없습니다 — 끌 것이 없습니다.' % PORT)
        return
    for pid in pids:
        say('%d 포트를 쥔 프로세스 종료: pid %d' % (PORT, pid))
        try:
            subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True, timeout=20)
        except Exception as e:
            say('  종료 실패: %s' % e)
    # 포트가 실제로 풀릴 때까지 잠깐 기다린다(바로 다시 띄우면 주소 사용 중 오류가 난다).
    for _ in range(20):
        if not listener_pids():
            return
        time.sleep(0.5)


def start_server():
    if not os.path.isfile(LAUNCHER):
        alert('런처를 찾지 못했습니다:\n%s' % LAUNCHER)
        return False
    say('런처 실행: %s' % LAUNCHER)
    # DETACHED — 이 프로세스가 끝나도 서버는 계속 산다. 런처가 스스로 인스턴스 .venv 로 재실행한다.
    flags = 0x00000008 | 0x08000000  # DETACHED_PROCESS | CREATE_NO_WINDOW
    try:
        subprocess.Popen([sys.executable, '-s', LAUNCHER], creationflags=flags, close_fds=True)
    except Exception as e:
        alert('런처를 실행하지 못했습니다: %s' % e)
        return False
    t0 = time.time()
    while time.time() - t0 < READY_TIMEOUT:
        if alive():
            say('서버 준비 완료 (%.0f초)' % (time.time() - t0))
            return True
        time.sleep(2)
    alert('서버가 %d초 안에 뜨지 않았습니다.\n로그: %s' % (READY_TIMEOUT, os.path.join(LOG_DIR, 'comfy-server.log')))
    return False


def chrome_path():
    for base in (os.environ.get('PROGRAMFILES'), os.environ.get('PROGRAMFILES(X86)'), os.environ.get('LOCALAPPDATA')):
        if not base:
            continue
        p = os.path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')
        if os.path.isfile(p):
            return p
    return ''


def open_ui():
    """앱 모드(주소창 없는 창)로 연다 — Desktop 앱 창과 체감이 같다. 크롬이 없으면 기본 브라우저."""
    exe = chrome_path()
    if exe:
        try:
            subprocess.Popen([exe, '--app=' + URL, '--window-size=1600,1000'], close_fds=True)
            say('웹 UI 를 열었습니다(크롬 앱 모드): %s' % URL)
            return
        except Exception as e:
            say('크롬 앱 모드 실패(%s) — 기본 브라우저로 엽니다.' % e)
    try:
        os.startfile(URL)
        say('웹 UI 를 열었습니다(기본 브라우저): %s' % URL)
    except Exception as e:
        alert('브라우저를 열지 못했습니다: %s\n직접 %s 로 접속하세요.' % (e, URL))


def main():
    restart = '--restart' in sys.argv[1:]
    say('=== comfy-open %s (port %d) ===' % ('--restart' if restart else '', PORT))
    if restart:
        kill_server()
        if not start_server():
            return 1
    elif not alive():
        say('서버가 없습니다 — 띄웁니다.')
        if not start_server():
            return 1
    else:
        say('서버가 이미 떠 있습니다 — 그대로 씁니다.')
    open_ui()
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        import traceback
        say('예외로 종료:\n' + traceback.format_exc())
        alert('오류가 났습니다. 로그를 보세요:\n%s' % LOG)
        sys.exit(1)
