<#
.SYNOPSIS
  Run the anim-pipe backend (FastAPI :8000) and frontend (Vite :5173) together.

.DESCRIPTION
  Replaces `make backend` / `make frontend` for Windows. Starts both processes,
  streams their logs into this one window (color-prefixed), and stops BOTH when
  you press Ctrl+C once.

.EXAMPLE
  .\dev.ps1            # run backend + frontend
  .\dev.ps1 -Seed      # seed the demo project first, then run both
  .\dev.ps1 -Install   # install deps (pip + npm) first, then run both
#>
[CmdletBinding()]
param(
    [switch]$Seed,      # create the demo "Wandering Hero" project before starting
    [switch]$Install,   # install backend (pip) + frontend (npm) deps before starting
    [int]$BackendPort = 8000
)

$ErrorActionPreference = 'Stop'
$root        = $PSScriptRoot
$backendDir  = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'

# Python logs are block-buffered when stdout is redirected; this makes them live.
$env:PYTHONUNBUFFERED = '1'

if ($Install) {
    Write-Host '==> Installing backend deps (pip)...' -ForegroundColor Cyan
    python -m pip install -r (Join-Path $backendDir 'requirements.txt')
    Write-Host '==> Installing frontend deps (npm)...' -ForegroundColor Cyan
    Push-Location $frontendDir; npm install; Pop-Location
}

if ($Seed) {
    Write-Host '==> Seeding demo project...' -ForegroundColor Cyan
    Push-Location $backendDir; python -m app.seed; Pop-Location
}

# --- launch helpers --------------------------------------------------------
$services = @()

function Start-Service-Proc {
    param($Name, $Color, $Dir, $Exe, $ArgList)

    $outFile = [System.IO.Path]::GetTempFileName()
    $errFile = [System.IO.Path]::GetTempFileName()
    $proc = Start-Process -FilePath $Exe -ArgumentList $ArgList `
        -WorkingDirectory $Dir -NoNewWindow -PassThru `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile

    [pscustomobject]@{
        Name = $Name; Color = $Color; Proc = $proc
        OutFile = $outFile; ErrFile = $errFile; OutPos = 0; ErrPos = 0
    }
}

function Pump-Logs {
    param($svc)
    foreach ($pair in @(@($svc.OutFile, 'OutPos'), @($svc.ErrFile, 'ErrPos'))) {
        $file = $pair[0]; $posKey = $pair[1]
        $lines = @(Get-Content -LiteralPath $file -ErrorAction SilentlyContinue)
        if ($lines.Count -gt $svc.$posKey) {
            for ($i = $svc.$posKey; $i -lt $lines.Count; $i++) {
                Write-Host ("[{0}] " -f $svc.Name) -ForegroundColor $svc.Color -NoNewline
                Write-Host $lines[$i]
            }
            $svc.$posKey = $lines.Count
        }
    }
}

try {
    $services += Start-Service-Proc -Name 'api' -Color 'Green' -Dir $backendDir `
        -Exe 'python' -ArgList @('-m', 'uvicorn', 'app.main:app', '--reload', '--port', "$BackendPort")

    $services += Start-Service-Proc -Name 'web' -Color 'Magenta' -Dir $frontendDir `
        -Exe 'npm.cmd' -ArgList @('run', 'dev')

    Write-Host ''
    Write-Host "  backend  -> http://localhost:$BackendPort" -ForegroundColor Green
    Write-Host '  frontend -> http://localhost:5173' -ForegroundColor Magenta
    Write-Host '  (Ctrl+C stops both)' -ForegroundColor DarkGray
    Write-Host ''

    while ($true) {
        foreach ($svc in $services) { Pump-Logs $svc }

        $dead = $services | Where-Object { $_.Proc.HasExited }
        if ($dead) {
            foreach ($d in $dead) {
                Write-Host ("[{0}] exited with code {1}" -f $d.Name, $d.Proc.ExitCode) -ForegroundColor Red
            }
            break
        }
        Start-Sleep -Milliseconds 350
    }
}
finally {
    Write-Host ''
    Write-Host '==> Shutting down...' -ForegroundColor Yellow
    foreach ($svc in $services) {
        if ($svc.Proc -and -not $svc.Proc.HasExited) {
            # /T kills the whole tree (uvicorn reloader + worker, npm -> node)
            taskkill /PID $svc.Proc.Id /T /F 2>$null | Out-Null
        }
        Pump-Logs $svc   # flush any final lines
        Remove-Item -LiteralPath $svc.OutFile, $svc.ErrFile -ErrorAction SilentlyContinue
    }
}
