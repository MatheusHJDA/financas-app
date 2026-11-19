# Preparar a VPS (OVHcloud, Ubuntu 26.04 LTS)

Este guia deixa o servidor seguro e pronto **antes** de instalar o app. O passo seguinte é o
[deploy-vps.md](deploy-vps.md), que começa no `git clone`.

VPS escolhida: OVHcloud, França, Ubuntu 26.04 LTS, 2 vCPU, 4 GB de RAM, 40 GB de SSD, IPv4. Endereço do app:
**`app.seudominio.com.br`** (subdomínio `app` do seu domínio; troque `seudominio.com.br` pelo seu em todos os
comandos).

Como fica a proteção:

| Camada | O que faz |
| --- | --- |
| SSH só com chave, porta alta, sem `root` | Ninguém entra por senha; robôs que varrem a porta 22 nem encontram o SSH |
| `ufw` (firewall do servidor) | Só deixa entrar: a porta do SSH, 80 e 443 |
| `fail2ban` | Bloqueia por 30 min quem erra o SSH 3 vezes em 5 min |
| Atualizações automáticas | Correções de segurança do Ubuntu instaladas sozinhas todo dia |
| Caddy (já no projeto) | HTTPS automático e proxy até o app; banco e API não ficam expostos |

Nos comandos abaixo:
- `<IP_DA_VPS>` é o IPv4 da VPS (painel da OVH).
- `<PORTA_SSH>` é a porta nova do SSH. Escolha **um número entre 49152 e 65535** (por exemplo, sorteie um) e anote no
  seu gerenciador de senhas junto com o IP. Não use o mesmo número dos exemplos de tutoriais.
- O usuário inicial das imagens Ubuntu da OVH é `ubuntu` (já tem `sudo`). Vamos usar ele mesmo, só com chave.

> **Regra de ouro:** em todo passo que mexe no SSH ou no firewall, **mantenha a janela do SSH atual aberta** e teste
> numa **segunda janela**. Só feche a primeira depois que a segunda entrou. Se mesmo assim ficar trancado do lado de
> fora, use o **modo de recuperação (rescue)** no painel da OVH.

---

## 1. No painel da OVH (navegador)

1. Anote o **IPv4** da VPS.
2. Se a VPS ainda não foi instalada (ou se preferir reinstalar do zero), escolha **Ubuntu 26.04** e cole a sua **chave
   SSH pública** no campo de chave. No PC ela está em `C:\Users\<você>\.ssh\id_ed25519.pub` (abra no Bloco de Notas e
   copie a linha inteira, que começa com `ssh-ed25519`). Assim o passo 3 já vem feito.
3. **Backup:** vale contratar o backup automático da OVH (cópia da VPS inteira), além do backup do banco que o app já
   faz ([deploy-vps.md](deploy-vps.md), seção 6). Opcional, mas recomendado.
4. **Network Firewall da OVH:** opcional. Se ligar, ele precisa permitir as mesmas portas do `ufw`: `<PORTA_SSH>`, 80
   e 443 (TCP). Se deixar desligado, o `ufw` já faz o trabalho.

## 2. No DNS do seu domínio (painel de onde o domínio está)

Crie **um** registro:

| Tipo | Nome | Valor | TTL |
| --- | --- | --- | --- |
| A | `app` | `<IP_DA_VPS>` | 3600 (ou o padrão) |

**Não crie registro AAAA** (IPv6) para `app` — o motivo está no [deploy-vps.md](deploy-vps.md), seção 1.

Confira no PC (PowerShell), depois de alguns minutos:

```powershell
nslookup app.seudominio.com.br
```

Deve responder com o `<IP_DA_VPS>`. O nome `app.seudominio.com.br` vira o endereço definitivo: as chaves de acesso
dos aparelhos ficam presas a ele, então não troque depois.

## 3. Primeiro acesso e chave SSH (PowerShell no PC)

```powershell
ssh ubuntu@<IP_DA_VPS>
```

Na primeira vez ele pergunta se confia no servidor: responda `yes`.

Se a chave **não** foi colada no painel (passo 1.2), a OVH manda a senha inicial por e-mail. Entre com ela e, numa
**segunda janela do PowerShell no PC**, envie a sua chave:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh ubuntu@<IP_DA_VPS> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Teste: `ssh ubuntu@<IP_DA_VPS>` deve entrar **sem pedir a senha da VPS** (no máximo a senha da sua chave, se ela tiver
uma). Se pedir a senha da VPS, a chave não foi aceita: não siga adiante.

Teste que **prova** a chave (proíbe a senha; deve entrar):

```powershell
ssh -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no ubuntu@<IP_DA_VPS>
```

Se der `Permission denied (publickey)`, compare a impressão digital dos dois lados (devem ser iguais):
`ssh-keygen -lf $env:USERPROFILE\.ssh\id_ed25519.pub` no PC e `ssh-keygen -lf ~/.ssh/authorized_keys` na VPS
(`~/.ssh` com `drwx------`, `authorized_keys` com `-rw-------`).

## 4. Atualizar o sistema e acertar o fuso (na VPS)

```bash
sudo apt update && sudo apt full-upgrade -y
sudo timedatectl set-timezone America/Sao_Paulo
sudo apt install -y ufw fail2ban unattended-upgrades ca-certificates curl git
```

Se aparecer `*** System restart required ***`, rode `sudo reboot`, espere um minuto e entre de novo.

## 5. Firewall (`ufw`)

Primeiro libera a porta 22 **e** a nova (a 22 sai no passo 6, depois do teste):

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow <PORTA_SSH>/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Responda `y` no `enable`. O `status` deve listar as quatro portas.

> O Docker abre portas por conta própria, passando por cima do `ufw`. No nosso projeto isso não abre nada a mais: na
> VPS só o Caddy publica portas (80 e 443); o banco e a API ficam na rede interna do Docker. Não acrescente `ports:`
> ao banco ou à api no compose da VPS.

## 6. SSH: só chave, sem `root`, porta nova

Crie o arquivo de configuração (o nome começa com `00-` para valer antes do arquivo que a própria OVH/cloud-init
coloca, que pode ligar a senha):

```bash
sudo tee /etc/ssh/sshd_config.d/00-financas.conf >/dev/null <<'EOF'
Port <PORTA_SSH>
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
EOF
```

Troque `<PORTA_SSH>` pelo número escolhido **dentro do arquivo** (o `tee` grava o texto exatamente como está; confira
com `cat /etc/ssh/sshd_config.d/00-financas.conf`).

No Ubuntu 26.04 o SSH é iniciado pelo `ssh.socket`, que **não** lê o `Port` desse arquivo (o gerador automático que
fazia isso não existe na imagem da OVH; testado em 18/11/2026). A porta é dada ao socket à parte. Primeiro com a 22
**e** a nova, para não ficar trancado fora:

```bash
sudo sshd -t && echo "configuração ok"
sudo mkdir -p /etc/systemd/system/ssh.socket.d
sudo tee /etc/systemd/system/ssh.socket.d/00-financas.conf >/dev/null <<'EOF'
[Socket]
ListenStream=
ListenStream=0.0.0.0:22
ListenStream=[::]:22
ListenStream=0.0.0.0:<PORTA_SSH>
ListenStream=[::]:<PORTA_SSH>
EOF
sudo systemctl daemon-reload
sudo systemctl restart ssh.socket
sudo ss -tlnp | grep -E ":22|:<PORTA_SSH>"
```

O `ss` deve mostrar a 22 e a `<PORTA_SSH>`. **Sem fechar a janela atual**, abra outra no PC e teste:

```powershell
ssh -p <PORTA_SSH> ubuntu@<IP_DA_VPS>
```

`Connection refused` = nada escutando na porta (o socket não pegou a porta nova). `Permission denied (publickey)` = a
porta está certa, mas a chave não está na VPS (volte ao teste do passo 3).

Entrou? Então tire a 22 do socket e do firewall (na VPS):

```bash
sudo tee /etc/systemd/system/ssh.socket.d/00-financas.conf >/dev/null <<'EOF'
[Socket]
ListenStream=
ListenStream=0.0.0.0:<PORTA_SSH>
ListenStream=[::]:<PORTA_SSH>
EOF
sudo systemctl daemon-reload
sudo systemctl restart ssh.socket
sudo ss -tlnp | grep -E ":22|:<PORTA_SSH>"
sudo ufw delete allow 22/tcp
sudo ufw status
```

O `ss` deve mostrar só a `<PORTA_SSH>`. Teste de novo `ssh -p <PORTA_SSH> ubuntu@<IP_DA_VPS>` antes de fechar a
janela antiga.

Para não ter de digitar porta e usuário toda vez, crie no PC o arquivo `C:\Users\<você>\.ssh\config` (sem extensão):

```
Host financas
    HostName <IP_DA_VPS>
    Port <PORTA_SSH>
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519
```

A partir daí basta `ssh financas`.

**Se não entrou pela porta nova:** volte à primeira janela (que ainda está conectada), rode
`sudo rm /etc/ssh/sshd_config.d/00-financas.conf /etc/systemd/system/ssh.socket.d/00-financas.conf && sudo systemctl daemon-reload && sudo systemctl restart ssh.socket`
e me mostre a saída do `ss` e do `sshd -t`.

## 7. `fail2ban`

```bash
sudo tee /etc/fail2ban/jail.local >/dev/null <<'EOF'
[DEFAULT]
bantime  = 30m
findtime = 5m
maxretry = 3
backend  = systemd

[sshd]
enabled = true
port    = <PORTA_SSH>
EOF
```

Troque `<PORTA_SSH>` no arquivo, depois:

```bash
sudo systemctl enable --now fail2ban
sudo systemctl restart fail2ban
sudo fail2ban-client status sshd
```

Deve mostrar `Currently banned: 0` (por enquanto). Cuidado: errar o SSH 3 vezes **do seu PC** também bloqueia o seu IP
por 30 minutos.

## 8. Atualizações automáticas de segurança

```bash
sudo dpkg-reconfigure -plow unattended-upgrades
```

Responda **Sim**. Para o servidor reiniciar sozinho de madrugada quando uma atualização pedir (o app volta sozinho:
os contêineres usam `restart: unless-stopped`):

```bash
sudo tee /etc/apt/apt.conf.d/52financas-reboot >/dev/null <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
```

## 9. Swap de 2 GB

O app usa menos de 1 GB no dia a dia; o swap é a folga para o pico de **construir as imagens**, para o Linux não
encerrar o Postgres se a memória acabar.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl --system >/dev/null
free -h
```

`free -h` deve mostrar `Swap: 2.0Gi`.

## 10. Docker (repositório oficial)

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Se o `apt update` reclamar que o repositório do Docker não tem o Ubuntu 26.04, me avise antes de improvisar.

Limite o tamanho dos logs dos contêineres (senão crescem sem fim no disco):

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
sudo systemctl restart docker
```

Deixe o `ubuntu` usar o Docker sem `sudo` (saia e entre de novo no SSH depois):

```bash
sudo usermod -aG docker ubuntu
exit
```

Teste, já reconectado:

```bash
docker run --rm hello-world
docker compose version
```

## 11. Acesso ao repositório privado (chave só de leitura)

A VPS precisa baixar o código do GitHub. Em vez da sua chave pessoal, ela ganha uma **chave própria, só de
leitura**, que vale apenas para este repositório:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_financas -N "" -C "vps-financas"
cat ~/.ssh/github_financas.pub
cat >> ~/.ssh/config <<'EOF'
Host github.com
    IdentityFile ~/.ssh/github_financas
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

No GitHub: repositório → **Settings → Deploy keys → Add deploy key**. Título `vps-financas`, cole a linha mostrada
pelo `cat`, **deixe "Allow write access" desmarcado** e salve. Teste na VPS:

```bash
ssh -T git@github.com
```

Deve responder `Hi <usuário>/<repositório>! You've successfully authenticated...` (responda `yes` na primeira vez).

## 12. Conferência final

Na VPS:

```bash
sudo ufw status                       # <PORTA_SSH>, 80, 443 — e nada da 22
sudo fail2ban-client status sshd      # jail ativa
sudo sshd -T | grep -E "^(port|permitrootlogin|passwordauthentication) "
free -h                               # swap 2.0Gi
docker run --rm hello-world           # Docker ok sem sudo
ssh -T git@github.com                 # chave de leitura ok
timedatectl | grep "Time zone"        # America/Sao_Paulo
```

No PC:

```powershell
ssh -p 22 ubuntu@<IP_DA_VPS>          # deve FALHAR (porta fechada)
ssh financas                          # deve entrar
nslookup app.seudominio.com.br        # IP da VPS
```

Tudo certo: siga para o [deploy-vps.md](deploy-vps.md), seção 2 (o `git clone` usa o endereço SSH do repositório,
`git@github.com:<usuário>/<repositório>.git`).
