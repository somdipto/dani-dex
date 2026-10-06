# Dani-Dex Windows installer. Run with -NoLaunch to skip the launcher.
param([switch]$NoLaunch, [switch]$DryRun)
$ErrorActionPreference = 'Stop'

$Repo = 'somdipto/dani-dex'
$ReleaseRoot = if ($env:DANI_DEX_ONBOARD_RELEASE_ROOT) {
  $env:DANI_DEX_ONBOARD_RELEASE_ROOT
} else {
  "https://github.com/$Repo/releases/latest/download"
}
$Arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($Arch -ne 'AMD64') { throw 'Dani-Dex requires x64 Windows.' }
if ($DryRun) {
  Write-Host "Plan: verify $ReleaseRoot/SHA256SUMS-windows.txt, then run the per-user installer."
  return
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("dani-dex-onboard-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $TempDir | Out-Null
try {
  $Sums = (Invoke-WebRequest -Uri "$ReleaseRoot/SHA256SUMS-windows.txt" -UseBasicParsing -TimeoutSec 30).Content
  $Entries = @($Sums -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_.EndsWith('.exe') })
  if ($Entries.Count -ne 1) {
    throw 'Release checksums must contain one valid Windows artifact. Not installing.'
  }
  if ($Entries[0] -cmatch '^([a-fA-F0-9]{64})[ \t]+\*?(Dani-Dex-[A-Za-z0-9._-]+-x64\.exe)$') {
    $Expected = $Matches[1].ToLowerInvariant()
    $Asset = $Matches[2]
  } else { throw 'Invalid Windows checksum entry. Not installing.' }
  $Installer = Join-Path $TempDir $Asset
  Write-Host "Downloading Dani-Dex ($Asset)"
  Invoke-WebRequest -Uri "$ReleaseRoot/$Asset" -OutFile $Installer -UseBasicParsing -TimeoutSec 300
  $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Installer).Hash.ToLowerInvariant()
  if ($Expected -ne $Actual) { throw 'Checksum mismatch. Not installing.' }

  Write-Host 'Running the verified installer.'
  $Installed = Start-Process -FilePath $Installer -Wait -PassThru
  if ($Installed.ExitCode -ne 0) { throw "Installer failed ($($Installed.ExitCode))." }
  $AppExe = Join-Path $env:LOCALAPPDATA 'Programs\Dani-Dex\Dani-Dex.exe'
  if (-not $NoLaunch) {
    if (Test-Path -LiteralPath $AppExe) { Start-Process -FilePath $AppExe }
    else { Write-Host 'Open Dani-Dex from the Start Menu.' }
  }
  Write-Host 'Installed. Open Dani-Dex to complete setup.'
} finally {
  Remove-Item -LiteralPath $TempDir -Recurse -Force
}
