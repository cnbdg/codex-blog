$ErrorActionPreference = "Stop"

$sourceRoot = "https://xsf.indevs.in"
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectRoot "legacy-posts.js"

function Read-Utf8Page([string]$url) {
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45
  return [Text.Encoding]::UTF8.GetString(
    [Text.Encoding]::GetEncoding(28591).GetBytes($response.Content)
  )
}

function Get-Excerpt([string]$html, [int]$maximum, [string]$fallback) {
  $plain = [Net.WebUtility]::HtmlDecode(($html -replace "<[^>]+>", " "))
  $plain = ($plain -replace "\s+", " ").Trim()
  if (-not $plain) { return $fallback }
  if ($plain.Length -le $maximum) { return $plain }
  return $plain.Substring(0, $maximum).TrimEnd() + "…"
}

function Get-Classification([string]$title) {
  if ($title -match "(?i)hypixel") {
    return @{ Type = "游戏"; Tags = @("游戏", "Hypixel", "指令") }
  }
  if ($title -match "(?i)markdown|编辑技巧") {
    return @{ Type = "教程"; Tags = @("Markdown", "写作", "教程") }
  }
  if ($title -match "诗经|马说|北冥有鱼|说文解字") {
    return @{ Type = "学习"; Tags = @("学习", "语文", "阅读") }
  }
  if ($title -match "(?i)homework|作业|听写|作文") {
    return @{ Type = "学习"; Tags = @("学习", "作业") }
  }
  return @{ Type = "日常"; Tags = @("日常", "记录") }
}

$dateByUrl = @{}
foreach ($archivePath in @("/archives/", "/archives/page/2/")) {
  $archive = (Invoke-WebRequest -Uri ($sourceRoot + $archivePath) -UseBasicParsing -TimeoutSec 45).Content
  $yearMatch = [regex]::Match($archive, '<p class="h5">(\d{4})</p>')
  if (-not $yearMatch.Success) { continue }
  $year = $yearMatch.Groups[1].Value
  $pattern = '<a href="([^"]+\.html)" class="list-group-item[^>]*>\s*<time>(\d{2}-\d{2})</time>'
  foreach ($match in [regex]::Matches($archive, $pattern)) {
    $dateByUrl[$match.Groups[1].Value] = "$year-$($match.Groups[2].Value)"
  }
}

[xml]$search = Read-Utf8Page "$sourceRoot/local-search.xml"
$posts = foreach ($entry in @($search.search.entry)) {
  $title = [string]$entry.title
  $url = [string]$entry.url
  $body = [string]$entry.content.'#cdata-section'
  if (-not $body) {
    $body = "<p>这篇文章从旧博客迁移，原页面没有正文内容。</p>"
  }
  $body = $body -replace '(?i)<a[^>]*class="headerlink"[^>]*></a>', ""
  $body = $body -replace '(?i)(src|href)="/(?!/)', ('$1="' + $sourceRoot + '/')
  $sourceUrl = $sourceRoot + $url
  $body += "<blockquote><p>本文从旧博客迁移。<a href=`"$sourceUrl`">查看原文</a></p></blockquote>"

  $classification = Get-Classification $title
  $description = Get-Excerpt $body 220 $title
  $lead = Get-Excerpt $body 320 "从旧博客迁移的历史文章。"
  $plainLength = ([Net.WebUtility]::HtmlDecode(($body -replace "<[^>]+>", ""))).Length
  $minutes = [Math]::Max(1, [Math]::Ceiling($plainLength / 400))

  [ordered]@{
    title = $title
    description = $description
    type = $classification.Type
    tags = $classification.Tags
    read_time = "$minutes 分钟"
    lead = $lead
    body = $body
    status = "published"
    published_at = $(if ($dateByUrl.ContainsKey($url)) { $dateByUrl[$url] } else { "2026-03-06" })
    source_url = $sourceUrl
  }
}

$json = $posts | ConvertTo-Json -Depth 8 -Compress
$json = $json.Replace("</script", "<\/script")
$javascript = "window.LEGACY_POSTS = $json;`n"
Set-Content -LiteralPath $outputPath -Value $javascript -Encoding utf8

Write-Output "Generated $($posts.Count) posts at $outputPath"
