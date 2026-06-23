# 🚀 Como colocar o bot no ar (Railway — grátis)

Siga essa ordem. Leva uns 20 minutos na primeira vez.

---

## PASSO 1 — Criar o bot no Discord Developer Portal

1. Acesse: https://discord.com/developers/applications
2. Clique em **New Application** → nome: `Hub Lab CO Bot` → Create.
3. No menu lateral, clique em **Bot**.
4. Clique em **Reset Token** → copie e guarde esse token (é o DISCORD_TOKEN).
5. Na mesma tela, ative as 3 opções:
   - ✅ Presence Intent
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. No menu lateral, clique em **OAuth2 → URL Generator**.
7. Em Scopes, marque: `bot` e `applications.commands`.
8. Em Bot Permissions, marque: `Send Messages`, `Embed Links`, `Read Message History`, `View Channels`.
9. Copie a URL gerada lá embaixo e abra no navegador → escolha o servidor Hub Lab C.O → Autorizar.

---

## PASSO 2 — Pegar a chave da API de futebol

1. Acesse: https://www.football-data.org/client/register
2. Cadastre com seu e-mail (grátis, sem cartão).
3. Após o cadastro, acesse https://www.football-data.org/client/dashboard
4. Copie sua **API Key** (é o FOOTBALL_API_KEY).

---

## PASSO 3 — Pegar os IDs dos canais do Discord

1. No Discord: Configurações (engrenagem) → Avançado → ative **Modo Desenvolvedor**.
2. Clique com botão direito em cada canal abaixo → **Copiar ID**:
   - #gols-ao-vivo → CANAL_GOLS
   - #jogos-do-dia → CANAL_JOGOS
   - #tabelas-e-classificação → CANAL_TABELA
   - #palpites → CANAL_PALPITES
   - #ranking-geral → CANAL_RANKING

---

## PASSO 4 — Criar conta e projeto no Railway

1. Acesse: https://railway.app
2. Faça login com GitHub (crie uma conta no GitHub se não tiver — é grátis).
3. Clique em **New Project → Deploy from GitHub repo**.

---

## PASSO 5 — Subir o código no GitHub

1. Acesse: https://github.com e crie um repositório **privado** chamado `hublab-bot`.
2. Faça o upload dos arquivos do bot:
   - index.js
   - api.js
   - palpites.js
   - package.json
   (NÃO suba o arquivo .env nem as credenciais)
3. Conecte o repositório ao Railway (ele vai pedir autorização no GitHub).

---

## PASSO 6 — Configurar as variáveis de ambiente no Railway

1. No projeto do Railway, clique na aba **Variables**.
2. Clique em **New Variable** e adicione uma por uma:

| Nome | Valor |
|---|---|
| DISCORD_TOKEN | o token do passo 1 |
| FOOTBALL_API_KEY | a chave do passo 2 |
| CANAL_GOLS | ID do #gols-ao-vivo |
| CANAL_JOGOS | ID do #jogos-do-dia |
| CANAL_TABELA | ID do #tabelas-e-classificação |
| CANAL_PALPITES | ID do #palpites |
| CANAL_RANKING | ID do #ranking-geral |

---

## PASSO 7 — Deploy

1. O Railway faz o deploy automaticamente quando você conecta o repositório.
2. Clique em **Deploy** se não iniciou sozinho.
3. Acompanhe os logs — deve aparecer:
   ```
   ✅ Hub Lab C.O Bot online! Logado como Hub Lab CO Bot#1234
   Comandos registrados!
   ```

---

## PASSO 8 — Testar

No Discord, vá em qualquer canal e digite:
- `/jogos` → mostra os jogos de hoje
- `/tabela` → classificação da Copa
- `/artilheiros` → top goleadores
- `/palpite time_casa:Brasil gols_casa:2 gols_fora:1 time_fora:Argentina`
- `/ranking` → placar de palpites

---

## Custo

- Railway: **grátis** (plano Hobby tem $5 de crédito grátis por mês — suficiente pra um bot leve)
- football-data.org: **grátis** (plano gratuito cobre Copa do Mundo)
- Discord Developer: **grátis**

Total: R$0 pra começar.

---

## Dúvidas frequentes

**O bot não responde aos comandos:** espere 1-2 minutos após o deploy para os comandos slash aparecerem no Discord.

**Erro "Missing Permissions":** verifique se o cargo do bot no servidor está acima dos canais que ele precisa escrever.

**Palpites não fecham automaticamente:** a detecção é por polling (a cada 30s). Se a API demorar pra marcar o jogo como IN_PLAY, pode haver um pequeno atraso — isso é normal no plano grátis.

**O Railway parou o bot:** o plano grátis tem limite mensal. Se esgotar, faça upgrade ou migre pra Oracle Cloud Always Free (uma VPS grátis para sempre — eu te guio nisso se precisar).
