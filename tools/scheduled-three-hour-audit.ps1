$ErrorActionPreference = "Stop"

$repoPath = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $repoPath ".scheduled-audit.log"
$codexPath = (Get-Command codex.cmd -ErrorAction Stop).Source
$startedAt = Get-Date

$prompt = @'
This is the unattended three-hour follow-up maintenance run for the CNBDG blog. You are authorized to inspect, repair, commit, and push changes in this repository without waiting for user confirmation.

Requirements:
1. Inspect repository status and recent commits first. If the worktree is clean, run git pull --ff-only. If user changes exist, preserve and work around them. Never use reset or checkout to discard changes.
2. Test both the deployed and local site. Focus on mobile transitions away from the community page, the iOS 26-style Liquid Glass dock, notification/direct-message badges, realtime direct and group chats, the mobile drawer, wallpaper and opacity controls, desktop three-column layout, dark mode, and reduced-motion mode.
3. At minimum, run all JavaScript syntax checks, a CSS brace check, node tools/browser-self-check.mjs in normal, dark, and reduced-motion modes, plus node tools/check-supabase-schema.mjs. Generate and visually inspect desktop/mobile screenshots with tools/capture-ui.mjs when useful.
4. If a failure or reproducible defect appears, find its root cause, implement the repair, and rerun tests until they pass. Make only evidence-based, low-risk improvements consistent with the existing product. Do not change or delete production user data and do not invent database changes.
5. Whenever website code changes, prepend a Chinese update article to update-log.js, bump the matching asset versions in index.html, commit to main, and push origin main. If everything passes and no justified repair exists, do not create an empty commit.
6. Report checks, findings, repairs, test results, commit hash, and push status. Explain any failure and the next step.
'@

"`n===== Scheduled audit started: $($startedAt.ToString('yyyy-MM-dd HH:mm:ss zzz')) =====" |
  Add-Content -LiteralPath $logPath -Encoding UTF8

try {
  $prompt | & $codexPath exec `
    --dangerously-bypass-approvals-and-sandbox `
    --dangerously-bypass-hook-trust `
    --color never `
    -C $repoPath `
    - 2>&1 | Tee-Object -FilePath $logPath -Append
  $auditExitCode = $LASTEXITCODE
} catch {
  $_ | Out-String | Add-Content -LiteralPath $logPath -Encoding UTF8
  $auditExitCode = 1
}

"===== Scheduled audit finished: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')); exit=$auditExitCode =====" |
  Add-Content -LiteralPath $logPath -Encoding UTF8
exit $auditExitCode
