# 🚀 Deploy do Bot Hub Lab C.O — Versão Final

Você já fez os passos 1 a 5. Agora só faltam os ajustes finais pra ficar 100%.

## ⚡ O QUE MUDOU (corrigido nesta versão)
1. Erro do `dotenv` resolvido (agora é opcional).
2. Palpites/ranking NÃO se perdem mais ao reiniciar (volume persistente).
3. Comandos slash ficam instantâneos no seu servidor (variável GUILD_ID).
4. Permissão do /resultado por Admin (mais confiável).
5. Bot não trava se a API falhar.

---

## PASSO A — Atualizar os arquivos no GitHub
Substitua no seu repositório os arquivos pelos novos desta pasta:
- index.js
- api.js
- palpites.js
- package.json

(Edite cada um no GitHub: abre o arquivo → lápis ✏️ → apaga tudo → cola o novo → Commit changes.)

---

## PASSO B — Adicionar variável GUILD_ID (comandos instantâneos)
1. Pegue o ID do seu servidor: no Discord, clique com botão direito no NOME do servidor (topo) → Copiar ID do servidor.
2. No Railway → aba Variables → New Variable:
   - Nome: `GUILD_ID`
   - Valor: o ID do servidor
3. Salve.

(Sem isso o bot funciona, mas os comandos podem levar até 1h pra aparecer. Com isso, aparecem na hora.)

---

## PASSO C — Criar volume persistente (NÃO perder os palpites)
IMPORTANTE: o Railway apaga arquivos ao reiniciar. O volume resolve isso.

1. No Railway, dentro do seu serviço Bot-futebol, procure a opção de criar **Volume**
   (clique com botão direito no serviço → "Attach Volume", ou aba Settings → Volumes → New Volume).
2. No campo "Mount path", digite exatamente:
   ```
   /data
   ```
3. Salve. O Railway cria o volume e define automaticamente a variável RAILWAY_VOLUME_MOUNT_PATH.
   O bot já está programado pra usar esse caminho.

---

## PASSO D — Confirmar variáveis
Confira que estão todas na aba Variables do Railway:

| Nome | Valor |
|---|---|
| DISCORD_TOKEN | token do Discord |
| FOOTBALL_API_KEY | chave do football-data.org |
| GUILD_ID | ID do servidor (novo) |
| CANAL_GOLS | ID do #gols-ao-vivo |
| CANAL_JOGOS | ID do #jogos-do-dia |
| CANAL_TABELA | ID do #tabelas-e-classificação |
| CANAL_PALPITES | ID do #palpites |
| CANAL_RANKING | ID do #ranking-geral |

---

## PASSO E — Deploy e teste
1. O Railway faz deploy sozinho ao salvar. Se não, clique em Deploy.
2. Veja os logs. Deve aparecer:
   ```
   ✅ Hub Lab C.O Bot online! Logado como Bot-futebol#1234
   Comandos registrados no servidor (instantâneo)!
   ```
3. No Discord, teste:
   - `/jogos`
   - `/tabela`
   - `/artilheiros`
   - `/palpite time_casa:Brasil gols_casa:2 gols_fora:1 time_fora:Haiti`
   - `/ranking`

---

## Se der erro
- `Cannot find module X` → faltou atualizar o package.json no GitHub.
- `DISCORD_TOKEN não configurado` → falta a variável ou está com espaço/erro de digitação.
- Comandos não aparecem → confira o GUILD_ID; espere 1 min após o deploy.
- Bot online mas não posta nos canais → confira os IDs dos canais e se o cargo do bot está acima dos canais na hierarquia.

Manda print do log que eu identifico na hora.
