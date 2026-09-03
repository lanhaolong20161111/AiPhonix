# AiPhonix 全自动部署（等待登录 → 建资源 → 灌数据 → 传密钥 → 上线 → 冒烟）
# 日志：deploy_status.txt（桌面）+ deploy_log.txt（server_cf）
$ErrorActionPreference = "Continue"
$cf = "C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_cf"
$desktop = [Environment]::GetFolderPath("Desktop")
$statusFile = Join-Path $desktop "部署状态.txt"
$logFile = Join-Path $cf "deploy_log.txt"
$urlFile = Join-Path $desktop "点这里登录Cloudflare.txt"

function Log($msg) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
  Add-Content -Path $statusFile -Value $line -Encoding UTF8
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}
Set-Content -Path $statusFile -Value "AiPhonix 部署状态（自动更新）" -Encoding UTF8
Set-Location $cf

# ── 阶段 1：轮询登录（每次重试都刷新桌面上的授权链接）──
$loginDeadline = (Get-Date).AddMinutes(60)   # 最晚 01:22 左右停止等登录
$loggedIn = $false
while ((Get-Date) -lt $loginDeadline) {
  $who = (npx wrangler whoami 2>$null | Out-String)
  if ($who -match "You are logged in") { $loggedIn = $true; Log "登录成功"; break }
  Log "启动新一轮 wrangler login（等待浏览器授权）"
  $p = Start-Process -FilePath "npx.cmd" -ArgumentList "wrangler","login" -WorkingDirectory $cf -PassThru -WindowStyle Hidden -RedirectStandardOutput "$cf\login_auto_out.txt" -RedirectStandardError "$cf\login_auto_err.txt"
  Start-Sleep -Seconds 7
  # 把最新授权链接写到桌面
  $raw = (Get-Content "$cf\login_auto_err.txt" -Raw -ErrorAction SilentlyContinue) + (Get-Content "$cf\login_auto_out.txt" -Raw -ErrorAction SilentlyContinue)
  $m = [regex]::Match($raw, "https://dash\.cloudflare\.com/oauth2/auth\S+")
  if ($m.Success) {
    Set-Content -Path $urlFile -Value "打开下面的链接，登录 Cloudflare 后点 Allow（每个链接约5分钟有效，本文件会自动刷新为最新链接）：`r`n`r`n$($m.Value)" -Encoding UTF8
    Log "已刷新桌面授权链接"
  }
  # 等这个 login 进程（最多 5.5 分钟），期间轮询 whoami
  while (-not $p.HasExited) {
    Start-Sleep -Seconds 5
    $w2 = (npx wrangler whoami 2>$null | Out-String)
    if ($w2 -match "You are logged in") { $loggedIn = $true; break }
  }
  if (-not $loggedIn) {
    $w3 = (npx wrangler whoami 2>$null | Out-String)
    if ($w3 -match "You are logged in") { $loggedIn = $true }
  }
  if ($loggedIn) { Log "登录成功"; break }
}
if (-not $loggedIn) { Log "到截止时间仍未登录（你不在电脑前）。部署未开始，下次开机后说『继续部署』即可全自动完成。"; exit 1 }

# ── 阶段 2：创建 D1 ──
Log "创建 D1 数据库 aiphonix-db ..."
$d1out = (npx wrangler d1 create aiphonix-db 2>&1 | Out-String)
Add-Content $logFile $d1out
$dbid = [regex]::Match($d1out, "database_id\s*=\s*['`"]?([0-9a-f\-]{36})").Groups[1].Value
if (-not $dbid) { $dbid = [regex]::Match($d1out, "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})").Groups[1].Value }
if (-not $dbid) { Log "FATAL: 未拿到 database_id，停止"; exit 1 }
Log "database_id = $dbid"
# 写入 wrangler.toml
$toml = Get-Content "$cf\wrangler.toml" -Raw -Encoding UTF8
$toml = $toml -replace "database_id\s*=\s*['`"]?00000000-0000-0000-0000-000000000000['`"]?", "database_id = `"$dbid`""
$toml = $toml -replace "database_id\s*=\s*['`"]?[0-9a-f\-]{36}['`"]?(?!.*=.*$)", "database_id = `"$dbid`""
Set-Content "$cf\wrangler.toml" -Value $toml -Encoding UTF8 -NoNewline
Log "wrangler.toml 已更新"

# ── 阶段 3：创建 R2 ──
Log "创建 R2 桶 aiphonix-files ..."
$r2out = (npx wrangler r2 bucket create aiphonix-files 2>&1 | Out-String)
Add-Content $logFile $r2out
if ($r2out -match "already exists|成功|created") { Log "R2 桶就绪" }
elseif ($r2out -match "requires|billing|payment|charge|subscription") { Log "FATAL: R2 需要开通付费/绑卡（疑似欠费场景），停止。日志见 deploy_log.txt"; exit 2 }
else { Log "R2 创建结果不确定，继续（详见 deploy_log.txt）" }

# ── 阶段 4：D1 结构 + 数据 ──
Log "应用数据库结构（migrations --remote）..."
$mig = (npx wrangler d1 migrations apply aiphonix-db --remote 2>&1 | Out-String)
Add-Content $logFile $mig
Log "结构迁移完成"
$i = 0
foreach ($f in @("data_001.sql","data_002.sql","data_003.sql","data_004.sql")) {
  $i++
  Log "导入数据 $f ..."
  $ex = (npx wrangler d1 execute aiphonix-db --remote --file "migrations/_data/$f" -y 2>&1 | Out-String)
  Add-Content $logFile $ex
  if ($LASTEXITCODE -ne 0) { Log "WARN: $f 导入退出码 $LASTEXITCODE（继续）" } else { Log "数据 $f 完成" }
}

# ── 阶段 5：secrets ──
Log "上传 secrets（10 个，值不回显）..."
$sec = (npx wrangler secret bulk secrets_bulk.json 2>&1 | Out-String)
Add-Content $logFile $sec
Log "secrets 完成"
Remove-Item "$cf\secrets_bulk.json" -Force -ErrorAction SilentlyContinue

# ── 阶段 6：部署 ──
Log "wrangler deploy ..."
$dep = (npx wrangler deploy 2>&1 | Out-String)
Add-Content $logFile $dep
$url = [regex]::Match($dep, "https://[a-z0-9\-\.]*workers\.dev\S*").Value
if ($url) { Log "上线地址: $url" } else { Log "部署完成但未解析到 workers.dev 地址（见 deploy_log.txt）" }

# ── 阶段 7：冒烟 ──
if ($url) {
  Start-Sleep -Seconds 8
  try {
    $h = (Invoke-WebRequest -Uri "$url/health" -UseBasicParsing -TimeoutSec 30).Content
    Log "线上 /health => $h"
  } catch { Log "线上 /health 请求失败: $($_.Exception.Message)（可能仍在生效中，稍后手动验证）" }
}

# ── 阶段 8：R2 媒体上传（后台继续，可能跑不完 2 小时，可断点续传）──
Log "开始 R2 媒体上传（data→extra→static→apk 顺序，日志 r2_upload_log.txt）"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$cf\scripts\upload_r2.ps1" -Groups data,extra,static,apk *> "$cf\r2_upload_log.txt"
Log "媒体上传脚本结束（是否全部完成见 r2_upload_log.txt 尾部）"
Log "全部自动流程结束。"
