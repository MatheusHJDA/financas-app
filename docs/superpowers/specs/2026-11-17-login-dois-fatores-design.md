# Login em duas etapas (PIN + chave de acesso) — desenho

Data: 17/11/2026. Decidido com Matheus. Pré-requisito da mudança para a VPS (`docs/deploy-vps.md`).

## Por quê

Na VPS o app fica exposto na internet, sem a Tailscale na frente (Matheus prefere não usá-la lá). O login de hoje é
nome escolhido numa lista + PIN de 6 dígitos (1 milhão de combinações; trava a conta após 5 erros por 15 min; sessão
de 30 dias renovada a cada uso). Isso basta numa rede fechada, mas não na internet: o PIN pode ser adivinhado aos
poucos, qualquer um consegue travar a conta da Ruth errando de propósito, e a tela de entrada mostra os nomes.

Objetivo: dados financeiros só para Matheus e Ruth, com um login forte que custe poucos segundos.

## Metas
- Duas etapas em todo login: **PIN** (algo que se sabe) + **chave de acesso** do aparelho (algo que se tem), liberada
  pelo Face ID / digital no celular e pelo **Windows Hello** no PC do Matheus (que ele usa para administrar e lançar).
- Verificação "toda vez": voltar ao app depois de um tempo fora pede as duas etapas de novo.
- Sem nomes na tela de entrada.
- Ninguém de fora consegue travar a conta de outra pessoa nem testar PINs em massa.
- Recuperação quando um aparelho é perdido ou trocado, sem depender de empresa externa.

## Fora (não-metas)
- Login do Google/SSO, porteiro externo (Cloudflare Access), Tailscale na VPS.
- Mais usuários, cadastro aberto, "esqueci meu PIN" por e-mail.
- Senha alfanumérica no lugar do PIN.

## Anti-metas (seria fracasso mesmo funcionando)
- Mensagens que revelem se o nome ou o PIN estão certos.
- Alguém ficar trancado para sempre (Matheus sem caminho de volta).
- Login tão lento que vire motivo para "deixar logado" de outro jeito.

## Abordagens consideradas
1. **Chave de acesso (passkey/WebAuthn) no próprio app** — resistente a phishing, sem terceiros, Face ID/digital/Hello.
2. Login do Google para dois e-mails — depende do Google; no iPhone o app instalado costuma perder a sessão no retorno
   do login do Google.
3. Porteiro na frente de tudo (Cloudflare Access ou oauth2-proxy/Authelia) — Cloudflare enxerga o tráfego aberto; a
   versão própria é mais uma peça para manter.

**Escolhida: 1 somada ao PIN** (Matheus: "duas camadas de segurança e custa pouco tempo para logar").

## Como funciona

### Fluxo de entrada
```
[ Seu nome: ____ ]         →   "Confirme neste aparelho"   →   Início
[ PIN: ● ● ● ● ● ● ]           [ Usar Face ID / Hello ]
```
1. A pessoa digita o nome e o PIN. **Nome**: aceito em maiúsculas/minúsculas e sem espaços nas pontas, mas só com as
   letras exatas ("Matheus", "Ruth"); `" MATHEUS "` vale, `"Mateus"` não.
2. **O servidor não diz se nome/PIN estão certos neste passo.** Sempre devolve um desafio de chave de acesso e guarda
   o resultado da etapa 1 numa tentativa pendente de curta duração (ex.: 2 min, uso único).
3. O aparelho pede Face ID / digital / Hello e assina o desafio. O servidor só abre a sessão se **as duas** etapas
   passarem e a chave for **da mesma pessoa** do nome digitado. Qualquer falha: a mesma mensagem genérica
   ("Não foi possível entrar. Confira o nome e o PIN.").
   - Por quê: sem o aparelho, quem tenta adivinhar o PIN nunca descobre se acertou.
4. A lista pública de nomes (`GET /auth/users`) deixa de existir.

### Sessão ("toda vez")
- Voltar ao app depois de **5 min** fora (app em segundo plano ou aba escondida) pede as duas etapas de novo.
- Sem atividade por **30 min** o servidor encerra a sessão, mesmo que o aparelho não avise (garantia do lado do
  servidor); duração máxima **12 h** mesmo em uso contínuo. Hoje: 30 dias renováveis.
- "Sair" continua encerrando a sessão do aparelho.
- Cada sessão registra se foi aberta com as duas etapas. Com `REQUIRE_PASSKEY=true`, sessões abertas só com PIN (as
  que vêm no banco restaurado do PC) não valem. (Chamada do lead.)
- Depois de entrar, o app volta para onde a pessoa ia (ex.: tocar no aviso das 21h abre `/lancar?meta=…` após o
  login). (Chamada do lead.)

### Cadastro de aparelhos e recuperação
- A chave de acesso fica presa ao **endereço** do site: chaves feitas no endereço da Tailscale não servem no domínio da
  VPS. Por isso o cadastro acontece **já no endereço definitivo**.
- **Código de liberação**: código de uso único, válido por 24 h, guardado só como hash. Com nome + PIN + código, a
  pessoa cadastra a chave do aparelho que está usando (e já entra).
  - Matheus (administrador) gera códigos para qualquer um em **Administração → Usuários**.
  - O **primeiro** código do Matheus (e qualquer emergência sem nenhum aparelho) sai por um comando no servidor
    (`docker compose ... exec api python -m finance_api.auth.release Matheus`), que só quem tem acesso SSH à VPS roda.
  - Ao cadastrar a primeira chave, o Matheus recebe **8 códigos de emergência** (uso único, mostrados uma vez) para
    usar se perder todos os aparelhos.
- Quem ainda não tem chave cadastrada não entra só com PIN: precisa de um código de liberação.
- **Aviso de aparelho novo**: ao cadastrar uma chave, os outros aparelhos da mesma pessoa recebem uma notificação
  ("Um aparelho novo foi liberado na sua conta: <nome do aparelho>").
- **Preferências → Aparelhos**: cada pessoa vê suas chaves (nome do aparelho, data, último uso) e remove as que não
  usa. Administração → Usuários: Matheus vê e remove as de qualquer um.
- Chaves sincronizadas (iCloud, Gerenciador de senhas do Google) são aceitas: são protegidas pela conta da pessoa.

### Contra tentativas em massa
- Limite por origem (IP real vindo do Caddy): **5 tentativas erradas em 15 min** bloqueiam aquela origem por 15 min.
- Trava por conta continua, mas mais alta (**20 erros em 1 h**) para que um estranho não consiga trancar a Ruth com
  facilidade; liberação imediata por Matheus em Administração.
- Toda entrada, falha relevante, cadastro/remoção de chave e uso de código fica na **auditoria**.

### Liga/desliga
- `REQUIRE_PASSKEY=true` liga as duas etapas; o endereço do site para as chaves vem de `PASSKEY_RP_ID`
  (= `DOMAIN`) e a origem aceita de `PASSKEY_ORIGIN` (`https://<DOMAIN>`).
- No PC (Tailscale), fica **desligado** até a virada: o app atual segue só com PIN e os testes de hoje não mudam.
  Ligado na VPS desde o primeiro dia.
- **Regra para o PIN mesmo com a chave desligada**: o nome digitado (sem lista) e o limite por origem valem nos dois
  modos.

## Restrições
- Celulares: iPhone (Matheus, Ruth) e Galaxy A13; chaves de acesso funcionam no app instalado (iOS 16+, Android 9+).
- PC do Matheus: Windows Hello (Chrome/Edge).
- pt-BR, alvos ≥ 48px, ok em 360px, temas claro/escuro, como o resto do app.
- Cookie de sessão continua `HttpOnly`, `Secure`, `SameSite=Strict`; só o hash do token no banco.
- Nada de serviço externo novo. Bibliotecas: `webauthn` (py_webauthn, Duo) na API e `@simplewebauthn/browser` no web
  — escolha do lead, ambas amplamente usadas.
- Testes e2e usam o autenticador virtual do Chromium (Playwright/CDP).

## Deixado para quem constrói
- Nomes de tabelas/colunas (chaves, tentativas pendentes, códigos), formato do código de liberação (sugestão: 10
  caracteres sem letras ambíguas, em grupos), textos exatos das telas além dos citados.
- Como o web detecta os 5 min fora (`visibilitychange` + horário guardado em memória).
- Ordem de migração de dados: usuários existentes começam sem chave; a migração não apaga nada.

## Na virada para a VPS
1. Subir a VPS com `REQUIRE_PASSKEY=true` e restaurar o banco.
2. Matheus gera o próprio código pelo comando no servidor, entra no celular e no PC e guarda os 8 códigos de emergência.
3. Matheus gera o código da Ruth em Administração; Ruth entra e cadastra o iPhone.
4. `docs/deploy-vps.md` e `docs/instalar-no-celular.md` ganham esses passos.
