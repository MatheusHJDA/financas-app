param([string]$Task = "check")

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Api = Join-Path $Root "apps/api"
$Web = Join-Path $Root "apps/web"
$MaxGzipBytes = 200 * 1024

function Invoke-Step {
    param([string]$Name, [string]$Dir, [scriptblock]$Command)
    Write-Host "==> $Name" -ForegroundColor Cyan
    Push-Location $Dir
    try {
        & $Command
        $code = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    if ($code -ne 0) {
        Write-Host "FALHOU: $Name (codigo $code)" -ForegroundColor Red
        exit $code
    }
}

function Get-GzipSize {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $ms = New-Object System.IO.MemoryStream
    $gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionLevel]::Optimal)
    $gz.Write($bytes, 0, $bytes.Length)
    $gz.Close()
    return $ms.ToArray().Length
}

function Invoke-Size {
    $dist = Join-Path $Web "dist"
    $index = Join-Path $dist "index.html"
    if (-not (Test-Path $index)) {
        Write-Host "dist/index.html nao existe; rode 'check' (build) antes de 'size'." -ForegroundColor Red
        exit 1
    }
    $html = Get-Content $index -Raw
    $refs = [regex]::Matches($html, '(?:src|href)="(/[^"]+\.(?:js|css))"') | ForEach-Object { $_.Groups[1].Value }
    $total = 0
    foreach ($ref in ($refs | Sort-Object -Unique)) {
        $file = Join-Path $dist $ref.TrimStart("/")
        $size = Get-GzipSize $file
        $total += $size
        Write-Host ("  {0}: {1:N1} kB gzip" -f $ref, ($size / 1024))
    }
    Write-Host ("Total inicial: {0:N1} kB gzip (limite {1} kB)" -f ($total / 1024), ($MaxGzipBytes / 1024))
    if ($total -gt $MaxGzipBytes) {
        Write-Host "FALHOU: bundle inicial acima do limite." -ForegroundColor Red
        exit 1
    }
}

switch ($Task) {
    "check" {
        Invoke-Step "api: ruff check" $Api { uv run ruff check . }
        Invoke-Step "api: ruff format --check" $Api { uv run ruff format --check . }
        Invoke-Step "api: pytest" $Api { uv run pytest }
        Invoke-Step "web: lint" $Web { npm run lint }
        Invoke-Step "web: typecheck" $Web { npm run typecheck }
        Invoke-Step "web: test" $Web { npm test }
        Invoke-Step "web: build" $Web { npm run build }
        Write-Host "check: tudo verde." -ForegroundColor Green
    }
    "e2e" { Write-Host "definido em U11" }
    "ai-live" { Invoke-Step "api: pytest -m live" $Api { uv run pytest -m live } }
    "size" { Invoke-Size }
    "up" { Invoke-Step "docker compose up" $Root { docker compose -f infra/docker-compose.yml --env-file .env up -d --build } }
    "down" { Invoke-Step "docker compose down" $Root { docker compose -f infra/docker-compose.yml --env-file .env down } }
    "vapid" { Invoke-Step "gen-vapid" $Api { uv run python ../../infra/scripts/gen-vapid.py } }
    default {
        Write-Host "Tarefa desconhecida: $Task. Use: check, e2e, ai-live, size, up, down, vapid." -ForegroundColor Red
        exit 2
    }
}
exit 0
