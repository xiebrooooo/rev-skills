#Requires -Version 7
<#
.SYNOPSIS
    Build the binary-triage fixtures on Windows.

.DESCRIPTION
    Mirrors build.sh. Artifacts land in fixtures\build\ under extension-less names so
    that verify.sh can address the same path on every platform.

.EXAMPLE
    pwsh -File build.ps1
#>
[CmdletBinding()]
param(
    [string]$Compiler = $(if ($env:CC) { $env:CC } else { 'gcc' }),
    [string]$StripExe = $(if ($env:STRIP) { $env:STRIP } else { 'strip' })
)

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$out = Join-Path $here 'build'

$compilerPath = (Get-Command $Compiler -ErrorAction Ignore).Source
if (-not $compilerPath) { throw "build.ps1: compiler '$Compiler' not found on PATH" }

$nodePath = (Get-Command node -ErrorAction Ignore).Source
if (-not $nodePath) { throw "build.ps1: node not found on PATH" }

New-Item -ItemType Directory -Force -Path $out | Out-Null

Write-Host 'build.ps1: triage_clean'
& $compilerPath -O1 -g0 -o (Join-Path $out 'triage_clean.exe') (Join-Path $here 'src\triage_clean.c')
if ($LASTEXITCODE -ne 0) { throw "compile failed for triage_clean (exit $LASTEXITCODE)" }

Write-Host 'build.ps1: triage_stripped'
Copy-Item -LiteralPath (Join-Path $out 'triage_clean.exe') -Destination (Join-Path $out 'triage_stripped.exe') -Force
$stripPath = (Get-Command $StripExe -ErrorAction Ignore).Source
if ($stripPath) {
    & $stripPath (Join-Path $out 'triage_stripped.exe')
    if ($LASTEXITCODE -ne 0) { Write-Warning "strip exited $LASTEXITCODE; triage_stripped may still carry symbols" }
} else {
    Write-Warning "build.ps1: '$StripExe' not found - triage_stripped will not actually be stripped"
}

Write-Host 'build.ps1: triage_packed'
$genC = Join-Path $out 'triage_packed.c'
& $nodePath (Join-Path $here 'src\gen_packed.mjs') $genC
if ($LASTEXITCODE -ne 0) { throw "fixture generator failed (exit $LASTEXITCODE)" }

& $compilerPath -O1 -g0 -o (Join-Path $out 'triage_packed.exe') $genC
if ($LASTEXITCODE -ne 0) { throw "compile failed for triage_packed (exit $LASTEXITCODE)" }

foreach ($name in 'triage_clean', 'triage_stripped', 'triage_packed') {
    $src = Join-Path $out "$name.exe"
    if (Test-Path -LiteralPath $src) {
        Move-Item -LiteralPath $src -Destination (Join-Path $out $name) -Force
    }
}

Write-Host 'build.ps1: fixtures ready'
$failed = $false
foreach ($name in 'triage_clean', 'triage_stripped', 'triage_packed') {
    $artifact = Join-Path $out $name
    if (Test-Path -LiteralPath $artifact) {
        $size = (Get-Item -LiteralPath $artifact).Length
        Write-Host ("  {0,-20} {1} bytes" -f $name, $size)
    } else {
        Write-Host ("  {0,-20} MISSING" -f $name)
        $failed = $true
    }
}
if ($failed) { exit 1 }
