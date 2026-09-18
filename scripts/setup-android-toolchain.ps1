# Unimate - Android build toolchain bootstrap (idempotent, no admin required)
# Installs JDK 17 + Android cmdline-tools + platform-tools + platforms;android-34 + build-tools;34.0.0
$ErrorActionPreference = 'Continue'   # native tools write to stderr; explicit Test-Path/throw checks below do the real gating
$ProgressPreference = 'SilentlyContinue'

$root    = Join-Path $env:LOCALAPPDATA 'Android'
$sdk     = Join-Path $root 'Sdk'
$jdkRoot = Join-Path $root 'jdk17'
$tmp     = Join-Path $env:TEMP 'unimate-toolchain'
New-Item -ItemType Directory -Force -Path $root, $tmp | Out-Null

function Step($m) { Write-Host "`n=== $m ===" }

# ---------------- JDK 17 ----------------
Step 'JDK 17'
$javaBin = Get-ChildItem -Path $jdkRoot -Filter 'java.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($javaBin) {
  $jdkHome = $javaBin.Directory.Parent.FullName
  Write-Host "already installed: $jdkHome"
} else {
  $jdkZip = Join-Path $tmp 'jdk17.zip'
  $urls = @(
    'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse',
    'https://aka.ms/download-JDK/microsoft-JDK-17.0.13-windows-x64.zip'
  )
  $ok = $false
  foreach ($u in $urls) {
    try { Write-Host "downloading $u"; Invoke-WebRequest -Uri $u -OutFile $jdkZip -UseBasicParsing -TimeoutSec 1800; $ok = $true; break }
    catch { Write-Host ("  failed: " + $_.Exception.Message.Split([char]10)[0]) }
  }
  if (-not $ok) { throw 'JDK download failed from all sources' }
  Write-Host ("downloaded {0:N1} MB" -f ((Get-Item $jdkZip).Length / 1MB))
  Expand-Archive -LiteralPath $jdkZip -DestinationPath $jdkRoot -Force
  $javaBin = Get-ChildItem -Path $jdkRoot -Filter 'java.exe' -Recurse | Select-Object -First 1
  $jdkHome = $javaBin.Directory.Parent.FullName
}
$jexe = Join-Path $jdkHome 'bin\java.exe'
& $jexe -version 2>&1 | ForEach-Object { Write-Host ('  ' + $_) }

# ---------------- Android cmdline-tools ----------------
Step 'Android cmdline-tools'
$sdkMgr = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if (Test-Path $sdkMgr) {
  Write-Host "already installed: $sdkMgr"
} else {
  $candidates = @(
    'commandlinetools-win-11076708_latest.zip',
    'commandlinetools-win-10406996_latest.zip',
    'commandlinetools-win-9477386_latest.zip',
    'commandlinetools-win-8512546_latest.zip'
  )
  $zip = $null
  foreach ($c in $candidates) {
    $u = "https://dl.google.com/android/repository/$c"
    try {
      Invoke-WebRequest -Uri $u -Method Head -UseBasicParsing -TimeoutSec 60 | Out-Null
      Write-Host "using $u"
      $zip = Join-Path $tmp $c
      Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing -TimeoutSec 1800
      break
    } catch { Write-Host ("  skip $c : " + $_.Exception.Message.Split([char]10)[0]) }
  }
  if (-not $zip) { throw 'no cmdline-tools package reachable' }
  Write-Host ("downloaded {0:N1} MB" -f ((Get-Item $zip).Length / 1MB))
  $ex = Join-Path $tmp 'cmdline-extract'
  if (Test-Path $ex) { Remove-Item -LiteralPath $ex -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $ex -Force
  New-Item -ItemType Directory -Force -Path (Join-Path $sdk 'cmdline-tools') | Out-Null
  $latest = Join-Path $sdk 'cmdline-tools\latest'
  if (Test-Path $latest) { Remove-Item -LiteralPath $latest -Recurse -Force }
  Move-Item -LiteralPath (Join-Path $ex 'cmdline-tools') $latest
}

# ---------------- SDK packages ----------------
Step 'SDK packages'
$env:JAVA_HOME = $jdkHome
$env:Path = (Join-Path $jdkHome 'bin') + ';' + $env:Path
(1..40 | ForEach-Object { 'y' }) | & $sdkMgr --sdk_root=$sdk --licenses 2>&1 | Select-Object -Last 2 | ForEach-Object { Write-Host "  $_" }
$pkgs = @('platform-tools', 'platforms;android-34', 'build-tools;34.0.0')
foreach ($pkg in $pkgs) {
  if ($pkg -match ';') { $n, $v = $pkg.Split(';'); $probe = Join-Path $sdk "$n\$v" }
  else { $probe = Join-Path $sdk $pkg }
  if (Test-Path $probe) { Write-Host "already present: $pkg"; continue }
  Write-Host "installing $pkg ..."
  $out = (1..40 | ForEach-Object { 'y' }) | & $sdkMgr --sdk_root=$sdk --install $pkg 2>&1
  $out | Select-Object -Last 3 | ForEach-Object { Write-Host "  $_" }
  if (-not (Test-Path $probe)) { throw "install failed for $pkg" }
}

Step 'Verify'
foreach ($p in @('platform-tools\adb.exe','platforms\android-34\android.jar','build-tools\34.0.0\aapt.exe','build-tools\34.0.0\apksigner.bat')) {
  "{0,-46} {1}" -f $p, (Test-Path (Join-Path $sdk $p))
}

Step 'Persist user environment variables'
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $sdk, 'User')
[Environment]::SetEnvironmentVariable('JAVA_HOME_17', $jdkHome, 'User')
$cur = [Environment]::GetEnvironmentVariable('Path', 'User')
foreach ($a in @((Join-Path $sdk 'platform-tools'), (Join-Path $sdk 'cmdline-tools\latest\bin'))) {
  if ($cur -notlike "*$a*") { $cur = "$cur;$a" }
}
[Environment]::SetEnvironmentVariable('Path', $cur, 'User')
Write-Host "ANDROID_HOME = $sdk"
Write-Host "JAVA_HOME_17 = $jdkHome"
Write-Host 'DONE'
