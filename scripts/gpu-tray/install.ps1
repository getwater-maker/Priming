# GPU 사용자 표시기 빌드 + 자동 시작 등록 (v1.0.15)
#   Windows 에 들어 있는 .NET Framework C# 컴파일러로 GpuTray.exe 를 만들고(설치할 것 없음),
#   시작프로그램에 바로가기를 둔다. 다시 실행하면 새로 빌드하고 다시 띄운다.
#   실행: powershell -ExecutionPolicy Bypass -File scripts\gpu-tray\install.ps1
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'GpuTray.cs'
$outDir = Join-Path $env:LOCALAPPDATA 'PrimingGpuTray'
$exe = Join-Path $outDir 'GpuTray.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "C# 컴파일러가 없습니다: $csc" }
New-Item -ItemType Directory -Force $outDir | Out-Null

Get-Process GpuTray -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

& $csc /nologo /target:winexe /codepage:65001 /optimize+ "/out:$exe" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll $src
if ($LASTEXITCODE -ne 0) { throw "빌드 실패 ($LASTEXITCODE)" }

$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'GPU 사용자 표시기.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $exe
$s.WorkingDirectory = $outDir
$s.Description = 'GPU 를 지금 누가 쓰는지 알림 영역에 보여 준다 (Priming)'
$s.Save()

Start-Process $exe
"빌드: $exe"
"자동 시작: $lnk"
