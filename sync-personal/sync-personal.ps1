# sync-personal.ps1
# Sync personal Claude projects between office and home via personal GitHub (fiveflute-collab).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File sync-personal.ps1 -Mode push|pull|status
# ASCII-only on purpose (PS 5.1 CP949 safety). Claude presents the Korean summary.

param(
    [ValidateSet('push','pull','status')]
    [string]$Mode = 'status'
)
$ErrorActionPreference = 'Continue'

$personalUser = 'fiveflute-collab'   # personal GitHub account that owns these repos
$restoreUser  = 'tyler-zigbang'      # company account, restored as active after sync

# Personal project repos to keep in sync (office <-> home)
$repos = @(
    'C:\Users\Tyler Jeong\obgyn-video',
    'C:\Users\Tyler Jeong\clinic-scribe',
    'C:\Users\Tyler Jeong\stock-agent',
    'C:\Users\Tyler Jeong\longterm-agent',
    'C:\Users\Tyler Jeong\.claude\automation\etf-screener',
    'C:\Users\Tyler Jeong\.claude\automation'
)

$hostName = $env:COMPUTERNAME
$stamp    = Get-Date -Format 'yyyy-MM-dd HH:mm'

function Switch-GH([string]$user) {
    gh auth switch --hostname github.com --user $user 2>&1 | Out-Null
    return $LASTEXITCODE
}

Write-Output "=== sync-personal [$Mode]  host=$hostName  $stamp ==="

if ($Mode -ne 'status') {
    if ((Switch-GH $personalUser) -eq 0) { Write-Output "gh active account -> $personalUser" }
    else { Write-Output "WARNING: could not switch gh to $personalUser (push/pull may fail)" }
}

$fail = 0
foreach ($r in $repos) {
    $name = Split-Path $r -Leaf
    if (-not (Test-Path (Join-Path $r '.git'))) { Write-Output "[$name] SKIP (not a git repo)"; continue }
    Push-Location $r
    try {
        $branch   = (git branch --show-current)
        $dirtyArr = @(git status --porcelain)
        $dirtyN   = $dirtyArr.Count
        switch ($Mode) {
            'status' {
                git fetch --quiet 2>&1 | Out-Null
                $ab = (git rev-list --left-right --count "HEAD...@{u}" 2>$null)
                if (-not $ab) { $ab = 'no-upstream' }
                Write-Output "[$name] branch=$branch  dirty=$dirtyN  ahead/behind=$ab"
            }
            'push' {
                if ($dirtyN -gt 0) {
                    git add -A 2>&1 | Out-Null
                    git commit -m "sync from $hostName $stamp" 2>&1 | Out-Null
                    Write-Output "[$name] committed $dirtyN change(s)"
                }
                $out = (git push 2>&1 | Out-String).Trim()
                if ($LASTEXITCODE -eq 0) { Write-Output "[$name] PUSH ok" }
                else { $fail++; Write-Output "[$name] PUSH FAILED: $out" }
            }
            'pull' {
                if ($dirtyN -gt 0) {
                    $fail++
                    Write-Output "[$name] SKIPPED pull: $dirtyN uncommitted change(s) - commit or stash first"
                } else {
                    $out = (git pull --ff-only 2>&1 | Out-String).Trim()
                    if ($LASTEXITCODE -eq 0) { Write-Output "[$name] PULL ok" }
                    else { $fail++; Write-Output "[$name] PULL needs attention: $out" }
                }
            }
        }
    } finally { Pop-Location }
}

if ($Mode -ne 'status') {
    if ((Switch-GH $restoreUser) -eq 0) { Write-Output "gh active account restored -> $restoreUser" }
    else { Write-Output "NOTE: gh account left on $personalUser (restore to $restoreUser failed)" }
}

Write-Output "=== done (failures=$fail) ==="
exit $fail
