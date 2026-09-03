# AiPhonix R2 媒体种子上传脚本
# 用法（部署阶段、wrangler login 后）：
#   powershell -File scripts\upload_r2.ps1 -DryRun     # 预览要上传的文件与 key
#   pwsh -File scripts\upload_r2.ps1                  # 实际上传（远端 R2）
#   pwsh -File scripts\upload_r2.ps1 -Local           # 上传到本地 dev R2（miniflare）
#   pwsh -File scripts\upload_r2.ps1 -Groups data,static,extra
#
# 分组：
#   data   = shared/data 下的媒体与 JSON（char_images/ai_chinese_images/uploads/缓存/索引等）
#   static = shared/static（web 构建产物 / letter_clips / videos）
#   apk    = shared/downloads/AiPhonix.apk
#   extra  = web/public/chinese_wordbank.json → data/chinese_wordbank.json（chinese_practice 依赖）
# 排除：*.db *.db-wal *.db-shm backups/ checkpoints/ *.tmp（数据库走 D1 迁移，不进 R2）
param(
  [string[]]$Groups = @("data", "static", "apk", "extra"),
  [switch]$Local,
  [switch]$DryRun,
  [int]$Shard = 0,
  [int]$Shards = 1
)

# stderr 警告不能中断循环（PS5.1 下 2>&1 会把 stderr 变终止错误），用退出码判断失败
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path   # → AiPhonix
$Bucket = "aiphonix-files"
$flag = if ($Local) { "--local" } else { "" }

$Mime = @{
  ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".png"="image/png"; ".webp"="image/webp"; ".gif"="image/gif"
  ".svg"="image/svg+xml"; ".ico"="image/x-icon"
  ".mp4"="video/mp4"; ".webm"="video/webm"; ".mov"="video/quicktime"
  ".mp3"="audio/mpeg"; ".m4a"="audio/mp4"; ".wav"="audio/wav"
  ".json"="application/json"; ".html"="text/html; charset=utf-8"; ".js"="application/javascript"
  ".css"="text/css"; ".txt"="text/plain"; ".wasm"="application/wasm"
  ".woff"="font/woff"; ".woff2"="font/woff2"; ".apk"="application/vnd.android.package-archive"
}

function Get-Files($dir) {
  if (-not (Test-Path $dir)) { return @() }
  Get-ChildItem $dir -Recurse -File | Where-Object {
    $_.Name -notmatch '\.(db|db-wal|db-shm|tmp)$' -and
    $_.FullName -notmatch '\\(backups|checkpoints)\\'
  }
}

$jobs = @()
if ($Groups -contains "data")   { $jobs += Get-Files (Join-Path $Root "shared\data") | ForEach-Object { @{ File=$_; Key = "data/" + $_.FullName.Substring((Join-Path $Root "shared\data").Length + 1).Replace("\","/") } } }
if ($Groups -contains "static") { $jobs += Get-Files (Join-Path $Root "shared\static") | ForEach-Object { @{ File=$_; Key = "static/" + $_.FullName.Substring((Join-Path $Root "shared\static").Length + 1).Replace("\","/") } } }
if ($Groups -contains "apk") {
  $apk = Join-Path $Root "shared\downloads\AiPhonix.apk"
  if (Test-Path $apk) { $jobs += @{ File = (Get-Item $apk); Key = "downloads/AiPhonix.apk" } }
}
if ($Groups -contains "extra") {
  $wb = Join-Path $Root "web\public\chinese_wordbank.json"
  if (Test-Path $wb) { $jobs += @{ File = (Get-Item $wb); Key = "data/chinese_wordbank.json" } }
}

Write-Host "共 $($jobs.Count) 个文件待上传到 R2 bucket '$Bucket'$(if($Local){'（本地 dev）'})"
$total = ($jobs | ForEach-Object { $_.File.Length } | Measure-Object -Sum).Sum
Write-Host ("总大小: {0:N1} MB" -f ($total / 1MB))

$i = 0
$mine = @()
for ($k = $Shard; $k -lt $jobs.Count; $k += $Shards) { $mine += $jobs[$k] }
Write-Host "分片 $Shard/$Shards 负责 $($mine.Count) 个文件"
foreach ($j in $mine) {
  $i++
  $ext = [System.IO.Path]::GetExtension($j.Key).ToLower()
  $ct = $Mime[$ext]
  $putArgs = @("r2", "object", "put", "$Bucket/$($j.Key)", "--file", $j.File.FullName, "--remote")
  if ($ct) { $putArgs += @("--content-type", $ct) }
  if ($Local) { $putArgs += "--local" }
  if ($DryRun) {
    Write-Host ("[{0}/{1}] {2}  ({3:N1} KB){4}" -f $i, $mine.Count, $j.Key, ($j.File.Length / 1KB), $(if($ct){" [$ct]"}))
    continue
  }
  Write-Host ("[{0}/{1}] 上传 {2}..." -f $i, $mine.Count, $j.Key)
  & wrangler @putArgs 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Warning "失败: $($j.Key)" }
}
Write-Host "完成。"
