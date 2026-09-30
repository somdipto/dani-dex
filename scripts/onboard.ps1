# Dani-Dex one-command onboarding for Windows.
#
#   irm https://raw.githubusercontent.com/somdipto/dani-dex/main/scripts/onboard.ps1 | iex
#
# Paste that single line into PowerShell. It downloads the newest Dani-Dex release
# from GitHub, runs the installer and opens the app so onboarding starts.
# macOS, Linux and WSL use the bash version instead (see README).
$ErrorActionPreference = 'Stop'

$Repo  = 'somdipto/dani-dex'
$Asset = 'Dani-Dex-windows-x64.exe'
$Url   = "https://github.com/$Repo/releases/latest/download/$Asset"

function Step($Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Ok($Message)   { Write-Host " ok  $Message" -ForegroundColor Green }
function Warn($Message) { Write-Host "warn $Message" -ForegroundColor Yellow }

Write-Host ''
Write-Host '  Dani-Dex setup' -ForegroundColor Cyan
Write-Host '  Your own AI team, on your own computer.'
Write-Host ''

Step "Downloading Dani-Dex ($Asset)"
Write-Host "  $Url" -ForegroundColor DarkGray
$Installer = Join-Path $env:TEMP $Asset
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $Url -OutFile $Installer -UseBasicParsing
Ok 'downloaded'

Step 'Verifying the download'
$SumsUrl = "https://github.com/$Repo/releases/latest/download/SHA256SUMS-windows.txt"
try {
  $Sums = (Invoke-WebRequest -Uri $SumsUrl -UseBasicParsing).Content
  $Line = ($Sums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($Asset))$" }) | Select-Object -First 1
  if ($Line) {
    $Expected = ($Line -split '\s+')[0].ToLower()
    $Actual = (Get-FileHash -Algorithm SHA256 $Installer).Hash.ToLower()
    if ($Expected -ne $Actual) { throw "checksum mismatch - the download is corrupt or tampered with. Try again." }
    Ok 'checksum verified'
  } else {
    Warn 'this release has no checksum entry yet - continuing without verification.'
  }
} catch {
  if ($_.Exception.Message -match 'checksum mismatch') { throw }
  Warn 'could not fetch the checksum file - continuing without verification.'
}

Step 'Running the installer'
Write-Host '  If a blue SmartScreen window appears, click "More info", then "Run anyway".'
Start-Process -FilePath $Installer -Wait
$AppExe = Join-Path $env:LOCALAPPDATA 'Programs\Dani-Dex\Dani-Dex.exe'
if (Test-Path $AppExe) {
  Step 'Opening Dani-Dex'
  Start-Process $AppExe
  Ok 'launched'
} else {
  Write-Host 'Open Dani-Dex from the Start Menu when you are ready.'
}

Write-Host ''
Write-Host 'Done. ' -ForegroundColor Green -NoNewline
Write-Host 'Onboarding starts the first time Dani-Dex opens:'
Write-Host '  1. Pick an AI - OpenCode''s free models work right away, no account needed.'
Write-Host '  2. For ChatGPT, Claude or Grok, click Connect and sign in with that service.'
Write-Host '  3. Tell the Chief agent what you want done.'
Write-Host ''
