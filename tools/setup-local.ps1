# Windows setup for the optional local media engine. No global PATH or policy changes.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskConfigDir = Join-Path $taskRoot '.local'
$taskHome = Join-Path $env:LOCALAPPDATA 'Zaopian'
New-Item -ItemType Directory -Path $taskConfigDir,$taskHome -Force | Out-Null
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskNodeVersion = & $taskNode -p 'process.versions.node'
if ([version]$taskNodeVersion -lt [version]'22.15.0') { throw 'Hypit requires Node.js 22.15.0 or newer.' }
$taskPy = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $taskPy) { throw 'Install Python 3.12, then run this setup again.' }
$taskVenv = Join-Path $taskHome 'python'
if (-not (Test-Path (Join-Path $taskVenv 'Scripts\python.exe'))) {
    & $taskPy.Source -m venv $taskVenv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
}
$taskPython = Join-Path $taskVenv 'Scripts\python.exe'
& $taskPython -m pip install -r (Join-Path $taskRoot 'runtime\requirements.lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'Local transcription dependency installation failed.' }
Push-Location (Join-Path $taskRoot 'runtime')
try {
    $taskPnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if ($taskPnpm) {
        & $taskPnpm.Source install --frozen-lockfile
    } else {
        & npm.cmd exec --yes --package=pnpm@11.25.0 -- pnpm install --frozen-lockfile
    }
    if ($LASTEXITCODE -ne 0) { throw 'Hypit dependency installation failed.' }
} finally { Pop-Location }
$taskFFDir = Join-Path $taskHome 'tools\ffmpeg'
$taskFFVersion = 'ffmpeg-9.0.2-essentials_build'
$taskFFmpeg = Join-Path $taskFFDir "$taskFFVersion\bin\ffmpeg.exe"
if (-not (Test-Path $taskFFmpeg)) {
    New-Item -ItemType Directory -Path $taskFFDir -Force | Out-Null
    $taskZip = Join-Path $taskFFDir "$taskFFVersion.zip"
    Invoke-WebRequest -UseBasicParsing -Uri "https://www.gyan.dev/ffmpeg/builds/packages/$taskFFVersion.zip" -OutFile $taskZip
    $taskExpected = '60F467265B1E312373DBCD92200C2618A74850F98D3D078E94296BB3FA2047BA'
    if ((Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash -ne $taskExpected) { throw 'FFmpeg checksum mismatch. Archive was not executed.' }
    Expand-Archive -LiteralPath $taskZip -DestinationPath $taskFFDir
}
$taskModel = & $taskPython (Join-Path $taskRoot 'engine\prepare-model.py') (Join-Path $taskHome 'models\faster-whisper-small')
if ($LASTEXITCODE -ne 0) { throw 'Speech model preparation failed. It requires a cached model or access to Hugging Face.' }
$taskModel = ($taskModel | Select-Object -Last 1).Trim()
$taskConfig = @{
    node=$taskNode; hypit=(Join-Path $taskRoot 'runtime\node_modules\@hypit\hypit\bin\hypit.mjs')
    python=$taskPython; modelPath=$taskModel; ffmpeg=$taskFFmpeg
    ffprobe=(Join-Path $taskFFDir "$taskFFVersion\bin\ffprobe.exe")
}
$taskJson = $taskConfig | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $taskConfigDir 'engine.json'),$taskJson,(New-Object Text.UTF8Encoding $false))
& $taskNode $taskConfig.hypit version
if ($LASTEXITCODE -ne 0) { throw 'Hypit startup check failed.' }
Write-Host 'Setup completed. Run node tools/start-local.mjs to open the local workbench.'

