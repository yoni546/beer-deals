#requires -Version 5.1
<#
  The three chains GitHub cannot reach, imported from a machine in Israel.

  WHY THIS EXISTS. Victory, Mahsanei HaShuk and Hatzi Hinam publish their
  price files like everyone else, but their servers refuse addresses outside
  Israel, and GitHub's runners are outside Israel. So the nightly workflow
  imports the other fourteen chains and these three go stale: nothing deletes
  their offers -- close_missing_promotions only touches branches that were
  actually read -- they simply expire on their own end dates and nothing
  refreshes them. Verified from this machine on 2026-10-31: 150 branches,
  300 files, 0 failures. The block is the only obstacle.

  WHAT IT DOES. The same two commands that were run by hand that day, with
  the output kept. Running it twice in a day is harmless -- an unchanged file
  is skipped, and a second write of the same prices is the same prices -- but
  it is also pointless, so a run inside -MaxAgeDays of the last good one says
  so and stops. That guard is what lets the task fire on every logon as well
  as weekly: see docs/WEEKLY-IMPORT.md.

  WHERE THE OUTPUT GOES. logs/weekly-blocked-chains/<date>.log, git-ignored,
  the last twelve kept. The last line of a good run is a JSON summary whose
  "errors" is 0, then "done". A skipped run ends with "skipped".
#>
[CmdletBinding()]
param(
  # Do nothing if a run finished cleanly less recently than this. Six days, so
  # that a weekly import is never the one skipped -- only the extra attempts
  # the logon trigger makes on the days around it.
  [int] $MaxAgeDays = 6,
  # Import now whatever the last run says.
  [switch] $Force
)

$ErrorActionPreference = "Stop"

# node writes its per-chain lines and its "review it" warnings to stderr, and
# the chain names are Hebrew. Without this the log reads as mojibake, and --
# worse -- PowerShell wraps each stderr line of a native program in an error
# record, which under ErrorActionPreference = Stop ends the pipeline and kills
# a healthy import. Seen on the first scheduled run: the 39 barcode warnings
# are ordinary output, and one of them stopped a write half-way. So the console
# is told to speak UTF-8, and Invoke-Step below drops to Continue -- a step's
# exit code decides whether it failed, never its noise.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

$repo = Split-Path -Parent $PSScriptRoot
$publishers = "victory,mahsanei,hatzi-hinam"
$ref = "itpyyexhmvosxcbcagvy"   # the production project; run.mjs refuses to write unless this matches its env file

$logDir = Join-Path $repo "logs\weekly-blocked-chains"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# The newest log that reached "done" is the last good run. Read before this
# run's own log exists, or it would find itself.
function Get-LastGoodRun {
  Get-ChildItem $logDir -Filter *.log -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Where-Object { (Get-Content $_.FullName -Tail 1 -ErrorAction SilentlyContinue) -match "  done$" } |
    Select-Object -First 1
}
$lastGood = Get-LastGoodRun

$log = Join-Path $logDir ((Get-Date -Format "yyyy-MM-dd_HH-mm") + ".log")

function Write-Log([string]$text) {
  $line = "{0}  {1}" -f (Get-Date -Format "HH:mm:ss"), $text
  Add-Content -Path $log -Value $line -Encoding utf8
}

Set-Location $repo
Write-Log "repo $repo"
Write-Log "publishers $publishers"

if ($lastGood -and -not $Force) {
  $age = (Get-Date) - $lastGood.LastWriteTime
  if ($age.TotalDays -lt $MaxAgeDays) {
    Write-Log ("last good run {0}, {1:N1} days ago, under the {2}-day floor" -f $lastGood.LastWriteTime, $age.TotalDays, $MaxAgeDays)
    Write-Log "skipped"
    exit 0
  }
  Write-Log ("last good run {0}, {1:N1} days ago" -f $lastGood.LastWriteTime, $age.TotalDays)
} elseif ($Force) {
  Write-Log "-Force: importing whatever the last run says"
} else {
  Write-Log "no previous good run on record"
}

# The node that winget installed is not always on a scheduled task's PATH.
$node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
Write-Log "node $node"

function Invoke-Step([string]$what, [string[]]$nodeArgs) {
  Write-Log "$what : starting"
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $node @nodeArgs 2>&1 | ForEach-Object { Write-Log ($_ | Out-String).TrimEnd() }
  }
  finally {
    $ErrorActionPreference = $previous
  }
  if ($LASTEXITCODE -ne 0) { throw "$what exited $LASTEXITCODE" }
}

try {
  Invoke-Step "scan" @("scripts\ingest\scan.mjs", "--publishers", $publishers)
  Invoke-Step "write" @("scripts\ingest\run.mjs", "--target", "production", "--confirm-ref", $ref, "--publishers", $publishers)
  Write-Log "done"
}
catch {
  Write-Log ("FAILED: " + $_.Exception.Message)
  # Keep the exit code honest so the task's Last Run Result shows the failure.
  exit 1
}
finally {
  # Twelve logs is about a season. Older ones say nothing a run cannot say again.
  Get-ChildItem $logDir -Filter *.log |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 12 |
    Remove-Item -Force -ErrorAction SilentlyContinue
}
