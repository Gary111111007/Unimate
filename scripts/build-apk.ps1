# Unimate：一条命令产出可安装 APK（PRD F14 / AC-34~AC-38），并强制校验包内容确实是本次构建
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1
$ErrorActionPreference = "Stop"
# 用 .NET 计算 SHA256，不依赖 Get-FileHash —— 后者在部分 PowerShell 宿主的
# 非交互/重定向场景下会 CommandNotFoundException，导致校验步骤整体失败。
function Get-Sha256([string]$path) {
  $fs = [IO.File]::OpenRead($path)
  try { $sha = [Security.Cryptography.SHA256]::Create(); (($sha.ComputeHash($fs) | ForEach-Object { $_.ToString('X2') }) -join '') }
  finally { $fs.Dispose() }
}


# PowerShell 5.1 下原生命令返回非零退出码不会触发 Stop —— 测试全红也照样出包，
# 这就是"假绿灯"。每条 npm 步骤都必须显式看 $LASTEXITCODE。
function Invoke-Npm([string]$name) {
  npm run $name | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "npm run $name 失败（exit=$LASTEXITCODE），已中止出包" }
}
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
Write-Host "[1/6] 单元测试：登录链路 + 解析器 Golden Test + 考试解析 Golden Test + 备份容器格式 + 提醒时刻过桥契约 + 课表配色一致性 + 启动防挂起 + 声明顺序地雷 + 启动路径不变量 + 模板引用 + CSS 变量 + 手册条款完整性 + 工具箱位置几何 + 版权署名 + 手势去重"
Invoke-Npm 'test:login'
Invoke-Npm 'test:parser'
Invoke-Npm 'test:exam'
Invoke-Npm 'test:zip'
Invoke-Npm 'test:notify'
Invoke-Npm 'test:color'
Invoke-Npm 'test:guard'
Invoke-Npm 'test:order'
Invoke-Npm 'test:boot'
Invoke-Npm 'test:refs'
Invoke-Npm 'test:css'
Invoke-Npm 'test:handbook'
Invoke-Npm 'test:toolbox'
Invoke-Npm 'test:watermark'
Invoke-Npm 'test:gesture'

Write-Host ""
Write-Host "[2/6] 构建 Web 产物"
Invoke-Npm 'build'
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
Write-Host ("SHA-256 : {0}" -f (Get-Sha256 $apk))

Write-Host ""
Write-Host "[6/6] 完整性校验（防止装到手机的是旧包 / 被改过的包）"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($tmp)
$allEntries = @($zip.Entries)
$names = @($allEntries | ForEach-Object { $_.FullName })
# 注意：必须保留 ZipFileEntry 对象。早先写成 ForEach FullName 展平成字符串，
# 再对字符串调 .Open() 会直接 InvalidOperation，整个校验步骤失败。
$pkgJs = @($allEntries | Where-Object { $_.FullName -like "assets/public/assets/index-*.js" })
$okBundle = @($pkgJs | ForEach-Object { $_.FullName.Split("/")[-1] }) -contains $distJs.Name
$hasSample = $names -contains "assets/public/sample-timetable.html"
$match = $false
foreach ($e in $pkgJs) {
  if ($e.FullName.Split("/")[-1] -ne $distJs.Name) { continue }
  $ms = New-Object IO.MemoryStream
  $st = $e.Open(); $st.CopyTo($ms); $st.Close(); $ms.Close()
  $p2 = Join-Path $env:TEMP "apk-bundle.js"
  [IO.File]::WriteAllBytes($p2, $ms.ToArray())
  $match = (Get-Sha256 $p2) -eq (Get-Sha256 $distJs.FullName)
}
$zip.Dispose()
# 手写清单/资源配置也要验在包里：这两处不在 dist 流水线内，换机或误删 android/ 后最容易丢
$aaptExe = Join-Path $sdk "build-tools\34.0.0\aapt.exe"
$manXml = & $aaptExe dump xmltree $tmp AndroidManifest.xml 2>&1
$fpXml  = & $aaptExe dump xmltree $tmp res/xml/file_paths.xml 2>&1
$hasExact = @($manXml | Select-String 'SCHEDULE_EXACT_ALARM').Count -gt 0
$hasNotif = @($manXml | Select-String 'POST_NOTIFICATIONS').Count -gt 0
$hasFilesPath = @($fpXml | Select-String 'files-path').Count -gt 0
# 版权署名三层都要在包里（AGENTS.md：真实姓名只允许出现在版权水印里）
#   ① JS chunk / index.html 首尾注释（由 vite banner/footer 注入）
#   ② Android 字符串资源 app_authors / app_copyright（resources.arsc）
#   ③ assets/COPYRIGHT.txt（独立于会被 cap sync 覆盖的 assets/public）
$hasNoticeFile = $names -contains "assets/COPYRIGHT.txt"
$hasBannerMark = (Select-String -LiteralPath $p2 -Pattern '果崇舜' -SimpleMatch -Encoding UTF8 -Quiet) -eq $true
$resXml = & $aaptExe dump resources $tmp 2>&1
$hasAuthorRes = @($resXml | Select-String 'app_authors').Count -gt 0
Write-Host ("  bundle 名称一致 : {0}" -f $okBundle)
Write-Host ("  bundle 内容一致 : {0}" -f $match)
Write-Host ("  内置脱敏样本    : {0}" -f $hasSample)
Write-Host ("  精确闹钟权限    : {0}" -f $hasExact)
Write-Host ("  通知权限        : {0}" -f $hasNotif)
Write-Host ("  FileProvider路径: {0}" -f $hasFilesPath)
Write-Host ("  版权署名(bundle): {0}" -f $hasBannerMark)
Write-Host ("  版权署名(资源)  : {0}" -f $hasAuthorRes)
Write-Host ("  版权署名(文件)  : {0}" -f $hasNoticeFile)
# 源码新鲜度断言：dist 必须由**当前**源码构建。
# 真实教训：曾手跑 cap sync + gradle 而漏掉 npm run build，导致 APK 与 dist 一致、
# 却比源码旧一整轮改动 —— 单靠"APK==dist"抓不到，必须再比一层。
$srcExe = Get-ChildItem src, (Join-Path $root "android\app\src\main\java"), (Join-Path $root "android\app\src\main\res") -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'assets\\public' -and $_.Name -notin @('config.xml','strings.xml') } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$stale = $srcExe -and ($srcExe.LastWriteTime -gt $distJs.LastWriteTime)
Write-Host ("  源码未晚于 dist : {0}" -f $(if ($stale) { "否 —— 最新源文件 $($srcExe.Name) 比 dist 新，dist 已过期！" } else { "通过" }))

& (Join-Path $sdk "build-tools\34.0.0\apksigner.bat") verify $tmp
Write-Host ("  apksigner verify: {0}" -f $(if ($LASTEXITCODE -eq 0) { "通过" } else { "失败" }))
& (Join-Path $sdk "build-tools\34.0.0\aapt.exe") dump badging $tmp |
  Select-String -Pattern "^package:|^sdkVersion|^targetSdkVersion|^launchable-activity|^uses-permission" |
  ForEach-Object { Write-Host "  $($_.Line)" }

if (-not ($okBundle -and $match -and $hasSample -and $hasExact -and $hasNotif -and $hasFilesPath -and $hasBannerMark -and $hasAuthorRes -and $hasNoticeFile -and (-not $stale) -and $LASTEXITCODE -eq 0)) {
  throw "完整性校验未通过：APK 内容与本次源码构建不一致，请勿安装此包"
}
Write-Host ""
Write-Host "校验通过，可安装：adb install -r artifacts\android\unimate-debug.apk"
