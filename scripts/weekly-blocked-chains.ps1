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
  the output kept. Nothing here is specific to a week; running it twice in a
  day is harmless (an unchanged file is skipped, and a second write of the
  same prices is the same prices).

  WHERE THE OUTPUT GOES. logs/weekly-blocked-chains/<date>.log, git-ignored,
  the last twelve kept. The last line of a good run is a JSON summary whose
  "errors" is 0.

  Registered as a Windows scheduled task; see docs/WEEKLY-IMPORT.md.
#>

$ErrorActionPreference = "Stop"

# node writes its per-chain lines and its "review it" warnings to stderr, and the
# chain names are Hebrew. Without this the log reads as mojibake, and -- worse --
# PowerShell wraps each stderr line of a native program in an error record, which
# under ErrorActionPreference = Stop ends the pipeline and kills a healthy import.
# Seen on the first scheduled run: 39 barcode warnings are normal output, and one
# of them stopped the write mid-way. So the console is told to speak UTF-8, and
# the two calls below drop to Continue -- their exit code decides, not their noise.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

$repo = Split-Path -Parent $PSScriptRoot
$publishers = "victory,mahsanei,hatzi-hinam"
$ref = "itpyyexhmvosxcbcagvy"   # the production project; run.mjs refuses to write unless this matches its env file

$logDir = Join-Path $repo "logs\weekly-blocked-chains"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir ((Get-Date -Format "yyyy-MM-dd_HH-mm") + ".log")

function Write-Log([string]$text) {
  $line = "{0}  {1}" -f (Get-Date -Format "HH:mm:ss"), $text
  Add-Content -Path $log -Value $line -Encoding utf8
}

Set-Location $repo
Write-Log "repo $repo"
Write-Log "publishers $publishers"

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
  # Keep the window's exit code honest so the task's History shows the failure.
  exit 1
}
finally {
  # Twelve logs is about a season. Older ones say nothing a run cannot say again.
  Get-ChildItem $logDir -Filter *.log |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 12 |
    Remove-Item -Force -ErrorAction SilentlyContinue
}
