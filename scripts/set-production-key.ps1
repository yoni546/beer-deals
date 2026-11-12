#requires -Version 5.1
<#
  Put the production service-role key into .env.production.local, without it
  being seen.

  WHY THIS EXISTS. The key is the one that opens everything, so it must not be
  pasted into a chat, a screenshot, a commit or a shell history. This asks for
  it at a masked prompt, writes it straight into the git-ignored env file, and
  prints nothing but a verdict: it tests the key against the project and says
  whether it answered. The value itself is never echoed, logged or returned.

  Run it from the project folder:

      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\set-production-key.ps1

  The previous file is kept beside it as .env.production.local.bak.
#>
[CmdletBinding()]
param(
  # The project the key is expected to belong to. Changing this is how the same
  # script serves the next move.
  [string] $Ref = "qxumavffsnreyqcuxlof"
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$file = Join-Path $repo ".env.production.local"
$url  = "https://$Ref.supabase.co"

if (-not (Test-Path $file)) { throw "$file not found." }

Write-Host ""
Write-Host "Paste the SECRET key of the Supabase project $Ref." -ForegroundColor Cyan
Write-Host "Project Settings -> API Keys -> the one marked 'secret' -> Reveal -> copy."
Write-Host "It starts with sb_secret_ . Nothing you type here is shown or saved anywhere else."
Write-Host ""

$secure = Read-Host -Prompt "secret key" -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
         [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()

if (-not $key) { throw "Nothing was pasted." }
# Said as a shape, never by quoting the value back.
if ($key -notlike "sb_secret_*") {
  Write-Host "That does not start with sb_secret_ ." -ForegroundColor Yellow
  if ($key -like "sb_publishable_*") { throw "That is the PUBLISHABLE key, not the secret one. They sit next to each other on the same page." }
  if ($key -like "eyJ*")             { throw "That is a key in the old JWT format - the previous project's. The new one starts sb_secret_ ." }
  throw "Refusing to write something that is not a secret key."
}

# Test BEFORE writing, so a wrong key never replaces a working file.
Write-Host "Testing it against $url ..." -NoNewline
$headers = @{ apikey = $key; Authorization = "Bearer $key"; Prefer = "count=exact"; Range = "0-0" }
try {
  $response = Invoke-WebRequest -Uri "$url/rest/v1/offers_catalog?select=offer_key" -Headers $headers -Method Get -UseBasicParsing
} catch {
  Write-Host ""
  throw "The project refused that key ($($_.Exception.Message)). Nothing was changed."
}
$count = ($response.Headers['Content-Range'] -split '/')[-1]
Write-Host " answered: $count live offers." -ForegroundColor Green

Copy-Item $file "$file.bak" -Force

# Rewrite only the two lines that move, and leave every other line as it is --
# APP_ENV among them.
$lines = Get-Content $file
$out = foreach ($line in $lines) {
  if ($line -match '^\s*NEXT_PUBLIC_SUPABASE_URL\s*=')   { "NEXT_PUBLIC_SUPABASE_URL=$url" }
  elseif ($line -match '^\s*SUPABASE_SERVICE_ROLE_KEY\s*=') { "SUPABASE_SERVICE_ROLE_KEY=$key" }
  else { $line }
}
Set-Content -Path $file -Value $out -Encoding utf8

Write-Host ""
Write-Host "Written. .env.production.local now points at $Ref." -ForegroundColor Green
Write-Host "The previous file is at .env.production.local.bak - delete it once a run has worked."
Write-Host ""
