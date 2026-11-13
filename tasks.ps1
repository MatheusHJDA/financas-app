param([string]$Task = "check", [string]$Arg = "")

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

function Invoke-TestDb {
    # Postgres de teste (só localhost, dados descartáveis). Idempotente.
    $name = "financas-pgtest"
    $running = docker ps --filter "name=^$name$" --format "{{.Names}}"
    if ($running -ne $name) {
        $exists = docker ps -a --filter "name=^$name$" --format "{{.Names}}"
        if ($exists -eq $name) { docker start $name | Out-Null }
        else {
            docker run -d --name $name -e POSTGRES_USER=financas_test -e POSTGRES_PASSWORD=financas_test `
                -e POSTGRES_DB=postgres -p 127.0.0.1:55432:5432 postgres:16-alpine | Out-Null
        }
        if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: subir $name (Docker ligado?)" -ForegroundColor Red; exit 1 }
    }
    for ($i = 0; $i -lt 30; $i++) {
        docker exec $name pg_isready -U financas_test -d postgres 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host "testdb: pronto em 127.0.0.1:55432"; return }
        Start-Sleep -Seconds 1
    }
    Write-Host "FALHOU: $name nao ficou pronto" -ForegroundColor Red
    exit 1
}

switch ($Task) {
    "check" {
        Invoke-TestDb
        Invoke-Step "api: ruff check" $Api { uv run ruff check . }
        Invoke-Step "api: ruff format --check" $Api { uv run ruff format --check . }
        Invoke-Step "api: pytest" $Api { uv run pytest }
        Invoke-Step "web: lint" $Web { npm run lint }
        Invoke-Step "web: typecheck" $Web { npm run typecheck }
        Invoke-Step "web: test" $Web { npm test }
        Invoke-Step "web: build" $Web { npm run build }
        Write-Host "check: tudo verde." -ForegroundColor Green
    }
    "e2e" {
        Invoke-TestDb
        Invoke-Step "web: build" $Web { npm run build }
        Invoke-Step "e2e: playwright install chromium" $Api { uv run playwright install chromium }
        Invoke-Step "e2e: pytest -m e2e" $Api { uv run pytest tests/e2e -m e2e }
        Write-Host "e2e: tudo verde." -ForegroundColor Green
    }
    "backup" {
        # Backup agora: pg_dump no volume `backups` (nome financas-AAAAMMDD-HHMMSS.dump, o mesmo do backup das 03:00)
        # e copia para uma pasta do host. Uso: ./tasks.ps1 backup [pasta]   (padrao: ./backups, fora do git)
        $destino = if ($Arg) { $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Arg) } else { Join-Path $Root "backups" }
        New-Item -ItemType Directory -Force -Path $destino | Out-Null
        Invoke-Step "backup: pg_dump no volume e copia para o host" $Root {
            docker compose -f infra/docker-compose.yml --env-file .env run --rm -T -e COPY_TO=/host-backups -v "${destino}:/host-backups" backup sh /scripts/db-backup.sh once
        }
        Write-Host "backup: copia no host em $destino" -ForegroundColor Green
    }
    "restore" {
        # Restaura um dump do host no banco REAL. Uso: ./tasks.ps1 restore <arquivo.dump> -Confirmar [-SemSeguranca]
        # Sem -Confirmar so explica o que faria. (-Confirmar e -SemSeguranca chegam em $args.)
        $confirmar = $args -contains "-Confirmar"
        $semSeguranca = $args -contains "-SemSeguranca"
        $desconhecidos = @($args | Where-Object { $_ -notin @("-Confirmar", "-SemSeguranca") })
        if (-not $Arg -or $desconhecidos.Count -gt 0) {
            Write-Host "Uso: ./tasks.ps1 restore <arquivo.dump> [-Confirmar] [-SemSeguranca]" -ForegroundColor Red
            exit 2
        }
        $arquivo = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Arg)
        if (-not (Test-Path -LiteralPath $arquivo -PathType Leaf)) {
            Write-Host "FALHOU: arquivo nao encontrado: $arquivo" -ForegroundColor Red
            exit 1
        }
        if (-not $confirmar) {
            Write-Host "Isto SUBSTITUI todos os dados do banco atual pelo conteudo de:" -ForegroundColor Yellow
            Write-Host "  $arquivo"
            Write-Host "Passos: backup de seguranca do banco atual (no volume), parar a api, pg_restore --clean --if-exists --no-owner, subir a api."
            Write-Host "Para executar de verdade, rode de novo com -Confirmar."
            exit 0
        }
        if (-not $semSeguranca) {
            Invoke-Step "restore: backup de seguranca do banco atual" $Root {
                docker compose -f infra/docker-compose.yml --env-file .env run --rm -T backup sh /scripts/db-backup.sh once
            }
        }
        Invoke-Step "restore: parar a api" $Root { docker compose -f infra/docker-compose.yml --env-file .env stop api }
        Write-Host "Se o proximo passo falhar, o banco fica como estava (transacao unica), mas a api continua parada: suba com ./tasks.ps1 up" -ForegroundColor Yellow
        Invoke-Step "restore: pg_restore" $Root {
            docker compose -f infra/docker-compose.yml --env-file .env run --rm -T -v "${arquivo}:/restore/arquivo.dump:ro" backup sh /scripts/db-restore.sh /restore/arquivo.dump
        }
        Invoke-Step "restore: subir a api" $Root { docker compose -f infra/docker-compose.yml --env-file .env up -d api }
        Write-Host "restore: concluido a partir de $arquivo" -ForegroundColor Green
    }
    "ai-live" { Invoke-Step "api: pytest -m live" $Api { uv run pytest -m live } }
    "size" { Invoke-Size }
    "testdb" { Invoke-TestDb }
    "setup" {
        Invoke-Step "api: uv sync" $Api { uv sync }
        Invoke-Step "web: npm install" $Web { npm install }
    }
    "web" {
        if (-not $Arg) { Write-Host "Uso: ./tasks.ps1 web <script do package.json>" -ForegroundColor Red; exit 2 }
        Invoke-Step "web: npm run $Arg" $Web { npm run $Arg }
    }
    "up" { Invoke-Step "docker compose up" $Root { docker compose -f infra/docker-compose.yml --env-file .env up -d --build } }
    "down" { Invoke-Step "docker compose down" $Root { docker compose -f infra/docker-compose.yml --env-file .env down } }
    "vapid" { Invoke-Step "gen-vapid" $Api { uv run python ../../infra/scripts/gen-vapid.py } }
    default {
        Write-Host "Tarefa desconhecida: $Task. Use: check, e2e, ai-live, size, up, down, vapid, backup, restore, testdb, setup, web <script>." -ForegroundColor Red
        exit 2
    }
}
exit 0
