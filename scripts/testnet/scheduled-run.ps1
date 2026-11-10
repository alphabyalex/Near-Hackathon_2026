# What the "Wardline testnet batch" scheduled task runs (Windows PowerShell 5.1).
#
# It runs in its own clone of the repo on main (never in a working copy on another branch), so a commit
# here can only ever carry data/testnet/. Each run:
#   1. installs and builds when the clone's code changed since the last build;
#   2. pnpm testnet:scheduled: one batch, then the audit (exit 0 only when the audit passes);
#   3. only if the audit passed: commits data/testnet/ alone as "chore(testnet): scheduled batch <UTC time>",
#      then git pull --rebase from origin main, then pushes main. If the pull conflicts, the rebase is
#      aborted, nothing is pushed, the commit stays local, and the log says why.
# Everything goes to %USERPROFILE%\.wardline\testnet\scheduled.log, outside the repo.
#
# Keys: WARDLINE_DOTENV names the .env to read (the task points it at the main checkout's), so the clone
# holds no copy of any key. The NEAR keys stay in %USERPROFILE%\.wardline\testnet\credentials.json.

$ErrorActionPreference = "Continue"
$Repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Log = Join-Path $env:USERPROFILE ".wardline\testnet\scheduled.log"
$Utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm") + " UTC"
$Pnpm = Join-Path $env:APPDATA "npm\pnpm.cmd"
if (-not (Test-Path $Pnpm)) { $Pnpm = "pnpm" }

function Say([string]$Message) { Add-Content -Path $Log -Value $Message -Encoding utf8 }
# Native commands through cmd, so their stderr lands in the log as text (not as PowerShell errors).
function Run([string]$Command) {
  cmd /c "$Command >> `"$Log`" 2>&1"
  return $LASTEXITCODE
}

Set-Location $Repo
Say ""
Say "==== scheduled run $Utc in $Repo ===="

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main") {
  Say "Skipped: this clone is on $branch, not main. The run commits and pushes main, so it only runs on main."
  exit 2
}
$dirty = git status --porcelain -- . ":(exclude)data/testnet"
if ($dirty) {
  Say "Skipped: files outside data/testnet/ have changed in this clone, and a run must commit data/testnet/ only:"
  Say ($dirty -join "`n")
  exit 2
}

$head = (git rev-parse HEAD).Trim()
$stamp = Join-Path $Repo "node_modules\.wardline-built"
if (-not (Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne $head) {
  Say "Code changed since the last build ($head): install and build."
  if ((Run "`"$Pnpm`" install --frozen-lockfile --prefer-offline") -ne 0) { Say "Install failed: no batch this run."; exit 3 }
  if ((Run "`"$Pnpm`" --filter `"@wardline/api...`" build") -ne 0) { Say "Build failed: no batch this run."; exit 3 }
  Set-Content -Path $stamp -Value $head -Encoding ascii
}

if ((Run "`"$Pnpm`" -s testnet:scheduled") -ne 0) {
  Say "The batch or the audit failed: nothing committed, nothing pushed."
  exit 1
}

git add -- data/testnet
git diff --cached --quiet -- data/testnet
if ($LASTEXITCODE -eq 0) {
  Say "Audit passed; data/testnet/ is unchanged, so there is nothing to commit."
  exit 0
}
if ((Run "git commit -q -m `"chore(testnet): scheduled batch $Utc`" -- data/testnet") -ne 0) { Say "git commit failed: nothing pushed."; exit 4 }

if ((Run "git pull --rebase -q origin main") -ne 0) {
  Run "git rebase --abort" | Out-Null
  Say "git pull --rebase from origin main failed (a conflict, or no network; see above), so the push is skipped. The commit stays in this clone; resolve it here, then push main."
  exit 5
}
if ((Run "git push -q origin main") -ne 0) {
  Say "git push failed (see above): the commit stays in this clone and goes out with the next run."
  exit 6
}
Say "Pushed $((git rev-parse --short HEAD).Trim()) to main: chore(testnet): scheduled batch $Utc"
exit 0
