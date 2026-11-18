# Instalar o app no celular

O app "Finanças" é um **PWA**: abre no navegador do celular e pode ser instalado na tela inicial, como um app
comum. Faça isto **uma vez em cada celular** (iPhone do Matheus, celular da Ruth, Galaxy A13).

> O endereço do app é o que o Matheus passar: hoje um `https://<nome>.<tailnet>.ts.net` (Tailscale) e, depois da
> migração para a VPS, um domínio próprio. **Se o endereço mudar, repita tudo desta página** (reinstale o app e
> reative as notificações): veja [deploy-vps.md](deploy-vps.md).

## 1. Tailscale no celular (enquanto o app roda no PC)

Enquanto o app roda no PC do Matheus, o endereço só abre com o Tailscale ligado no celular:

1. Instale o app **Tailscale** (App Store / Play Store).
2. Entre **na mesma conta** do Tailscale do PC (o Matheus compartilha o acesso ou entra com a mesma conta).
3. Deixe a chave do Tailscale **ligada** (aparece "Connected").

Na VPS (domínio próprio) isso não é necessário.

## 2. Abrir o endereço

Abra o endereço do app no navegador (**Safari** no iPhone, **Chrome** no Android). Deve aparecer a tela de entrada.
Se não abrir, confira o Tailscale (passo 1) e se o PC do Matheus está ligado.

## 3. Instalar

- **iPhone (Safari):** botão **Compartilhar** (quadrado com seta) → **Adicionar à Tela de Início** → **Adicionar**.
  Depois **feche o Safari e abra pelo ícone** novo. No iPhone as notificações só funcionam no app aberto pelo ícone.
- **Android (Chrome):** menu **⋮** → **Instalar app** (ou **Adicionar à tela inicial**) → **Instalar**.
  Abra pelo ícone.

Se já havia uma versão instalada antes, apague o ícone antigo e instale de novo.

## 4. Entrar com o PIN

Escolha o seu usuário e digite o PIN de 6 dígitos. Você fica conectado neste aparelho por cerca de 30 dias.
Para trocar um PIN, o Matheus redefine em **Mais → Administração → Usuários**.

## 5. Ativar as notificações

1. Abra o app **pelo ícone** (não pelo navegador).
2. **Mais → Preferências** → cartão **Notificações** → **Ativar notificações** → **Permitir**.
3. Deve aparecer **"Ativadas neste aparelho"**.

O app avisa o fechamento do dia ("Hora de enviar as movimentações de hoje") e as contas perto de vencer.
O Matheus consegue mandar uma notificação de teste em **Mais → Administração → Avisos do sistema**.

## Se a notificação não chegar

| O que aparece / acontece | O que fazer |
|---|---|
| "Notificações não configuradas no servidor" | O servidor está sem as chaves de push. Avise o Matheus (configuração `VAPID_*` do servidor). |
| "Instale o app na tela de início…" (iPhone) | O app foi aberto pelo Safari. Feche e abra **pelo ícone** na tela inicial. |
| "Notificações bloqueadas" | Ajustes do celular → Notificações → **Finanças** → permitir. Volte ao app e ative de novo. |
| Ativou, mas nada chega | No iPhone: o modo Foco/Não perturbe pode estar silenciando. Em **Mais → Preferências**, desative e ative as notificações de novo. Confirme que o app abre pelo ícone e que o celular tem internet. |
| Parou de chegar depois de uma troca de endereço ou de chaves do servidor | Em **Mais → Preferências → Notificações**, desative e ative de novo (a inscrição antiga deixou de valer). Se mudou o endereço do app, reinstale o app. |
| Avisos duplicados ou ausentes | Cada aviso sai **uma vez por dia**; para repetir um teste, só no dia seguinte (o teste de admin pode ser repetido à vontade). |

Se nada resolver, o Matheus confere no PC (ou na VPS) os logs do app procurando "Falha no tick de notificações" ou erro
de envio, e **Mais → Administração → Sistema** (o agendador deve estar ativo). O roteiro completo de teste está em
`.planning/teste-push.md`.
