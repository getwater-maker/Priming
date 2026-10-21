# Priming Lab 실행 — 원본 Priming 과 데이터를 나눠서 켠다.
#   USERPROFILE 을 Lab 데이터 폴더로 돌리면 ~/.shots-maker · ~/.priming-maker · ~/.flow-app ·
#   Electron userData · 브라우저 프로필 · 캐시 · 로그가 모두 그쪽으로 간다(os.homedir() 가 USERPROFILE 을 따른다).
#   실행: powershell -ExecutionPolicy Bypass -File D:\Priming-VrewLab\lab-start.ps1
$ErrorActionPreference = 'Stop'
$DataRoot = 'D:\Priming-VrewLab-data'
foreach ($d in @('home', 'ref-audio', 'roy-home', 'roy-bank', 'output')) {
  New-Item -ItemType Directory -Force (Join-Path $DataRoot $d) | Out-Null
}
# npm·node 가 원래 홈에서 찾는 것(npm 캐시 등)은 APPDATA/LOCALAPPDATA 쪽이라 그대로 둔다.
$env:USERPROFILE     = "$DataRoot\home"
$env:PRIMING_REF_DIR = "$DataRoot\ref-audio"    # 서버 PC 판정이 진짜 참조음성 라이브러리로 가지 않게
$env:PM_ROY_HOME     = "$DataRoot\roy-home"     # 로이 은행(진짜)을 쓰지 않게
$env:PM_ROY_BANK_DIR = "$DataRoot\roy-bank"
$env:PM_LAB          = '1'                      # 업데이트·시작 서버 동기화 끔, 화면에 Lab 표시
Set-Location $PSScriptRoot
npm start
