# SPDX-License-Identifier: GPL-3.0-only
[CmdletBinding()]
param(
    [string]$ComfyRoot,
    [string]$Python,
    [string]$Model,
    [string]$Gate,
    [string]$CacheSource,
    [string]$Gpu = '0',
    [switch]$CheckOnly,
    [switch]$InstallDependencies,
    [switch]$Update
)
$ErrorActionPreference = 'Stop'
try {
    if (-not $ComfyRoot) {
        $candidate = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
        if (Test-Path -LiteralPath (Join-Path $candidate 'comfy\sd.py')) {
            $ComfyRoot = $candidate
        } else {
            $ComfyRoot = (Read-Host 'ComfyUI directory (contains main.py)').Trim('"')
        }
    }
    $ComfyRoot = (Resolve-Path -LiteralPath $ComfyRoot).Path
    if (-not (Test-Path -LiteralPath (Join-Path $ComfyRoot 'comfy\sd.py'))) {
        throw 'Select the ComfyUI directory containing comfy\sd.py.'
    }
    if (-not $Python) {
        $parent = Split-Path $ComfyRoot -Parent
        $candidates = @(
            (Join-Path $parent 'python_embeded\python.exe'),
            (Join-Path $ComfyRoot '.venv\Scripts\python.exe'),
            (Join-Path $parent '.venv\Scripts\python.exe'),
            (Join-Path $ComfyRoot 'venv\Scripts\python.exe')
        ) | Where-Object { Test-Path -LiteralPath $_ }
        if (@($candidates).Count -ne 1) {
            throw 'Cannot select one isolated Python. Pass -Python <ComfyUI venv or embedded python.exe>. Global Python is never used.'
        }
        $Python = @($candidates)[0]
    }
    $Python = (Resolve-Path -LiteralPath $Python).Path
    $setupArgs = @('-B', '-X', 'utf8', (Join-Path $PSScriptRoot 'setup_env.py'), '--comfy-root', $ComfyRoot, '--gpu', $Gpu)
    foreach ($pair in @(@('--model', $Model), @('--gate', $Gate), @('--cache-source', $CacheSource))) {
        if ($pair[1]) { $setupArgs += $pair }
    }
    if ($CheckOnly) { $setupArgs += '--check-only' }
    if ($InstallDependencies) { $setupArgs += '--install-dependencies' }
    if ($Update) { $setupArgs += '--update' }
    & $Python @setupArgs
    exit $LASTEXITCODE
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
