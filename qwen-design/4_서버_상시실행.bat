@echo off
rem ============================================================================
rem  보이스디자인 서버 — 상시 실행 (지연 로딩 + 유휴 자동 해제)
rem
rem  · 서버만 즉시 떠서 포트 9893 을 열어 둔다 → **모델을 안 올리므로 VRAM 0**.
rem  · 앱(이 PC 또는 아내 PC)이 보이스디자인 창을 열면 그때 모델을 GPU 에 올린다.
rem  · 10분(600초) 동안 사용이 없으면 모델을 내려 VRAM 을 반납한다. 서버는 계속 대기.
rem  → 아내 PC 에서 언제든 쓸 수 있고, 안 쓸 때는 GPU 를 점유하지 않는다.
rem
rem  자동 시작 등록(권장): Win+R → shell:startup → 이 파일의 **바로가기**를 그 폴더에 넣기.
rem                        (관리자 권한 필요 없음. 로그인할 때마다 자동 실행)
rem  ⚠ 다른 PC 에서 접속하려면 방화벽 9893 인바운드 허용이 필요(이미 추가됨).
rem ============================================================================
cd /d "%~dp0"
if not exist "venv\Scripts\pythonw.exe" (
  echo [오류] venv 가 없습니다. 먼저 1_최초설치.bat 를 실행하세요.
  pause
  exit /b 1
)
rem pythonw = 콘솔창 없이 백그라운드 실행. 로그는 server.log 로 남긴다.
start "" /b "venv\Scripts\pythonw.exe" qwen_design_server.py --host 0.0.0.0 --port 9893 --idle-timeout 600 >> "server.log" 2>&1
echo 보이스디자인 서버를 백그라운드로 시작했습니다 (포트 9893 · 지연 로딩 · 유휴 10분 해제).
echo 로그: %~dp0server.log
