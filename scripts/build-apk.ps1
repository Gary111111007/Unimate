# Unimate：一条命令产出可安装 APK（PRD F14 / AC-34~AC-38），并强制校验包内容确实是本次构建
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$jdk = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Android\jdk17") -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not (Test-Path $sdk)) { throw "找不到 Android SDK：$sdk，请先运行 scripts\setup-android-toolchain.ps1" }
if (-not $jdk) { throw "找不到 JDK 17，请先运行 scripts\setup-android-toolchain.ps1" }

$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$($jdk.FullName)\bin;$env:Path"
Write-Host "JAVA_HOME    = $env:JAVA_HOME"
Write-Host "ANDROID_HOME = $sdk"

Write-Host ""
Write-Host "[1/6] 单元测试：登录链路 + 解析器 Golden Test + 备份容器格式"
npm run test:login | Out-Host
npm run test:parser | Out-Host
npm run test:zip | Out-Host

Write-Host ""
Write-Host "[2/6] 构建 Web 产物"
npm run build | Out-Host
$distJs = (Get-ChildItem "$root\dist\assets" -Filter "index-*.js" | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
if (-not $distJs) { throw "dist 里没有 index-*.js，Web 构建失败" }
Write-Host ("  本次 bundle : {0}" -f $distJs.Name)

Write-Host ""
Write-Host "[3/6] 同步到 Android 工程（先清掉旧的 assets 与构建中间产物，避免打进过期 bundle）"
npx cap sync android | Out-Host
Remove-Item -Recurse -Force "$root\android\app\build\intermediates\assets" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$root\android\app\build\outputs\apk" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "[4/6] Gradle assembleDebug"
Push-Location (Join-Path $root "android")
.\gradlew.bat assembleDebug --console=plain | Out-Host
Pop-Location

Write-Host ""
Write-Host "[5/6] 归档"
$outDir = Join-Path $root "artifacts\android"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$apk = Join-Path $outDir "unimate-debug.apk"
Copy-Item (Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk") $apk -Force
$tmp = Join-Path $env:TEMP "unimate-debug.apk"
Copy-Item $apk $tmp -Force
Write-Host ("APK     : {0}" -f $apk)
Write-Host ("Size    : {0:N2} MB" -f ((Get-Item $apk).Length / 1MB))
Write-Host ("SHA-256 : {0}" -f (Get-FileHash -Algorithm SHA256 $apk).Hash)

Write-Host ""
Write-Host "[6/6] 完整性校验（防止装到手机的是旧包 / 被改过的包）"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($tmp)
$entries = $zip.Entries | ForEach-Object { $_.FullName }
$pkgJs = $entries | Where-Object { $_ -like "assets/public/assets/index-*.js" }
$okBundle = @($pkgJs | ForEach-Object { $_.Split("/")[-1] }) -contains $distJs.Name
$hasSample = $entries -contains "assets/public/sample-timetable.html"
# 逐个比对 bundle 内容哈希
$match = $false
foreach ($e in $pkgJs) {
  if ($e.Split("/")[-1] -ne $distJs.Name) { continue }
  $ms = New-Object IO.MemoryStream
  $st = $e.Open(); $st.CopyTo($ms); $st.Close()
  $p = Join-Path $env:TEMP "apk-bundle.js"
  [IO.File]::WriteAllBytes($p, $ms.ToArray())
  $match = (Get-FileHash -Algorithm SHA256 $p).Hash -eq (Get-FileHash -Algorithm SHA256 $distJs.FullName).Hash
}
$zip.Dispose()
Write-Host ("  bundle 名称一致 : {0}" -f $okBundle)
Write-Host ("  bundle 内容一致 : {0}" -f $match)
Write-Host ("  内置脱敏样本    : {0}" -f $hasSample)

& (Join-Path $sdk "build-tools\34.0.0\apksigner.bat") verify $tmp
Write-Host ("  apksigner verify: {0}" -f $(if ($LASTEXITCODE -eq 0) { "通过" } else { "失败" }))
& (Join-Path $sdk "build-tools\34.0.0\aapt.exe") dump badging $tmp |
  Select-String -Pattern "^package:|^sdkVersion|^targetSdkVersion|^launchable-activity|^uses-permission" |
  ForEach-Object { Write-Host "  $($_.Line)" }

if (-not ($okBundle -and $match -and $hasSample -and $LASTEXITCODE -eq 0)) {
  throw "完整性校验未通过：APK 内容与本次源码构建不一致，请勿安装此包"
}
Write-Host ""
Write-Host "校验通过，可安装：adb install -r artifacts\android\unimate-debug.apk"