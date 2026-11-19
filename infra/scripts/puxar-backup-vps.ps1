# Copia para o PC o backup mais recente da VPS (servico `backup`, dump das 03:00) - copia fora do servidor.
#
# Roda pela tarefa agendada "Financas - backup da VPS" (./tasks.ps1 backup-vps-agendar) ao entrar no Windows e
# ao desbloquear a tela; faz o trabalho UMA vez por dia (marca em <destino>/.ultimo-dia) e sai calado nas outras.
# Se falhar, nao marca o dia (tenta de novo no proximo desbloqueio) e mostra um aviso na tela.
#
#   puxar-backup-vps.ps1 [-Forcar] [-Destino <pasta>] [-SemAviso]
#     -Forcar   ignora a marca do dia (./tasks.ps1 backup-vps usa assim)
#     -Destino  padrao: <repo>/backups/vps (fora do git)
#
# Caminho: ssh financas -> docker compose cp do volume para ~/.backup-pc na VPS -> scp -> confere sha256 -> renomeia.
# Guarda 30 dias. Avisa se o backup mais novo da VPS tiver mais de 2 dias (servico de backup parado).
param([switch]$Forcar, [string]$Destino = "", [switch]$SemAviso)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
if (-not $Destino) { $Destino = Join-Path $Root "backups/vps" }
New-Item -ItemType Directory -Force -Path $Destino | Out-Null

$Log = Join-Path $Destino "puxar-backup.log"
$Marca = Join-Path $Destino ".ultimo-dia"
$Hoje = Get-Date -Format "yyyy-MM-dd"
$RetencaoDias = 30
$Host_ = "financas"
$Compose = "cd ~/financas && docker compose -f infra/docker-compose.yml -f infra/docker-compose.vps.yml --env-file .env"
$Ssh = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15")

function Write-Log([string]$Msg) {
    $linha = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Msg
    Add-Content -LiteralPath $Log -Value $linha -Encoding UTF8
    Write-Host $linha
}

function Show-Aviso([string]$Msg) {
    if ($SemAviso) { return }
    try { (New-Object -ComObject WScript.Shell).Popup($Msg, 0, "Financas - backup da VPS", 0x30) | Out-Null } catch {}
}

function Stop-ComFalha([string]$Msg) {
    Write-Log "FALHA: $Msg"
    Show-Aviso "Nao foi possivel copiar o backup da VPS para o PC.`n`n$Msg`n`nDetalhes: $Log"
    exit 1
}

# Uma vez por dia
if (-not $Forcar -and (Test-Path -LiteralPath $Marca) -and ((Get-Content -LiteralPath $Marca -Raw).Trim() -eq $Hoje)) {
    exit 0
}

# Login e desbloqueio podem disparar juntos: so uma copia roda por vez
$mutex = New-Object System.Threading.Mutex($false, "Local\FinancasPuxarBackupVps")
if (-not $mutex.WaitOne(0)) { exit 0 }
try {
    # Rede pode nao estar pronta logo apos ligar: tenta por ~10 min
    $ok = $false
    for ($i = 1; $i -le 20; $i++) {
        & ssh @Ssh $Host_ "true" 2>$null
        if ($LASTEXITCODE -eq 0) { $ok = $true; break }
        Start-Sleep -Seconds 30
    }
    if (-not $ok) { Stop-ComFalha "a VPS nao respondeu pelo SSH em 10 minutos (sem internet?)." }

    $ultimo = & ssh @Ssh $Host_ "$Compose exec -T backup sh -c 'ls -1 /data/backups/financas-*.dump 2>/dev/null | tail -n 1'" 2>$null
    $nome = if ($ultimo) { Split-Path -Leaf ("$ultimo".Trim()) } else { "" }
    if ($nome -notmatch '^financas-(\d{8})-\d{6}\.dump$') { Stop-ComFalha "nenhum backup encontrado na VPS (resposta: '$ultimo')." }
    $dataBackup = [datetime]::ParseExact($Matches[1], "yyyyMMdd", $null)
    $idadeDias = ((Get-Date).Date - $dataBackup).Days

    $final = Join-Path $Destino $nome
    if (Test-Path -LiteralPath $final) {
        Write-Log "ja tinha $nome; nada a copiar."
    }
    else {
        $hashRemoto = & ssh @Ssh $Host_ "$Compose exec -T backup sha256sum /data/backups/$nome" 2>$null
        $hashRemoto = ("$hashRemoto".Trim() -split '\s+')[0]
        if ($hashRemoto -notmatch '^[0-9a-f]{64}$') { Stop-ComFalha "nao consegui calcular o sha256 de $nome na VPS." }

        & ssh @Ssh $Host_ "mkdir -p ~/.backup-pc && chmod 700 ~/.backup-pc && $Compose cp backup:/data/backups/$nome ~/.backup-pc/$nome" 2>$null
        if ($LASTEXITCODE -ne 0) { Stop-ComFalha "nao consegui separar $nome na VPS para baixar." }

        $tmp = Join-Path $Destino ".$nome.tmp"
        & scp @Ssh -q "${Host_}:.backup-pc/$nome" $tmp 2>$null
        $codigoScp = $LASTEXITCODE
        & ssh @Ssh $Host_ "rm -f ~/.backup-pc/$nome" 2>$null
        if ($codigoScp -ne 0 -or -not (Test-Path -LiteralPath $tmp)) {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
            Stop-ComFalha "o download de $nome falhou."
        }

        $hashLocal = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLower()
        if ($hashLocal -ne $hashRemoto) {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
            Stop-ComFalha "o arquivo baixado nao confere com o da VPS (sha256 diferente)."
        }
        Move-Item -LiteralPath $tmp -Destination $final
        Write-Log ("copiado {0} ({1:N0} kB, sha256 ok)" -f $nome, ((Get-Item -LiteralPath $final).Length / 1KB))
    }

    # Retencao local pela data do nome
    Get-ChildItem -LiteralPath $Destino -Filter "financas-*.dump" | ForEach-Object {
        if ($_.Name -match '^financas-(\d{8})-') {
            $d = [datetime]::ParseExact($Matches[1], "yyyyMMdd", $null)
            if (((Get-Date).Date - $d).Days -gt $RetencaoDias) {
                Remove-Item -LiteralPath $_.FullName -Force
                Write-Log "apagado (mais de $RetencaoDias dias): $($_.Name)"
            }
        }
    }
    Get-ChildItem -LiteralPath $Destino -Filter ".financas-*.tmp" -Force | Remove-Item -Force -ErrorAction SilentlyContinue

    Set-Content -LiteralPath $Marca -Value $Hoje -Encoding ASCII

    if ($idadeDias -gt 2) {
        Write-Log "ATENCAO: o backup mais novo da VPS tem $idadeDias dias ($nome)."
        Show-Aviso "O backup mais novo da VPS e de $idadeDias dias atras ($nome).`nO backup automatico da VPS pode ter parado."
    }

    # Copia no Google Drive (cron da VPS, infra/scripts/enviar-backup-drive.sh): avisa se o ultimo envio envelheceu
    $drive = & ssh @Ssh $Host_ "cat ~/backups/.drive-ok 2>/dev/null" 2>$null
    if ("$drive" -match '^(\d{4}-\d{2}-\d{2})\s+(\S+)') {
        $diasDrive = ((Get-Date).Date - [datetime]::ParseExact($Matches[1], "yyyy-MM-dd", $null)).Days
        if ($diasDrive -gt 2) {
            Write-Log "ATENCAO: o ultimo envio ao Google Drive foi ha $diasDrive dias ($($Matches[2]))."
            Show-Aviso "O ultimo envio do backup ao Google Drive foi ha $diasDrive dias.`nVeja ~/backups/drive.log na VPS."
        }
    }
    else {
        Write-Log "Google Drive: nenhum envio registrado ainda na VPS."
    }
    exit 0
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
