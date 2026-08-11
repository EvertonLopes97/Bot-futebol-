// index.js — Bot principal da Hub Lab C.O
// Comandos: /jogos /tabela /artilheiros /palpite /ranking /resultado
// Automático: jogos do dia às 8h, gols ao vivo, fecha palpites antes do jogo

// dotenv é opcional (só pra rodar local). No Railway usa variáveis de ambiente.
try { require('dotenv').config(); } catch (e) { /* sem dotenv em produção, tudo certo */ }

const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, Routes, REST, PermissionsBitField } = require('discord.js');
const cron = require('node-cron');
const api  = require('./api');
const db   = require('./palpites');
const nv   = require('./niveis');
const wa   = require('./whatsapp');
const ap   = require('./apostas');
const dica = require('./dicadodia');
const fontes = require('./fontes');
const armaz = require('./armazenamento');
const servidor = require('./servidor');
const sync = require('./supabase-sync');
const estat = require('./estatisticas');
// const roteiro = require('./roteiro');  // DESATIVADO: era baseado em odds/apostas
const com = require('./comunidade');   // cargos de time + sequência de dias
const noticias = require('./noticias');  // radar de notícias + pauta do dia
const roteiroIA = require('./roteiro-ia');  // roteiro do vídeo escrito por IA
const verificar = require('./verificar');   // confere fatos na API antes de gravar
const engaj = require('./engajamento');     // post diário que gera discussão
const rlongo = require('./roteiro-longo');  // roteiros de 8+ min pro YouTube
const pesq = require('./pesquisa');         // apura fatos (Wikipédia + matérias)

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildInvites,
] });

const CH = {
  gols:       process.env.CANAL_GOLS,
  jogos:      process.env.CANAL_JOGOS,
  tabela:     process.env.CANAL_TABELA,
  palpites:   process.env.CANAL_PALPITES,
  ranking:    process.env.CANAL_RANKING,
  niveis:     process.env.CANAL_NIVEIS,
  fundadores: process.env.CANAL_FUNDADORES, // canal privado dos fundadores
  bemvindo:   process.env.CANAL_BEMVINDO,   // canal de boas-vindas públicas
  noticias:   process.env.CANAL_NOTICIAS,   // giro de notícias (público)
  engajamento: process.env.CANAL_ENGAJAMENTO, // post do dia que gera discussão
  pauta:      process.env.CANAL_PAUTA,      // pauta do dia (privado, só fundadores)
  geral:      process.env.CANAL_GERAL,      // fallback se não houver canal de boas-vindas
};
const CARGO_VIP = process.env.CARGO_VIP || 'VIP';
const LINK_SITE = process.env.SITE_URL || 'https://hublab.agency';
const AVISO_APOSTA = '⚠️ +18. Conteúdo recreativo e educativo, não é recomendação de aposta. Apostas envolvem risco de perda. Jogue com responsabilidade. Se precisar de ajuda: 0800 redes de apoio ao jogador.';
const CANAL_APOSTAS = process.env.CANAL_APOSTAS;
const LINK_DISCORD = process.env.WPP_LINK_DISCORD || 'https://discord.gg/seuconvite';
const GUILD_ID = process.env.GUILD_ID; // opcional: deixa comandos instantâneos

const COR_LIME = 0xC6F432, COR_GOL = 0xFF3D7F, COR_TABELA = 0x378ADD, COR_RANKING = 0xFFD700;

function canal(id) { return id ? client.channels.cache.get(id) : null; }

// ── CARGO AUTOMÁTICO TOP 100 ──
// Variável de ambiente: CARGO_TOP100 = nome ou ID do cargo
const CARGO_TOP100_NOME = process.env.CARGO_TOP100 || 'Top 100 Hub Lab';

// Cargo dado automaticamente a quem entra (dá acesso e marca "cheguei").
// Deixe vazio no .env pra desativar. Ex: CARGO_INICIAL=Torcedor
const CARGO_INICIAL_NOME = process.env.CARGO_INICIAL || '';

async function atualizarCargoTop100(discordClient, ranking) {
  try {
    const guild = discordClient.guilds.cache.first();
    if (!guild) return;
    // pega ou cria o cargo
    let cargo = guild.roles.cache.find(r => r.name === CARGO_TOP100_NOME);
    if (!cargo) {
      cargo = await guild.roles.create({
        name: CARGO_TOP100_NOME,
        colors: { primaryColor: 0xFFCF00 },
        color: 0xFFCF00, // amarelo Hub Lab
        hoist: true,     // aparece separado na lista
        reason: 'Cargo automático Top 100 palpitadores',
      });
      console.log(`[TOP100] ✅ Cargo "${CARGO_TOP100_NOME}" criado (ID: ${cargo.id})`);
    }
    // IDs que devem ter o cargo (top 100)
    const idsTop = new Set(ranking.slice(0,100).map(r => String(r.id || r.discord_id)).filter(Boolean));
    // busca todos os membros com o cargo atual
    await guild.members.fetch();
    const comCargo = guild.members.cache.filter(m => m.roles.cache.has(cargo.id));
    let adicionados = 0, removidos = 0;
    // remove quem saiu do top 100
    for (const [, membro] of comCargo) {
      if (!idsTop.has(membro.id)) {
        await membro.roles.remove(cargo).catch(() => {});
        removidos++;
      }
    }
    // adiciona quem entrou no top 100
    for (const id of idsTop) {
      const membro = guild.members.cache.get(id);
      if (membro && !membro.roles.cache.has(cargo.id)) {
        await membro.roles.add(cargo).catch(() => {});
        adicionados++;
      }
    }
    if (adicionados || removidos) {
      console.log(`[TOP100] ✅ Cargo atualizado: +${adicionados} adicionados, -${removidos} removidos`);
    }
  } catch (e) { console.error('[TOP100] ❌', e.message); }
}

// ════════ EMBEDS ════════
function embedJogosDoDia(jogos) {
  if (!jogos.length) return new EmbedBuilder().setColor(COR_LIME)
    .setTitle('⚽ Jogos de Hoje')
    .setDescription('Nenhum jogo hoje. Aproveita pra palpitar nos próximos! 😄')
    .setFooter({ text: 'Hub Lab C.O' });
  const linhas = jogos.map(j => {
    const placar = (j.golsCasa !== null && j.golsFora !== null) ? `**${j.golsCasa} x ${j.golsFora}**` : 'vs';
    const status = j.status === 'FINISHED' ? '✅' : j.status === 'IN_PLAY' ? '🔴 AO VIVO' : `🕐 ${j.hora}`;
    return `${status} **${j.casa}** ${placar} **${j.fora}**`;
  });
  return new EmbedBuilder().setColor(COR_LIME)
    .setTitle('⚽ Jogos de Hoje')
    .setDescription(linhas.join('\n'))
    .setFooter({ text: 'Hub Lab C.O • Use /palpite pra palpitar!' }).setTimestamp();
}
function embedGol(j) {
  const e = new EmbedBuilder().setColor(COR_GOL).setTitle('⚽ GOOOOL!')
    .setDescription(`## ${j.casa} **${j.golsCasa}** x **${j.golsFora}** ${j.fora}${j.autor || ''}`)
    .setFooter({ text: 'Hub Lab C.O • Futebol Brasileiro' }).setTimestamp();
  if (j.minuto && j.minuto !== '—') e.addFields({ name: '🕐 Minuto', value: `${j.minuto}'`, inline: true });
  return e;
}
function embedFimDeJogo(j) {
  const v = j.golsCasa > j.golsFora ? j.casa : j.golsFora > j.golsCasa ? j.fora : 'Empate';
  return new EmbedBuilder().setColor(COR_LIME).setTitle('🏁 Fim de Jogo!')
    .setDescription(`## ${j.casa} **${j.golsCasa}** x **${j.golsFora}** ${j.fora}`)
    .addFields({ name: '🏆 Resultado', value: v === 'Empate' ? '🤝 Empate!' : `🎉 Vitória do ${v}!` })
    .setFooter({ text: 'Hub Lab C.O' }).setTimestamp();
}
function embedTabela(grupos) {
  const embed = new EmbedBuilder().setColor(COR_TABELA)
    .setTitle('📊 Brasileirão — Classificação')
    .setFooter({ text: 'Hub Lab C.O' }).setTimestamp();
  for (const g of grupos.slice(0, 6)) {
    const nome = String(g.grupo).replace('GROUP_', 'Grupo ');
    const linhas = g.times.map(t => `${t.pos}. **${t.time}** — ${t.pts}pts | ${t.j}J (${t.sg > 0 ? '+' : ''}${t.sg})`).join('\n');
    embed.addFields({ name: `⚽ ${nome}`, value: linhas.slice(0, 1020) || 'Sem dados' });
  }
  return embed;
}
function embedArtilheiros(lista) {
  const m = ['🥇', '🥈', '🥉'];
  const linhas = lista.map((a, i) => `${m[i] || `${a.pos}.`} **${a.nome}** (${a.time}) — ${a.gols} gol${a.gols !== 1 ? 's' : ''}`).join('\n');
  return new EmbedBuilder().setColor(COR_GOL).setTitle('🥇 Brasileirão — Artilheiros')
    .setDescription(linhas || 'Ainda sem gols marcados.')
    .setFooter({ text: 'Hub Lab C.O' }).setTimestamp();
}
function embedRanking(lista) {
  if (!lista.length) return new EmbedBuilder().setColor(COR_RANKING)
    .setTitle('🏆 Ranking de Palpites — Hub Lab C.O')
    .setDescription('Nenhum palpite pontuado ainda. Joga lá! /palpite').setFooter({ text: 'Hub Lab C.O' });
  const m = ['🥇', '🥈', '🥉'];
  const linhas = lista.slice(0, 10).map((p, i) =>
    `${m[i] || `${i + 1}.`} **${p.nome}** — **${p.pts} pts** | ${p.exatos} exato${p.exatos !== 1 ? 's' : ''} | ${p.participacoes} palpite${p.participacoes !== 1 ? 's' : ''}`).join('\n');
  return new EmbedBuilder().setColor(COR_RANKING).setTitle('🏆 Ranking de Palpites — Hub Lab C.O')
    .setDescription(linhas)
    .setFooter({ text: 'Exato = 10pts | Resultado certo = 3pts | Participou = 1pt' }).setTimestamp();
}

function embedProximos(jogos) {
  if (!jogos.length) return new EmbedBuilder().setColor(COR_LIME)
    .setTitle('📅 Próximos Jogos')
    .setDescription('Sem jogos agendados no momento.').setFooter({ text: 'Hub Lab C.O' });
  const linhas = jogos.map(j => `📅 ${j.data} ${j.hora} — **${j.casa}** vs **${j.fora}**`);
  return new EmbedBuilder().setColor(COR_LIME)
    .setTitle('📅 Próximos Jogos')
    .setDescription(linhas.join('\n'))
    .setFooter({ text: 'Hub Lab C.O • Use /palpite pra dar seu palpite!' }).setTimestamp();
}

// ════════ AUTOMAÇÕES (polling inteligente) ════════
const placarAnterior = {};
const ultimoPlacarPostado = {};
const horaInicioJogo = {};
const palpitesFechados = new Set();
const jogosEncerrados = new Set();

// ── AGENDADOR ROBUSTO (à prova de timezone do Railway) ──
// Em vez de depender do timezone do cron, checa o horário de Brasília a cada minuto.
const tarefasFeitas = {}; // controla pra não repetir no mesmo dia

function horaBrasilia() {
  const s = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour12: false });
  const d = new Date(s);
  return { h: d.getHours(), m: d.getMinutes(), dia: d.toLocaleDateString('pt-BR') };
}

async function agendaDoDia() {
  const ch = canal(CH.jogos);
  if (!ch) return;
  const jogos = await api.jogosDoDia();
  if (!jogos.length) {
    ch.send('📅 **Agenda de hoje:** sem jogos dos nossos clubes hoje. Volte amanhã! ⚽').catch(() => {});
    // mesmo sem jogo hoje, tenta criar o bolão de AMANHÃ (pra palpitar na véspera)
    await definirBoloesDaRodada();
    return;
  }
  ch.send({ embeds: [embedJogosDoDia(jogos)] }).catch(e => console.error('Envio agenda:', e.message));
  const lista = jogos.map(j => `• ${j.casa} x ${j.fora} (${j.hora})`).join('\n');
  wa.enviar(`⚽ *JOGOS DE HOJE*\n${lista}\n\n👉 Palpita agora: ${LINK_SITE}/dashboard.html\n📱 Discord: ${LINK_DISCORD}`);
  console.log(`[AGENDA] disparada com ${jogos.length} jogos`);

  // ── BOLÕES DA RODADA: um por competição (Brasileirão, Liberta, Copa do Brasil...) ──
  const boloes = await definirBoloesDaRodada();
  for (const b of boloes) {
    const titulo = b.rodada != null ? `${b.rodada}ª RODADA — ${b.competicao}` : `${b.competicao}${b.fase ? ' — ' + b.fase : ''}`;
    ch.send(`🎯 **BOLÃO DA RODADA!**\n\n**${titulo}**\n**${b.time_casa} x ${b.time_fora}** — ${b.data} ${b.hora || ''}\n\nCrave o **placar exato** e vire o 👑 Rei do Exato! Use **/exato** pra palpitar.`).catch(() => {});
    wa.enviar(`🎯 *BOLÃO DA RODADA!*\n\n${titulo}\n${b.time_casa} x ${b.time_fora}\n\nCrave em: ${LINK_SITE}/dashboard.html\n📱 Discord: ${LINK_DISCORD}`);
  }
  if (boloes[0]) servidor.setEstado('bolaoExato', boloes[0]);

}

// Define UM bolão por competição, sempre da rodada MAIS PRÓXIMA de cada uma.
// Brasileirão → jogo mais relevante da rodada atual.
// Libertadores/Copa do Brasil → jogo mais relevante da fase atual.
// Só entram jogos que AINDA NÃO começaram (dá tempo de palpitar).
async function definirBoloesDaRodada() {
  try {
    // 1) Qual é a rodada ATUAL do Brasileirão? Pergunta pra API (não adivinha).
    const rodadaLiga = await api.rodadaAtualLiga();
    if (rodadaLiga) await sync.salvarRodadaAtual(rodadaLiga);

    const [deHoje, proximos] = await Promise.all([api.jogosDoDia(), api.proximosJogos()]);
    let abertos = [...deHoje, ...proximos].filter(j => ['SCHEDULED', 'TIMED'].includes(j.status));
    if (!abertos.length) { console.log('[EXATO] nenhum jogo aberto pra bolão.'); return []; }

    // Remove jogos ATRASADOS (rodada 2+ atrás da atual) — eles não devem virar o bolão da rodada.
    if (rodadaLiga != null) {
      abertos = abertos.filter(j => j.rodada == null || Number(j.rodada) >= rodadaLiga - 1);
    }

    // Dedup por jogo (o mesmo jogo pode vir de jogosDoDia e proximosJogos)
    const vistos = new Set();
    abertos = abertos.filter(j => { if (vistos.has(j.id)) return false; vistos.add(j.id); return true; });

    // 2) Agrupa por competição + rodada/fase
    const grupos = {};
    for (const j of abertos) {
      const comp = j.competicao || 'Outra';
      const ident = j.rodada != null ? `R${j.rodada}` : (j.fase || j.data);
      const k = `${comp}|${ident}`;
      (grupos[k] = grupos[k] || []).push(j);
    }

    // 3) Escolhe UM grupo por competição = a rodada/fase que vai ser jogada PRIMEIRO
    //    (menor data entre os jogos abertos). Assim o bolão é sempre do próximo jogo
    //    palpitável — resolve a sobreposição rodada 19/20 do Brasileirão.
    const porComp = {};
    for (const [k, jogos] of Object.entries(grupos)) {
      const comp = k.split('|')[0];
      const dataMin = jogos.map(j => j.data).sort()[0];
      const atual = porComp[comp];
      if (!atual || dataMin < atual.dataMin) porComp[comp] = { jogos, dataMin };
    }

    // 4) Em cada grupo, o jogo mais relevante vira o bolão
    const criados = [];
    for (const { jogos } of Object.values(porComp)) {
      const escolhido = jogos
        .map(j => ({ ...j, score: dica.relevanciaJogo(j) }))
        .sort((a, b) => b.score - a.score)[0];
      if (!escolhido) continue;
      const b = await sync.definirBolaoRodada(escolhido);
      if (b) criados.push(b);
    }
    if (!criados.length) console.log('[EXATO] nenhum bolão criado.');
    return criados;
  } catch (e) { console.error('[EXATO] erro ao definir bolões da rodada:', e.message); return []; }
}

// Verificador que roda a cada minuto e dispara as tarefas no horário certo de Brasília
setInterval(async () => {
  const { h, m, dia } = horaBrasilia();
  const marca = (nome) => `${dia}_${nome}`;
  const jaFez = (nome) => tarefasFeitas[marca(nome)];
  const marcar = (nome) => { tarefasFeitas[marca(nome)] = true; };

  // [DESATIVADO] O roteiro antigo das 6h era baseado em odds/apostas.
  // Substituído pelo roteiro-ia.js (7h30 manhã e 21h noite), que fala de
  // NOTÍCIA em vez de aposta. Motivo: conteúdo de aposta reduz alcance e
  // monetização no YouTube/TikTok, e afasta patrocinador fora do setor.
  // O roteiro.js continua no repositório caso queira reativar.
  // 07:30 → PAUTA DO DIA no canal privado (você acorda com o vídeo pronto
  // pra gravar antes de sair pro trabalho às 8:40)
  if (h === 7 && m === 30 && !jaFez('pauta0730')) {
    marcar('pauta0730');
    console.log('[AGENDA] 7h30 — pauta do dia pros fundadores');
    try {
      await noticias.postarNoticias(client, {
        canalPrivado: CH.pauta || CH.fundadores,
        quantidade: 5,
      });
      // roteiro curto da manhã (TikTok/Reels)
      const ch = canal(CH.pauta) || canal(CH.fundadores);
      if (ch) {
        const r = await roteiroIA.gerarRoteiro({ periodo: 'manha' });
        if (!r.erro) await roteiroIA.enviarRoteiro(ch, r, 'manha');
        // e o roteiro LONGO de curiosidade (8+ min pro YouTube)
        const rc = await rlongo.roteiroCuriosidade().catch(() => ({ erro: 'falhou' }));
        if (!rc.erro) await rlongo.enviar(ch, rc, 'curiosidade');
      }
    } catch (e) { console.error('[NOTICIAS] pauta:', e.message); }
  }

  // 18:00 → POST DO DIA no chat (hora que a galera chega do trabalho e
  // abre o celular — melhor janela pra gerar conversa)
  if (h === 18 && m === 0 && !jaFez('postodia')) {
    marcar('postodia');
    console.log('[AGENDA] 18h — post do dia');
    try {
      await engaj.postarDoDia(client, CH.engajamento || CH.geral);
    } catch (e) { console.error('[ENGAJAMENTO]', e.message); }
  }

  // 21:00 → roteiro da noite (vídeo de análise pro YouTube)
  if (h === 21 && m === 0 && !jaFez('roteiroNoite')) {
    marcar('roteiroNoite');
    console.log('[AGENDA] 21h — roteiro da noite');
    try {
      const ch = canal(CH.pauta) || canal(CH.fundadores);
      if (ch) {
        const jogos = await api.jogosDoDia().catch(() => []);
        // roteiro LONGO de notícias / resumo da rodada (8+ min pro YouTube)
        const rn = await rlongo.roteiroNoticias(jogos).catch(() => ({ erro: 'falhou' }));
        if (!rn.erro) await rlongo.enviar(ch, rn, 'noticias');
      }
    } catch (e) { console.error('[ROTEIRO-IA] noite:', e.message); }
  }

  // 12:00 e 19:00 → giro de notícias no canal público da comunidade
  if (((h === 12 && m === 0) || (h === 19 && m === 0)) && !jaFez(`giro${h}`)) {
    marcar(`giro${h}`);
    console.log(`[AGENDA] ${h}h — giro de notícias`);
    try {
      await noticias.postarNoticias(client, {
        canalPublico: CH.noticias,
        quantidade: 4,
      });
    } catch (e) { console.error('[NOTICIAS] giro:', e.message); }
  }

  // 11:00 → agenda do dia (TODOS os jogos, mesmo TIMED) + odds
  if (h === 7 && m === 0 && !jaFez('agenda07')) {
    marcar('agenda07');
    console.log('[AGENDA] 7h — disparando agenda do dia');
    await agendaDoDia();
    await entregaOdds('Odds do dia ⚽');

    // Segunda-feira: atualiza os elencos do Jogo da Memória (fotos incluídas)
    const diaSemana = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Sao_Paulo' });
    if (diaSemana === 'Mon' && !jaFez('elencos07')) {
      marcar('elencos07');
      console.log('[AGENDA] segunda 7h — atualizando elencos do Jogo da Memória');
      try {
        const { popularJogadores } = require('./popular-jogadores.js');
        const r = await popularJogadores((msg) => console.log(msg));
        if (r.ok) console.log(`[JOGADORES] refresh semanal: ${r.jogadores} jogadores (${r.comFoto} c/ foto)`);
      } catch (e) { console.error('[JOGADORES] refresh semanal falhou:', e.message); }
    }
  }
  // 20:00 → odds pra amanhã
  if (h === 20 && m === 0 && !jaFez('odds20')) {
    marcar('odds20');
    await entregaOdds('Odds pra amanhã — prepare os palpites! ⚽');
  }
  // 23:00 → recap do dia
  if (h === 23 && m === 0 && !jaFez('recap23')) {
    marcar('recap23');
    console.log('[AGENDA] 23h — recap do dia');
    try { await recapDoDia(); } catch (e) { console.error('[RECAP]', e.message); }
  }
}, 60 * 1000); // checa a cada minuto

// Recap diário: resumo do dia no canal de ranking
async function recapDoDia() {
  const jogosHoje = await api.jogosDoDia();
  const todosPalpites = db.todosOsPalpitesDoDia(jogosHoje);
  // Ranking do recap: lê o ranking_site (Supabase) — o ranking ÚNICO, o mesmo
  // que o site usa. Antes lia db.ranking() (memória do Discord), que vinha
  // vazio e fazia o recap do WhatsApp sair sem Top 3.
  // Fallback pro db.ranking() se o Supabase falhar: melhor defasado que mudo.
  let rk = [];
  try {
    rk = await sync.buscarRankingSite(3);
  } catch (e) {
    console.error('[RECAP] falhou ao ler ranking_site, usando fallback:', e.message);
  }
  if (!rk.length) {
    rk = (db.ranking() || []).slice(0, 3).map(r => ({ nome: r.nome, pontos: r.pts, exatos: r.exatos }));
  }

  if (!todosPalpites.length && !rk.length) return;
  const exatosHoje = todosPalpites.filter(p => p.acertouExato);
  let msg = `🌙 **RECAP DO DIA — ${new Date().toLocaleDateString('pt-BR')}**\n\n`;
  msg += `📊 **${todosPalpites.length}** palpites foram feitos hoje!\n`;
  if (exatosHoje.length) {
    msg += `🎯 **Cravaram o exato:** ${exatosHoje.map(p => p.nome).join(', ')}\n`;
  }
  msg += `\n🏆 **Top 3 do ranking:**\n`;
  // .pontos vem do ranking_site; .pts vem do fallback do Discord. Aceita os dois
  // pra nunca imprimir "undefined pts" no grupo.
  rk.slice(0, 3).forEach((r, i) => {
    const pts = (r.pontos ?? r.pts ?? 0);
    msg += `${['🥇','🥈','🥉'][i]} ${r.nome} — ${pts}pts\n`;
  });
  msg += `\n🌐 Palpite amanhã: ${LINK_SITE}/dashboard.html`;
  const chR = canal(CH.ranking) || canal(CH.palpites);
  if (chR) chR.send(msg).catch(() => {});
  wa.enviar(msg.replace(/\*\*/g, '*'));
}


// Monitor com frequência adaptável:
// - SEM jogo ao vivo: espera 15 min (economiza chamadas)
// - COM jogo ao vivo: checa a cada 45s (pega os gols)
let temJogoAoVivo = false;

async function checarAoVivo() {
  let proximoDelay;
  try {
    // Estratégia robusta p/ plano grátis: monitora TODOS os jogos do dia,
    // não só os marcados como IN_PLAY (que a API grátis quase não marca).
    const jogos = await api.jogosDoDia();
    const chGols = canal(CH.gols);
    let temAtivo = false;

    // LOG DE DIAGNÓSTICO: mostra o que o monitor está vendo a cada ciclo
    servidor.setEstado('jogosHoje', jogos);
    servidor.setEstado('aoVivo', jogos.filter(j => j.golsCasa !== null && j.status !== 'FINISHED'));
    // número de membros do servidor Discord
    try {
      const guild = client.guilds.cache.first();
      if (guild) servidor.setEstado('membros', guild.memberCount);
    } catch {}
    try {
      const rk = db.ranking().slice(0, 100);
      servidor.setEstado('ranking', rk.slice(0, 20));
      if (nv && nv.rankingXp) servidor.setEstado('rankingXP', nv.rankingXp().slice(0, 20));
      sync.syncRanking(rk);       // → Supabase (loga)
      // sincroniza jogos de hoje + próximos jogos (pra sempre ter o que palpitar)
      let jogosParaSync = jogos;
      try {
        const proximos = await api.proximosJogos();
        // junta hoje + próximos, sem duplicar por id
        const ids = new Set(jogos.map(j => String(j.id)));
        const extras = (proximos || []).filter(p => !ids.has(String(p.id)));
        jogosParaSync = [...jogos, ...extras];
      } catch (e) { console.error('[SYNC] próximos jogos:', e.message); }
      sync.syncJogos(jogosParaSync);  // → Supabase (loga)
      // Cargo automático Top 100
      atualizarCargoTop100(client, rk).catch(e => console.error('[TOP100]', e.message));
    } catch (e) {}
    if (jogos.length) {
      console.log(`[MONITOR] ${jogos.length} jogo(s) hoje:`,
        jogos.map(j => `${j.casa} ${j.golsCasa ?? '-'}x${j.golsFora ?? '-'} ${j.fora} [${j.status}]`).join(' | '));
    } else {
      console.log('[MONITOR] nenhum jogo encontrado para hoje. Canal gols configurado:', !!chGols);
    }

    // Se há jogo rolando, aciona a API brasileira de backup (economiza quota)
    const temJogoRolando = jogos.some(j => j.status === 'IN_PLAY' || j.status === 'PAUSED' ||
      (j.golsCasa !== null && j.status !== 'FINISHED'));
    let backup = null;
    if (temJogoRolando) backup = await fontes.golsBackup();

    for (const jogo of jogos) {
      const key = String(jogo.id);
      const status = jogo.status; // SCHEDULED, TIMED, IN_PLAY, PAUSED, FINISHED
      const ant = placarAnterior[key];

      // ── INÍCIO DO JOGO: status virou IN_PLAY (ou já tem placar e não fechou) ──
      const comecou = (status === 'IN_PLAY' || status === 'PAUSED' ||
                       (jogo.golsCasa !== null && status !== 'FINISHED'));
      if (comecou && !palpitesFechados.has(key)) {
        db.fecharPalpites(key, jogo.casa, jogo.fora);
        palpitesFechados.add(key);
        horaInicioJogo[key] = Date.now(); // marca início p/ janela de 2h30
        const chP = canal(CH.palpites);
        if (chP) chP.send(`🔒 **Bola rolando! ${jogo.casa} x ${jogo.fora} começou!** Palpites fechados.`).catch(() => {});
        if (chGols) chGols.send(`🟢 **COMEÇOU!** ${jogo.casa} x ${jogo.fora} — bola rolando! ⚽`).catch(() => {});
        wa.enviar(`🟢 *COMEÇOU!* ${jogo.casa} x ${jogo.fora}

👉 Palpita e acompanha no Discord: ${LINK_DISCORD}`);
      }

      // ── GOL AO VIVO: avisa na hora; se anular, corrige ──
      if (backup && status !== 'FINISHED' && jogo.golsCasa !== null) {
        const conc = fontes.conciliar(jogo, backup);
        jogo.golsCasa = conc.golsCasa;
        jogo.golsFora = conc.golsFora;
      }
      const golsAtual = (jogo.golsCasa ?? 0) + '-' + (jogo.golsFora ?? 0);
      const inicio = horaInicioJogo[key];
      const dentroDaJanela = inicio && (Date.now() - inicio) <= (2.5 * 60 * 60 * 1000); // 2h30

      if (ant !== undefined && jogo.golsCasa !== null && status !== 'FINISHED') {
        const totalAtual = (jogo.golsCasa ?? 0) + (jogo.golsFora ?? 0);
        const totalAnt = ant.totalGols ?? 0;

        if (totalAtual > totalAnt) {
          // GOL — avisa na hora (Opção A)
          let autor = '';
          try {
            const ev = await fontes.ultimoEvento(jogo);  // DadosFutebol: autor/cartão
            if (ev && ev.autorGol) autor = `\n🎯 Gol de **${ev.autorGol}**`;
          } catch {}
          if (chGols) chGols.send({ embeds: [embedGol({ casa: jogo.casa, fora: jogo.fora, golsCasa: jogo.golsCasa, golsFora: jogo.golsFora, minuto: '—', autor })] }).catch(() => {});
          // GOL no WhatsApp DESATIVADO (evita flood no grupo). Reativar: descomente a linha abaixo.
          // wa.enviar(`⚽ *GOL!* ${jogo.casa} ${jogo.golsCasa} x ${jogo.golsFora} ${jogo.fora}${autor ? `\n${autor.replace(/\*/g,'')}` : ''}\n\n🌐 ${LINK_SITE}\n📱 ${LINK_DISCORD}`);
        } else if (totalAtual < totalAnt) {
          // GOL ANULADO — o placar diminuiu
          if (chGols) chGols.send(`❌ **Gol anulado!** ${jogo.casa} ${jogo.golsCasa} x ${jogo.golsFora} ${jogo.fora}`).catch(() => {});
          // Gol anulado no WhatsApp DESATIVADO (evita flood). Reativar: descomente abaixo.
          // wa.enviar(`❌ *Gol anulado!* ${jogo.casa} ${jogo.golsCasa} x ${jogo.golsFora} ${jogo.fora}`);
        }
      }

      // ── FIM DE JOGO: status virou FINISHED e ainda não processamos ──
      if (status === 'FINISHED' && !jogosEncerrados.has(key) && jogo.golsCasa !== null) {
        jogosEncerrados.add(key);
        if (!palpitesFechados.has(key)) { db.fecharPalpites(key, jogo.casa, jogo.fora); palpitesFechados.add(key); }
        if (chGols) chGols.send({ embeds: [embedFimDeJogo({ casa: jogo.casa, fora: jogo.fora, golsCasa: jogo.golsCasa, golsFora: jogo.golsFora })] }).catch(() => {});
        wa.enviar(`🏁 *FIM!* ${jogo.casa} ${jogo.golsCasa} x ${jogo.golsFora} ${jogo.fora}

👉 Veja o ranking no Discord: ${LINK_DISCORD}`);
        const resultados = db.pontuar(key, jogo.golsCasa, jogo.golsFora);
        const chR = canal(CH.ranking);
        if (chR && Object.keys(resultados).length > 0) chR.send({ embeds: [embedRanking(db.ranking())] }).catch(() => {});
        // grava o ranking atualizado no Supabase (loga)
        sync.syncRanking(db.ranking().slice(0, 50));
        console.log(`[PONTUACAO] jogo ${key} pontuado: ${Object.keys(resultados).length} palpite(s)`);
        // DM pra cada palpitador com o resultado dele
        for (const [userId, res] of Object.entries(resultados)) {
          client.users.fetch(userId).then(u => {
            let msg;
            if (res.acertouExato) msg = `🎯 **CRAVOU O EXATO!** Você acertou ${jogo.casa} ${jogo.golsCasa}x${jogo.golsFora} ${jogo.fora} e ganhou **10 pontos**! Você tá voando! 🚀`;
            else if (res.acertouResultado) msg = `✅ **Acertou o resultado!** ${jogo.casa} ${jogo.golsCasa}x${jogo.golsFora} ${jogo.fora}. Você ganhou **3 pontos**!`;
            else msg = `⚽ ${jogo.casa} ${jogo.golsCasa}x${jogo.golsFora} ${jogo.fora} acabou. Dessa vez não foi (você palpitou ${res.palpiteCasa}x${res.palpiteFora}), mas +1 ponto por participar! Bora pra próxima. 💪`;
            u.send(`${msg}\n\n🌐 Veja seu ranking: ${LINK_SITE}/dashboard.html`).catch(() => {});
          }).catch(() => {});
        }
        // apura os palpites do SITE (soma pontos no ranking)
        sync.apurarPalpitesSite(String(jogo.id), jogo.golsCasa, jogo.golsFora).catch(e => console.error('[APURAR-SITE]', e.message));
        // apura o bolão exato (se este era o jogo do dia)
        sync.apurarBolaoExato(String(jogo.id), jogo.golsCasa, jogo.golsFora).then(cravaram => {
          if (cravaram && cravaram.length && chGols) {
            const nomes = cravaram.map(c => c.nome).join(', ');
            chGols.send(`🎯👑 **BOLÃO EXATO!** ${nomes} cravou o placar ${jogo.golsCasa}x${jogo.golsFora} de ${jogo.casa} x ${jogo.fora}! Novo Rei do Exato!`).catch(() => {});
            wa.enviar(`🎯👑 *BOLÃO EXATO!* ${nomes} cravou ${jogo.golsCasa}x${jogo.golsFora}! 🌐 ${LINK_SITE}/dashboard.html\n📱 ${LINK_DISCORD}`);
          }
        });
      }

      // Marca jogo ativo (sem postar parciais)
      if (comecou && status !== 'FINISHED' && jogo.golsCasa !== null && dentroDaJanela) temAtivo = true;

      // Atualiza o baseline (guarda total de gols p/ comparar)
      if (jogo.golsCasa !== null) placarAnterior[key] = { placar: golsAtual, status, totalGols: (jogo.golsCasa ?? 0) + (jogo.golsFora ?? 0) };
    }

    // Frequência: tem jogo em andamento → 2 min; senão se há jogo hoje → 5 min; senão → 8 min
    proximoDelay = temAtivo ? 2 * 60 * 1000 : (jogos.some(j => j.status !== 'FINISHED') ? 5 * 60 * 1000 : 8 * 60 * 1000);
  } catch (e) {
    console.error('Monitor ao vivo:', e.message);
    proximoDelay = 5 * 60 * 1000;
  }
  setTimeout(checarAoVivo, proximoDelay);
}


async function montarDicaDoDia() {
  const jogos = await dica.buscarOddsDoDia();
  if (!jogos.length) return null;
  const dd = dica.dicasDoDia(jogos);
  const e = new EmbedBuilder().setColor(0x1D9E75).setTitle('📊 Dicas do Dia — Análise de Odds');

  if (dd.destaques.length) {
    const destaque = dd.destaques.map((j, i) => {
      const fav = (j.melhor.casa.odd && j.melhor.casa.odd <= (j.melhor.fora.odd||99))
        ? `${j.casa} (odd ${j.melhor.casa.odd} na ${j.melhor.casa.book})`
        : `${j.fora} (odd ${j.melhor.fora.odd} na ${j.melhor.fora.book})`;
      return `**${i+1}. ${j.casa} x ${j.fora}** \u2b50\nMelhor cotação: ${fav}`;
    }).join('\n\n');
    e.addFields({ name: '🔥 Jogos em destaque hoje', value: destaque });
  }
  if (dd.outras.length) {
    const outras = dd.outras.map(j => `• ${j.casa} x ${j.fora}`).join('\n');
    e.addFields({ name: '📋 Outras dicas do dia', value: outras });
  }

  // Múltipla dos sonhos (mercados de craque são ilustrativos)
  const mercadosCraques = [
    { mercado: '+9.5 escanteios no jogo do favorito', odd: 2.5, book: 'estimado' },
    { mercado: 'Craque finaliza no gol', odd: 1.8, book: 'estimado' },
    { mercado: 'Gol de artilheiro escolhido', odd: 2.2, book: 'estimado' },
  ];
  const m = dica.multiplaDosSonhos(jogos, mercadosCraques);
  if (m) {
    const linhas = m.pernas.map(p => `• ${p.mercado} (odd ${p.odd})`).join('\n');
    e.addFields({ name: `🌟 Múltipla dos Sonhos (odd ${m.combinada})`,
      value: `${linhas}\n\n💭 Chance real: **${m.probRealPct}%** (${m.chance}) — é o sonho, divirta-se!` });
  }
  e.setFooter({ text: AVISO_APOSTA });
  return e;
}

function embedMultipla(a) {
  const linhas = a.pernas.map((p,i) => `${i+1}. ${p.mercado} — odd **${p.odd}**`).join('\n');
  const e = new EmbedBuilder()
    .setColor(a.evPositivo ? 0x1D9E75 : 0xEF9F27)
    .setTitle('🎲 Análise de Múltipla')
    .setDescription(linhas)
    .addFields(
      { name: 'Odd combinada', value: `${a.oddCombinada}x`, inline: true },
      { name: 'Aposta', value: `R$ ${a.valorApostado}`, inline: true },
      { name: 'Retorno', value: `R$ ${a.retorno}`, inline: true },
      { name: 'Chance real estimada', value: `${a.probRealPct}% (${a.chance})`, inline: true },
      { name: 'Nível', value: a.nivel, inline: true },
      { name: 'Valor esperado', value: a.evPositivo ? `+R$ ${a.ev} ✅` : `R$ ${a.ev} ⚠️`, inline: true },
    )
    .setFooter({ text: AVISO_APOSTA });
  return e;
}

function embedNivel(st, userId) {
  if (!st) return new EmbedBuilder().setColor(COR_LIME).setDescription('Esse membro ainda não tem XP. Manda mensagem e participa! 😄');
  const barra = st.proximo
    ? `Faltam **${st.proximo.faltam} XP** para ${st.proximo.nome}`
    : 'Nível máximo atingido! 🌟';
  return new EmbedBuilder().setColor(COR_RANKING)
    .setTitle(`📊 Nível de ${st.nome}`)
    .addFields(
      { name: 'Nível', value: st.nivel, inline: true },
      { name: 'XP total', value: `${st.xp}`, inline: true },
      { name: 'Convidados', value: `${st.convidados}`, inline: true },
      { name: 'Progresso', value: barra },
    )
    .setFooter({ text: 'Hub Lab C.O' });
}
function embedRankXp(lista) {
  const m = ['🥇','🥈','🥉'];
  const linhas = lista.map((u,i) => `${m[i]||`${i+1}.`} **${u.nome}** — ${u.xp} XP (${u.nivel})`).join('\n');
  return new EmbedBuilder().setColor(COR_RANKING).setTitle('🏆 Ranking de XP — Hub Lab C.O')
    .setDescription(linhas || 'Ninguém pontuou ainda.').setFooter({ text: 'Hub Lab C.O' }).setTimestamp();
}
function embedConvites(lista) {
  const m = ['🥇','🥈','🥉'];
  const linhas = lista.map((u,i) => `${m[i]||`${i+1}.`} **${u.nome}** — ${u.total} convite${u.total!==1?'s':''}`).join('\n');
  return new EmbedBuilder().setColor(COR_GOL).setTitle('🤝 Ranking de Convites — Hub Lab C.O')
    .setDescription(linhas || 'Ninguém convidou ainda. Use seu link de convite!').setFooter({ text: 'Cada convite = +40 XP' }).setTimestamp();
}

// ════════ SISTEMA DE XP AUTOMÁTICO ════════
function ehVipMembro(member) {
  if (!member) return false;
  return member.roles.cache.some(r => r.name.toLowerCase().includes(CARGO_VIP.toLowerCase()));
}

// Mapa de cargos de nível (nome do cargo -> aplica quando sobe)
async function aplicarCargoNivel(member, nivelNome) {
  try {
    const guild = member.guild;
    // remove cargos de outros níveis e aplica o novo
    const nomesNiveis = nv.NIVEIS.map(n => n.nome);
    const cargoAlvo = guild.roles.cache.find(r => r.name === nivelNome);
    if (!cargoAlvo) return;
    const remover = member.roles.cache.filter(r => nomesNiveis.includes(r.name) && r.name !== nivelNome);
    if (remover.size) await member.roles.remove(remover).catch(() => {});
    await member.roles.add(cargoAlvo).catch(() => {});
  } catch (e) { console.error('Cargo nível:', e.message); }
}

async function processarXp(userId, nome, acao, member, valorLivre) {
  const ehVip = ehVipMembro(member);
  const r = nv.darXp(userId, nome, acao, ehVip, valorLivre);
  if (r && r.subiu) {
    const chN = canal(CH.niveis);
    if (chN) chN.send(`🎉 <@${userId}> subiu para **${r.nivelNovo.nome}**! GG! 🚀`).catch(() => {});
    if (member) aplicarCargoNivel(member, r.nivelNovo.nome);
  }
}

// XP por mensagem
client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.guild) return;
  processarXp(msg.author.id, msg.author.username, 'mensagem', msg.member);
  // Sequência de dias: silencioso, conta 1x por dia, não responde nada.
  com.marcarAtividade(msg.author.id, msg.author.username);
});

// XP por reação dada
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || !reaction.message.guild) return;
  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  processarXp(user.id, user.username, 'reacao', member);
});

// XP por "mensagem relevante" (recebeu 5+ reações de gente diferente)
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (reaction.message.author?.bot) return;
    const total = reaction.message.reactions.cache.reduce((s, r) => s + r.count, 0);
    if (total === 5) { // dispara uma vez ao atingir 5
      const autor = reaction.message.author;
      const member = await reaction.message.guild.members.fetch(autor.id).catch(() => null);
      processarXp(autor.id, autor.username, 'msg_relevante', member);
    }
  } catch (e) {}
});

// Convites: detecta quem convidou quem
const conviteCache = new Map();
client.on('guildMemberAdd', async member => {
  try {
    if (!member.user.bot) {
      // (1) CARGO INICIAL — dá acesso aos canais e marca "cheguei".
      // Configure CARGO_INICIAL no .env (ex: "Torcedor"). Sem config, pula.
      if (CARGO_INICIAL_NOME) {
        try {
          let cargoIni = member.guild.roles.cache.find(r => r.name === CARGO_INICIAL_NOME);
          if (!cargoIni) {
            cargoIni = await member.guild.roles.create({
              name: CARGO_INICIAL_NOME,
              colors: { primaryColor: 0xC6F432 }, color: 0xC6F432,
              reason: 'Cargo inicial de novos membros',
            }).catch(() => null);
          }
          if (cargoIni) await member.roles.add(cargoIni).catch(() => {});
        } catch (e) { /* não trava a entrada por causa de cargo */ }
      }

      // (2) DM de boas-vindas (chega a quem tem DM aberta)
      member.send(
        `👋 Bem-vindo(a) ao **Hub Lab C.O**, ${member.user.username}!\n\n` +
        `Aqui a gente vive futebol: palpites, bolão, odds e muita resenha. 🎯\n\n` +
        `🌐 **Faça seu primeiro palpite agora:** ${LINK_SITE}/dashboard.html\n` +
        `🎮 Tem também o **Ache o Jogador** e o quiz **De que Clube?** pra jogar.\n` +
        `🏆 Acerte placares, suba no ranking da temporada e vire o **Rei do Exato**!\n\n` +
        `Qualquer dúvida, é só chamar a galera nos canais. Bora pra cima! ⚽`
      ).catch(() => {});

      // (3) BOAS-VINDAS PÚBLICAS — a maioria entra pela live com a DM FECHADA,
      // então a DM acima nunca chega. A pública garante que TODO mundo é
      // recebido e vê o primeiro passo, e faz a comunidade parecer viva.
      // IMPORTANTE: só posta no canal DEDICADO de boas-vindas.
      // Antes ele caía no chat-geral quando CANAL_BEMVINDO não estava
      // configurado, e isso atrapalhava a conversa da galera (gente
      // perguntando sobre o jogo se perdia no meio dos "bem-vindo").
      // Se o canal não estiver configurado, ele simplesmente não posta.
      const chBemvindo = canal(CH.bemvindo);
      if (chBemvindo) {
        const emb = new EmbedBuilder()
          .setColor(0xC6F432)
          .setTitle('🎉 Chegou gente nova!')
          .setDescription(
            `Seja bem-vindo(a), <@${member.id}>! 👋\n\n` +
            `**Comece por aqui:**\n` +
            `🎯 Faça seu 1º palpite: ${LINK_SITE}/dashboard.html\n` +
            `🎮 Jogue o **Ache o Jogador** e ganhe HubCoins\n` +
            `🏆 Suba no ranking da temporada\n\n` +
            `Manda um "salve" no chat pra galera te conhecer! ⚽`
          )
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: `Você é o membro nº ${member.guild.memberCount} do Hub Lab!` });
        chBemvindo.send({ content: `<@${member.id}>`, embeds: [emb] }).catch(() => {});
      }
    }

    const novosConvites = await member.guild.invites.fetch().catch(() => null);
    if (!novosConvites) return;
    const antigos = conviteCache.get(member.guild.id) || new Map();
    let convidante = null;
    for (const inv of novosConvites.values()) {
      const usosAntes = antigos.get(inv.code) || 0;
      if (inv.uses > usosAntes && inv.inviter) { convidante = inv.inviter; break; }
    }
    // atualiza cache
    const novoMapa = new Map();
    novosConvites.forEach(i => novoMapa.set(i.code, i.uses));
    conviteCache.set(member.guild.id, novoMapa);

    if (convidante && !convidante.bot) {
      const memberConvidante = await member.guild.members.fetch(convidante.id).catch(() => null);
      const ehVip = ehVipMembro(memberConvidante);
      const r = nv.registrarConvite(convidante.id, convidante.username, ehVip);
      const chN = canal(CH.niveis);
      if (chN) chN.send(`🤝 <@${convidante.id}> convidou um novo membro! +40 XP`).catch(() => {});
      if (r && r.subiu && memberConvidante) {
        if (chN) chN.send(`🎉 <@${convidante.id}> subiu para **${r.nivelNovo.nome}**! 🚀`).catch(() => {});
        aplicarCargoNivel(memberConvidante, r.nivelNovo.nome);
      }
    }
  } catch (e) { console.error('Convite:', e.message); }
});


// Dica do dia automática às 10h
// Entrega automática de odds 2x ao dia: 11h (jogos do dia) e 20h (jogos de amanhã)
async function entregaOdds(titulo) {
  const dicaEmbed = await montarDicaDoDia();
  const ch = canal(CANAL_APOSTAS) || canal(CH.palpites);
  if (titulo && ch) ch.send(`📢 **${titulo}**`).catch(() => {});
  if (dicaEmbed && ch) ch.send({ embeds: [dicaEmbed] }).catch(() => {});
  // múltiplas prontas junto
  const jogos = await dica.buscarOddsDoDia();
  let textoWpp = `📢 *${titulo || 'Odds do dia'}*\n\n`;
  if (jogos.length) {
    const mults = await dica.montarMultiplasProntas(jogos, estat);
    if (mults.length && ch) ch.send({ embeds: mults }).catch(() => {});
    // monta texto das odds pro WhatsApp
    for (const j of jogos.slice(0, 5)) {
      const fav = j.melhor.casa.odd && j.melhor.casa.odd <= (j.melhor.fora.odd || 99)
        ? `${j.casa} @ ${j.melhor.casa.odd}` : `${j.fora} @ ${j.melhor.fora.odd}`;
      textoWpp += `⚽ ${j.casa} x ${j.fora}\n   Favorito: ${fav}\n`;
    }
    textoWpp += `\n🔞 +18. Conteúdo recreativo, não é recomendação.\n🌐 Site: ${LINK_SITE}\n📱 Discord: ${LINK_DISCORD}`;
    wa.enviar(textoWpp);
    sync.salvarOddsDoDia(jogos); // persiste no Supabase p/ o site
  } else {
    wa.enviar(`📢 *${titulo || 'Odds do dia'}*\n\nSem odds disponíveis agora. 🌐 Site: ${LINK_SITE}\n📱 Discord: ${LINK_DISCORD}`);
  }
}
// (Os disparos de 11h e 20h agora são feitos pelo agendador robusto lá em cima)


// ── Restrição de comandos por canal ──
// Cada comando só funciona no(s) canal(is) certo(s). Vazio = qualquer canal.
const COMANDOS_CANAL = {
  jogos:       [CH.jogos],
  tabela:      [CH.tabela],
  artilheiros: [CH.tabela],
  proximos:    [CH.jogos],
  palpite:     [CH.palpites],
  ranking:     [CH.ranking, CH.palpites],
  nivel:       [CH.niveis],
  rankxp:      [CH.niveis],
  convites:    [CH.niveis],
  dica:        [CANAL_APOSTAS],
  multipla:    [CANAL_APOSTAS],
};
function podeUsarAqui(commandName, channelId) {
  const permitidos = COMANDOS_CANAL[commandName];
  if (!permitidos || !permitidos.length || !permitidos[0]) return true; // sem restrição
  return permitidos.includes(channelId);
}
// Diagnóstico: mostra no boot quais comandos estão protegidos e quais estão abertos
function diagnosticoCanais() {
  console.log('🔒 RESTRIÇÃO DE COMANDOS POR CANAL:');
  for (const [cmd, canais] of Object.entries(COMANDOS_CANAL)) {
    const validos = (canais || []).filter(Boolean);
    if (validos.length) console.log(`   /${cmd} → travado em ${validos.length} canal(is) ✅`);
    else console.log(`   /${cmd} → ABERTO (falta configurar a variável do canal) ⚠️`);
  }
}

// ════════ COMANDOS ════════
const comandos = [
  new SlashCommandBuilder().setName('jogos').setDescription('Jogos de hoje dos clubes da Série A (qualquer competição)'),
  new SlashCommandBuilder().setName('tabela').setDescription('Classificação do Brasileirão Série A'),
  new SlashCommandBuilder().setName('artilheiros').setDescription('Top 10 artilheiros do Brasileirão'),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking de palpites da Hub Lab C.O'),
  new SlashCommandBuilder().setName('proximos').setDescription('Próximos jogos (pra você palpitar)'),
  new SlashCommandBuilder().setName('nivel').setDescription('Veja seu nível e XP na Hub Lab C.O')
    .addUserOption(o => o.setName('membro').setDescription('Ver o nível de outro membro')),
  new SlashCommandBuilder().setName('rankxp').setDescription('Ranking de XP da comunidade'),
  new SlashCommandBuilder().setName('convites').setDescription('Ranking de quem mais convidou membros'),
  new SlashCommandBuilder().setName('darxp').setDescription('(Staff) Dar XP manual a um membro')
    .addUserOption(o => o.setName('membro').setDescription('Quem recebe').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)
      .addChoices(
        { name: 'Presença na live', value: 'presenca_live' },
        { name: 'Seguir nas redes (comprovado)', value: 'seguir_rede' },
        { name: 'Mensagem relevante', value: 'msg_relevante' },
        { name: 'Participou de evento', value: 'evento' },
        { name: 'Bônus livre', value: 'bonus_staff' },
      ))
    .addIntegerOption(o => o.setName('quantidade').setDescription('XP (só pro Bônus livre)').setMinValue(1).setMaxValue(1000)),
  new SlashCommandBuilder().setName('dica').setDescription('Dica do dia: favorito + múltipla + melhor casa (+18)'),
  new SlashCommandBuilder().setName('agenda').setDescription('(Staff) Dispara a agenda do dia agora (teste)'),
  new SlashCommandBuilder().setName('fontes').setDescription('(Staff) Status das APIs e quota de backup'),
  new SlashCommandBuilder().setName('popularjogadores').setDescription('(Staff) Atualiza os elencos dos clubes pro Jogo da Memória'),
  new SlashCommandBuilder().setName('multipla').setDescription('Múltiplas dos sonhos prontas dos jogos mais hypados (+18)'),
  new SlashCommandBuilder().setName('ganhador').setDescription('(Staff) Marca o ganhador do dia (+50 XP)')
    .addUserOption(o => o.setName('membro').setDescription('Ganhador do dia').setRequired(true)),
  new SlashCommandBuilder().setName('palpite').setDescription('Dê seu palpite para um jogo')
    .addStringOption(o => o.setName('jogo').setDescription('Escolha o jogo').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('gols_casa').setDescription('Gols do time da casa').setRequired(true).setMinValue(0).setMaxValue(20))
    .addIntegerOption(o => o.setName('gols_fora').setDescription('Gols do time de fora').setRequired(true).setMinValue(0).setMaxValue(20)),
  new SlashCommandBuilder().setName('exato').setDescription('Palpite no Bolão Exato do dia (crave o placar!)')
    .addIntegerOption(o => o.setName('gols_casa').setDescription('Gols do time da casa').setRequired(true).setMinValue(0).setMaxValue(20))
    .addIntegerOption(o => o.setName('gols_fora').setDescription('Gols do time de fora').setRequired(true).setMinValue(0).setMaxValue(20)),
  new SlashCommandBuilder().setName('historico').setDescription('Veja seu histórico de desempenho')
    .addUserOption(o => o.setName('usuario').setDescription('Ver de outra pessoa (opcional)').setRequired(false)),
  new SlashCommandBuilder().setName('live').setDescription('(Staff) Ativa ou desativa live no site')
    .addStringOption(o => o.setName('acao').setDescription('on ou off').setRequired(true).addChoices({ name: '🔴 Ativar live', value: 'on' }, { name: '⚫ Desativar live', value: 'off' }))
    .addStringOption(o => o.setName('plataforma').setDescription('kick ou tiktok').setRequired(true).addChoices({ name: 'Kick', value: 'kick' }, { name: 'TikTok', value: 'tiktok' }))
    .addStringOption(o => o.setName('canal').setDescription('Canal (ex: nathanbragalive)').setRequired(false)),
  new SlashCommandBuilder().setName('green').setDescription('(Staff) Marca uma odd que deu GREEN (fixa no site)')
    .addStringOption(o => o.setName('descricao').setDescription('Ex: Brasil vence + 2.5 gols').setRequired(true))
    .addNumberOption(o => o.setName('odd').setDescription('A odd que pagou').setRequired(true))
    .addStringOption(o => o.setName('jogo').setDescription('Qual jogo').setRequired(false)),
  new SlashCommandBuilder().setName('relatorio').setDescription('(Staff) Posta relatório do dia no canal fundadores'),
  new SlashCommandBuilder().setName('meuspalpites').setDescription('Veja todos os seus palpites e resultados'),
  new SlashCommandBuilder().setName('resultado').setDescription('(Staff) Registra resultado manualmente')
    .addStringOption(o => o.setName('partida_id').setDescription('ID da partida').setRequired(true))
    .addIntegerOption(o => o.setName('gols_casa').setDescription('Gols casa').setRequired(true).setMinValue(0).setMaxValue(20))
    .addIntegerOption(o => o.setName('gols_fora').setDescription('Gols fora').setRequired(true).setMinValue(0).setMaxValue(20)),

  // Comunidade: /time, /torcidas, /sequencia, /ranksequencia
  ...com.comandos(),

  new SlashCommandBuilder().setName('noticias')
    .setDescription('Giro das notícias mais quentes dos times da Série A'),
  new SlashCommandBuilder().setName('pauta')
    .setDescription('[fundadores] Pauta e roteiro do vídeo de hoje'),
  new SlashCommandBuilder().setName('postodia')
    .setDescription('[staff] Gera o post do dia pra jogar no chat')
    .addStringOption(o => o.setName('formato').setDescription('Deixe vazio pra escolher sozinho')
      .addChoices(
        { name: '📰 Resenha da notícia', value: 'noticia' },
        { name: '🔥 Pergunta polêmica', value: 'polemica' },
        { name: '🏆 Monta o ranking', value: 'ranking' },
        { name: '🤔 E se...', value: 'seousasse' },
        { name: '💭 Memória afetiva', value: 'memoria' },
        { name: '🙏 Agradecimento', value: 'agradece' }))
    .addStringOption(o => o.setName('contexto')
      .setDescription('Algo específico pra citar (ex: "ontem teve live com 30 pessoas")')),
  new SlashCommandBuilder().setName('videonoticias')
    .setDescription('[staff] Roteiro LONGO de notícias (8+ min) pronto pra ler'),
  new SlashCommandBuilder().setName('videocuriosidade')
    .setDescription('[staff] Roteiro LONGO de curiosidade (8+ min) pronto pra ler')
    .addStringOption(o => o.setName('tema').setDescription('Tema específico (vazio = tema do dia)'))
    .addStringOption(o => o.setName('dados').setDescription('Dados confirmados pra IA usar')),
  new SlashCommandBuilder().setName('pesquisar')
    .setDescription('[staff] Busca fatos reais sobre um tema antes de gravar')
    .addStringOption(o => o.setName('tema').setDescription('Ex: história do Cruzeiro').setRequired(true)),
  new SlashCommandBuilder().setName('confere')
    .setDescription('Confere na API: onde o jogador está e o histórico dele')
    .addStringOption(o => o.setName('jogador').setDescription('Nome do jogador').setRequired(true))
    .addStringOption(o => o.setName('clube').setDescription('Confirmar se ele está NESTE clube (opcional)')),
  new SlashCommandBuilder().setName('roteiro')
    .setDescription('[fundadores] Roteiro completo do vídeo, escrito por IA')
    .addStringOption(o => o.setName('formato').setDescription('Qual tipo de vídeo')
      .addChoices(
        { name: '💰 Monetizável — 90-150s (TikTok paga)', value: 'monetizavel' },
        { name: '🔍 Curiosidade/Comparação — 90-150s', value: 'curiosidade' },
        { name: '☀️ Manhã — vídeo curto', value: 'manha' },
        { name: '🌙 Noite — análise longa (YouTube)', value: 'noite' }))
    .addStringOption(o => o.setName('tema')
      .setDescription('Só pra Curiosidade. Ex: "Galo 2021 x Fluminense 2026"'))
    .addStringOption(o => o.setName('dados')
      .setDescription('Só pra Curiosidade. Dados CONFIRMADOS que a IA deve usar')),
];

async function registrarComandos() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const body = comandos.map(c => c.toJSON());
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body });
      console.log('Comandos registrados no servidor (instantâneo)!');
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body });
      console.log('Comandos globais registrados (pode levar até 1h pra aparecer).');
    }
  } catch (e) { console.error('Erro ao registrar comandos:', e); }
}

client.on('interactionCreate', async interaction => {
  // Autocomplete: lista os jogos do dia pro /palpite
  if (interaction.isAutocomplete()) {
    try {
      const jogos = await api.jogosDoDia();
      const foco = (interaction.options.getFocused() || '').toLowerCase();
      const opcoes = jogos
        .filter(j => !foco || j.casa.toLowerCase().includes(foco) || j.fora.toLowerCase().includes(foco))
        .slice(0, 25)
        .map(j => ({ name: `${j.casa} x ${j.fora} (${j.hora})`.slice(0, 100), value: String(j.id) }));
      await interaction.respond(opcoes);
    } catch { try { await interaction.respond([]); } catch {} }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  // Bloqueia comando em canal errado (staff sempre pode)
  const ehStaffGlobal = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
  if (!ehStaffGlobal && !podeUsarAqui(commandName, interaction.channelId)) {
    const canais = (COMANDOS_CANAL[commandName] || []).filter(Boolean).map(id => `<#${id}>`).join(' ou ');
    await interaction.reply({ content: `❌ Use \`/${commandName}\` em ${canais || 'outro canal'}.`, ephemeral: true });
    return;
  }
  await interaction.deferReply();
  try {
    // Comunidade (/time, /torcidas, /sequencia, /ranksequencia).
    if (await com.tratarComando(interaction)) return;

    if (commandName === 'noticias') {
      const lista = await noticias.buscarNoticias({ apenasNovas: false, minScore: 5 });
      if (!lista.length) return interaction.editReply('Nada quente agora. Volta mais tarde!');
      const desc = lista.slice(0, 5).map((n, i) => {
        const tag = n.tags.length ? ` ${n.tags[0]}` : '';
        return `**${i + 1}.${tag} ${n.titulo}**\n${n.clubes.map(c => `\`${c}\``).join(' ')} · [ler no ${n.fonte}](${n.link})`;
      }).join('\n\n');
      return interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(0xC6F432).setTitle('📰 Giro do Hub Lab').setDescription(desc)
        .setFooter({ text: 'Comenta aí o que achou!' })] });
    }

    if (commandName === 'pesquisar') {
      const tema = interaction.options.getString('tema');
      await interaction.editReply('🔎 Apurando...');
      const d = await pesq.montarDossie(tema);
      if (!d.temFatos) {
        return interaction.followUp(
          `❌ Não achei fonte sobre "${tema}".\n` +
          `Tente citar o nome do clube, ou pesquise você e use o campo \`dados\`.`);
      }
      const resumo = d.fatos.slice(0, 1500);
      await interaction.followUp({ embeds: [new EmbedBuilder()
        .setColor(0xC6F432)
        .setTitle(`📚 Fatos sobre: ${tema}`)
        .setDescription(resumo.length < d.fatos.length ? resumo + '\n\n_(cortado)_' : resumo)
        .setFooter({ text: `${d.fontes.length} fonte(s) · clubes: ${d.clubesEncontrados.join(', ') || '—'}` })] });
      const links = d.fontes.map((f, i) => `${i + 1}. [${f.tipo}] <${f.link}>`).join('\n');
      return interaction.followUp('🔗 **Fontes:**\n' + links.slice(0, 1800));
    }

    if (commandName === 'videonoticias' || commandName === 'videocuriosidade') {
      const mb = await interaction.guild.members.fetch(interaction.user.id);
      const staff = mb.permissions.has(PermissionsBitField.Flags.Administrator)
        || mb.roles.cache.some(r => /fundador|moderador/i.test(r.name));
      if (!staff) return interaction.editReply('❌ Só a staff gera roteiro.');

      await interaction.editReply('✍️ Escrevendo o roteiro longo... isso leva ~1 minuto.');

      let r;
      if (commandName === 'videonoticias') {
        const jogos = await api.jogosDoDia().catch(() => []);
        r = await rlongo.roteiroNoticias(jogos);
      } else {
        r = await rlongo.roteiroCuriosidade(
          interaction.options.getString('tema') || '',
          interaction.options.getString('dados') || '');
      }

      if (r.erro) return interaction.followUp(`❌ ${r.erro}`);
      const destino = canal(CH.pauta) || canal(CH.fundadores) || interaction.channel;
      await rlongo.enviar(destino, r, commandName === 'videonoticias' ? 'noticias' : 'curiosidade');
      return interaction.followUp(`✅ Roteiro pronto (~${r.minutos} min) no canal de pautas!`);
    }

    if (commandName === 'postodia') {
      const membroP = await interaction.guild.members.fetch(interaction.user.id);
      const ehStaffP = membroP.permissions.has(PermissionsBitField.Flags.Administrator)
        || membroP.roles.cache.some(r => /fundador|moderador/i.test(r.name));
      if (!ehStaffP) return interaction.editReply('❌ Só a staff gera o post do dia.');

      const r = await engaj.gerarPost({
        formato: interaction.options.getString('formato'),
        contexto: interaction.options.getString('contexto') || '',
      });
      if (r.erro) return interaction.editReply(`❌ ${r.erro}`);
      return interaction.editReply(
        `**Formato:** ${r.formato}\n\n───────────\n${r.texto}\n───────────\n` +
        `_Copie e cole no chat, ou ajuste do seu jeito._`);
    }

    if (commandName === 'confere') {
      const nome = interaction.options.getString('jogador');
      const clube = interaction.options.getString('clube');

      // Pergunta direta: "fulano está no clube X?"
      if (clube) {
        const r = await verificar.confirmarJogadorNoClube(nome, clube);
        if (r.erro) return interaction.editReply(`❌ ${r.erro}`);
        const emb = new EmbedBuilder()
          .setColor(r.encontrado ? 0x2ECC71 : 0xE74C3C)
          .setTitle(r.encontrado ? '✅ CONFIRMADO' : '❌ NÃO ENCONTRADO')
          .setDescription(r.encontrado
            ? `**${r.jogador.nome}** está no elenco atual do **${r.clube}**.\n` +
              `Posição: ${r.jogador.posicao || '—'} · Idade: ${r.jogador.idade || '—'}` +
              (r.jogador.numero ? ` · Camisa ${r.jogador.numero}` : '')
            : `**${nome}** NÃO aparece no elenco atual do **${r.clube}** ` +
              `(${r.totalElenco} jogadores checados).\n\n⚠️ Não grave essa informação.`)
          .setFooter({ text: `Fonte: API-Football · elenco do ${r.clube} (${r.pais})` });
        return interaction.editReply({ embeds: [emb] });
      }

      // Busca geral: onde está e histórico
      const achados = await verificar.acharJogador(nome);
      if (achados.erro) return interaction.editReply(`❌ ${achados.erro}`);
      const j = achados[0];

      const [atual, transf] = await Promise.all([
        verificar.clubeAtual(j.id),
        verificar.transferencias(j.id),
      ]);

      let desc = `**${j.nome}**${j.nomeCompleto ? ` (${j.nomeCompleto})` : ''}\n` +
                 `${j.posicao || '—'} · ${j.idade || '?'} anos · ${j.nacionalidade || '—'}\n\n`;

      if (!atual.erro && atual.principal) {
        desc += `**📍 Clube atual (${atual.temporada}):** ${atual.principal.clube}\n`;
        if (atual.times.length > 1) {
          desc += `_Outros na temporada: ${atual.times.slice(1).map(t => t.clube).join(', ')}_\n`;
        }
        desc += '\n';
      }

      if (!transf.erro && transf.transferencias?.length) {
        const ultimas = transf.transferencias.slice(0, 5);
        desc += `**🔄 Últimas transferências:**\n` +
          ultimas.map(t => `\`${t.data}\` ${t.de} → **${t.para}** (${t.tipo})`).join('\n');
      }

      return interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(0xC6F432).setTitle('🔍 Verificação de fato').setDescription(desc)
        .setThumbnail(j.foto || null)
        .setFooter({ text: 'Fonte: API-Football · confira antes de gravar' })] });
    }

    if (commandName === 'roteiro') {
      if (CH.fundadores && interaction.channelId !== CH.fundadores &&
          interaction.channelId !== CH.pauta) {
        return interaction.editReply('Esse comando é só no canal dos fundadores.');
      }
      const periodo = interaction.options.getString('formato') || 'manha';
      const tema = interaction.options.getString('tema') || '';
      const dados = interaction.options.getString('dados') || '';
      await interaction.editReply('✍️ Escrevendo o roteiro...');
      const jogos = periodo === 'noite' ? await api.jogosDoDia().catch(() => []) : [];
      const r = await roteiroIA.gerarRoteiro({ periodo, jogos, tema, dados });
      if (r.erro) return interaction.followUp(r.erro);
      await roteiroIA.enviarRoteiro(interaction.channel, r, periodo);
      return;
    }

    if (commandName === 'pauta') {
      // só nos canais de fundadores
      if (CH.fundadores && interaction.channelId !== CH.fundadores &&
          interaction.channelId !== CH.pauta) {
        return interaction.editReply('Esse comando é só no canal dos fundadores.');
      }
      const lista = await noticias.buscarNoticias({ apenasNovas: false, minScore: 5 });
      const p = noticias.montarPauta(lista);
      if (!p) return interaction.editReply('Sem pauta relevante agora.');
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(0xFFCF00).setTitle('🎯 PAUTA DO DIA').setDescription(p.linhas)] });
      return interaction.followUp({ content: p.roteiro, ephemeral: false });
    }

    if (commandName === 'jogos') {
      const jogosHoje = await api.jogosDoDia();
      // sincroniza no Supabase (hoje + próximos) pra atualizar a tabela do site
      try {
        const proximos = await api.proximosJogos();
        const ids = new Set(jogosHoje.map(j => String(j.id)));
        const extras = (proximos || []).filter(p => !ids.has(String(p.id)));
        await sync.syncJogos([...jogosHoje, ...extras]);
      } catch (e) { console.error('[/jogos] sync:', e.message); }
      await interaction.editReply({ embeds: [embedJogosDoDia(jogosHoje)] });
    } else if (commandName === 'tabela') {
      const grupos = await api.tabela();
      if (!grupos.length) return interaction.editReply('Tabela ainda não disponível para esta fase.');
      await interaction.editReply({ embeds: [embedTabela(grupos)] });
    } else if (commandName === 'artilheiros') {
      await interaction.editReply({ embeds: [embedArtilheiros(await api.artilheiros())] });
    } else if (commandName === 'ranking') {
      await interaction.editReply({ embeds: [embedRanking(db.ranking())] });
    } else if (commandName === 'proximos') {
      await interaction.editReply({ embeds: [embedProximos(await api.proximosJogos())] });
    } else if (commandName === 'nivel') {
      const alvo = interaction.options.getUser('membro') || interaction.user;
      await interaction.editReply({ embeds: [embedNivel(nv.statusUsuario(alvo.id), alvo.id)] });
    } else if (commandName === 'rankxp') {
      await interaction.editReply({ embeds: [embedRankXp(nv.rankingXp())] });
    } else if (commandName === 'convites') {
      await interaction.editReply({ embeds: [embedConvites(nv.rankingConvites())] });
    } else if (commandName === 'darxp') {
      const membro = await interaction.guild.members.fetch(interaction.user.id);
      const ehStaff = membro.permissions.has(PermissionsBitField.Flags.Administrator)
        || membro.roles.cache.some(r => /fundador|moderador/i.test(r.name));
      if (!ehStaff) return interaction.editReply('❌ Só a staff pode usar esse comando.');
      const alvo = interaction.options.getUser('membro');
      const motivo = interaction.options.getString('motivo');
      const qtd = interaction.options.getInteger('quantidade');
      const alvoMember = await interaction.guild.members.fetch(alvo.id).catch(() => null);
      await processarXp(alvo.id, alvo.username, motivo, alvoMember, qtd);
      await interaction.editReply(`✅ XP concedido a ${alvo.username} (${motivo}).`);
    } else if (commandName === 'agenda') {
      await agendaDoDia();
      await interaction.editReply('✅ Agenda do dia disparada no canal de jogos!');
    } else if (commandName === 'fontes') {
      const q = fontes.statusQuota();
      await interaction.editReply(`📡 **Fontes de dados**\n• Primária: football-data.org (ilimitada)\n• Backup BR: apidofutebol — ${q.usadas}/${q.limite} usadas hoje (${q.restantes} restantes)`);
    } else if (commandName === 'popularjogadores') {
      await interaction.editReply('⏳ Buscando os elencos dos 20 clubes na API... (pode levar ~30s)');
      const { popularJogadores } = require('./popular-jogadores.js');
      const r = await popularJogadores((msg) => console.log(msg));
      if (r.ok) await interaction.editReply(`✅ Elencos atualizados: **${r.jogadores} jogadores** de **${r.clubes} clubes** prontos pro Jogo da Memória!`);
      else await interaction.editReply(`❌ Não consegui atualizar os elencos: ${r.erro}. Confira se a APIFOOTBALL_KEY está configurada (o comando /fontes ajuda).`);
    } else if (commandName === 'dica') {
      const e = await montarDicaDoDia();
      if (!e) return interaction.editReply('Sem odds disponíveis no momento. Tenta mais tarde.');
      await interaction.editReply({ embeds: [e] });
    } else if (commandName === 'multipla') {
      const jogos = await dica.buscarOddsDoDia();
      if (!jogos.length) { await interaction.editReply('Sem jogos com odds disponíveis agora. Tenta mais tarde.'); return; }
      const embeds = await dica.montarMultiplasProntas(jogos, estat);
      if (!embeds.length) { await interaction.editReply('Não consegui montar múltiplas agora.'); return; }
      await interaction.editReply({ embeds });
    } else if (commandName === 'historico') {
      const alvo = interaction.options.getUser('usuario') || interaction.user;
      const hist = db.meusPalpites(alvo.id);
      if (!hist.length) return interaction.editReply(`${alvo.username} ainda não tem histórico de palpites.`);
      const total = hist.length;
      const encerrados = hist.filter(p => p.encerrado);
      const exatos = encerrados.filter(p => p.acertouExato).length;
      const resultados = encerrados.filter(p => p.acertouResultado && !p.acertouExato).length;
      const erros = encerrados.length - exatos - resultados;
      const taxaAcerto = encerrados.length ? Math.round(((exatos + resultados) / encerrados.length) * 100) : 0;
      const pontosTotais = encerrados.reduce((s, p) => s + (p.pts || 0), 0);
      const embed = new EmbedBuilder().setColor(COR_LIME)
        .setTitle(`📊 Histórico de ${alvo.username}`)
        .setThumbnail(alvo.displayAvatarURL())
        .addFields(
          { name: '🎯 Palpites totais', value: `${total}`, inline: true },
          { name: '✅ Taxa de acerto', value: `${taxaAcerto}%`, inline: true },
          { name: '⭐ Pontos ganhos', value: `${pontosTotais}`, inline: true },
          { name: '🎯 Placares exatos', value: `${exatos}`, inline: true },
          { name: '✅ Resultados certos', value: `${resultados}`, inline: true },
          { name: '❌ Erros', value: `${erros}`, inline: true },
        )
        .setFooter({ text: 'Continue palpitando pra subir no ranking! • hublab.agency' });
      await interaction.editReply({ embeds: [embed] });

    } else if (commandName === 'live') {
      const membroL = await interaction.guild.members.fetch(interaction.user.id);
      const ehStaffL = membroL.permissions.has(PermissionsBitField.Flags.Administrator)
        || membroL.roles.cache.some(r => /fundador|moderador/i.test(r.name));
      if (!ehStaffL) return interaction.editReply('❌ Só a staff pode controlar as lives.');
      const acao = interaction.options.getString('acao');
      const plat = interaction.options.getString('plataforma');
      const canalLive = interaction.options.getString('canal') || (plat === 'kick' ? 'nathanbragalive' : 'nathanfuteboll');
      // salva estado da live no Supabase
      await sync.setLiveStatus({ ativa: acao === 'on', plataforma: plat, canal: canalLive });
      // avisa no canal e WhatsApp se ativou
      if (acao === 'on') {
        const url = plat === 'kick' ? `https://kick.com/${canalLive}` : `https://www.tiktok.com/@${canalLive}`;
        const msg = `🔴 *LIVE AGORA!* Nathan e Detto estão ao vivo na ${plat === 'kick' ? 'Kick' : 'TikTok'}!\n\n📺 ${url}\n🌐 ${LINK_SITE}/live.html\n📱 Discord: ${LINK_DISCORD}`;
        wa.enviar(msg);
        const chGols = canal(CH.gols);
        if (chGols) chGols.send(`🔴 **LIVE AGORA!** Estamos ao vivo na ${plat === 'kick' ? 'Kick' : 'TikTok'}!\n📺 ${url}\n🌐 ${LINK_SITE}/live.html`).catch(() => {});
      }
      servidor.setEstado('liveStatus', { ativa: acao === 'on', plataforma: plat, canal: canalLive });
      await interaction.editReply(`✅ Live ${acao === 'on' ? '🔴 ATIVADA' : '⚫ desativada'} no site! (${plat}: ${canalLive})`);

    } else if (commandName === 'green') {
      const membroG = await interaction.guild.members.fetch(interaction.user.id);
      const ehStaffG = membroG.permissions.has(PermissionsBitField.Flags.Administrator)
        || membroG.roles.cache.some(r => /fundador|moderador/i.test(r.name));
      if (!ehStaffG) return interaction.editReply('❌ Só a staff pode marcar green.');
      const descG = interaction.options.getString('descricao');
      const oddG = interaction.options.getNumber('odd');
      const jogoG = interaction.options.getString('jogo') || '';
      sync.salvarGreen(descG, oddG, jogoG);
      sync.marcarGreen(jogoG, descG, oddG);
      const chA = canal(CANAL_APOSTAS);
      const msgG = `🟢 **GREEN!** ${descG} ${jogoG ? `(${jogoG})` : ''} pagou **${oddG}**! 🔞 +18, jogo responsável.`;
      if (chA) chA.send(msgG).catch(() => {});
      wa.enviar(`🟢 *GREEN!* ${descG} pagou ${oddG}!\n\n🌐 ${LINK_SITE}\n📱 ${LINK_DISCORD}`);
      await interaction.editReply('✅ Green registrado e fixado no site!');

    } else if (commandName === 'relatorio') {
      const chF = canal(CH.fundadores);
      if (!chF) return interaction.editReply('❌ Configure a variável CANAL_FUNDADORES no Railway.');
      const jogosHoje = await api.jogosDoDia();
      const todosPalpites = db.todosOsPalpitesDoDia(jogosHoje);
      const rankingHoje = db.ranking();
      // agrupa por jogo
      const porJogo = {};
      for (const p of todosPalpites) {
        const k = `${p.casa} x ${p.fora}`;
        if (!porJogo[k]) porJogo[k] = [];
        porJogo[k].push(p);
      }
      let desc = `📅 **Relatório do dia — ${new Date().toLocaleDateString('pt-BR')}**\n\n`;
      desc += `👥 **Total de palpites:** ${todosPalpites.length}\n`;
      desc += `💰 **Palpites com acesso pago:** (verificar no site)\n\n`;
      for (const [jogo, palps] of Object.entries(porJogo)) {
        desc += `⚽ **${jogo}** — ${palps.length} palpites\n`;
        for (const p of palps) {
          const pts = p.pts !== null ? ` → ${p.pts}pts ${p.acertouExato ? '🎯 EXATO' : ''}` : '';
          desc += `  • ${p.nome}: ${p.palpiteCasa}x${p.palpiteFora}${pts}\n`;
        }
        desc += '\n';
      }
      desc += `\n🏆 **Ranking geral:**\n`;
      rankingHoje.slice(0,10).forEach((r,i) => { desc += `${i+1}. ${r.nome} — ${r.pts}pts\n`; });
      const embed = new EmbedBuilder().setColor(0xFFCF00).setTitle('📊 Relatório Hub Lab C.O')
        .setDescription(desc.slice(0, 4000))
        .setFooter({ text: `Gerado em ${new Date().toLocaleString('pt-BR')}` });
      await chF.send({ embeds: [embed] });
      await interaction.editReply('✅ Relatório postado no canal fundadores!');

    } else if (commandName === 'meuspalpites') {
      const meusPalps = db.meusPalpites(interaction.user.id);
      if (!meusPalps.length) return interaction.editReply('Você ainda não fez nenhum palpite. Use **/palpite** pra começar!');
      const linhas = meusPalps.slice(0, 15).map(p => {
        const status = p.encerrado
          ? (p.acertouExato ? '🎯 EXATO' : p.acertouResultado ? '✅ Resultado' : '❌ Errou')
          : (p.fechado ? '🔒 Fechado' : '✏️ Alterável');
        const resultado = p.encerrado && p.golsCasaReal !== null ? ` (Real: ${p.golsCasaReal}x${p.golsForaReal})` : '';
        const pts = p.pts !== null ? ` | ${p.pts}pts` : '';
        return `• **${p.casa} x ${p.fora}**: ${p.palpiteCasa}x${p.palpiteFora} ${status}${resultado}${pts}`;
      }).join('\n');
      const embed = new EmbedBuilder().setColor(COR_LIME)
        .setTitle(`🎯 Meus Palpites — ${interaction.user.username}`)
        .setDescription(linhas)
        .setFooter({ text: '✏️ Alterável = você ainda pode mudar com /palpite' });
      await interaction.editReply({ embeds: [embed] });

    } else if (commandName === 'ganhador') {
      const membro = await interaction.guild.members.fetch(interaction.user.id);
      const ehStaff = membro.permissions.has(PermissionsBitField.Flags.Administrator)
        || membro.roles.cache.some(r => /fundador|moderador/i.test(r.name));
      if (!ehStaff) return interaction.editReply('❌ Só a staff pode usar esse comando.');
      const alvo = interaction.options.getUser('membro');
      const alvoMember = await interaction.guild.members.fetch(alvo.id).catch(() => null);
      await processarXp(alvo.id, alvo.username, 'ganhador_dia', alvoMember);
      const chN = canal(CH.niveis);
      if (chN) chN.send(`🏆 **Ganhador do dia:** <@${alvo.id}>! +50 XP 🎉`).catch(() => {});
      await interaction.editReply(`✅ ${alvo.username} marcado como ganhador do dia!`);
    } else if (commandName === 'palpite') {
      const jogoId = interaction.options.getString('jogo');
      const gc = interaction.options.getInteger('gols_casa');
      const gf = interaction.options.getInteger('gols_fora');
      const jogos = await api.jogosDoDia();
      const jogo = jogos.find(j => String(j.id) === jogoId);
      if (!jogo) return interaction.editReply('❌ Jogo não encontrado. Use **/jogos** pra ver os disponíveis.');

      // ── TRAVA DO APITO INICIAL ──
      // Só aceita palpite se o jogo AINDA NÃO começou. Vale pra qualquer competição.
      const ABERTOS = ['SCHEDULED', 'TIMED'];
      if (!ABERTOS.includes(jogo.status)) {
        const motivo = jogo.status === 'POSTPONED' ? '📅 Jogo **adiado** — os palpites reabrem quando remarcarem.'
          : jogo.status === 'CANCELLED' ? '❌ Jogo **cancelado**.'
          : `🔒 Palpites fechados — o jogo já começou!`;
        return interaction.editReply(`${motivo}\n**${jogo.casa} x ${jogo.fora}**`);
      }

      const res = db.registrar(interaction.user.id, interaction.user.username, String(jogo.id), gc, gf);
      // IMPORTANTE: só grava no Supabase se o palpite foi ACEITO (antes gravava mesmo quando rejeitado)
      if (res === 'fechado' || res === 'encerrado')
        return interaction.editReply(`🔒 Palpites já fechados para **${jogo.casa} x ${jogo.fora}**!`);
      sync.syncPalpite(interaction.user.id, interaction.user.username, jogo.id, gc, gf); // → Supabase (loga)
      const embed = new EmbedBuilder().setColor(COR_LIME).setTitle('🎯 Palpite registrado!')
        .setDescription(`**${jogo.casa} ${gc} x ${gf} ${jogo.fora}**`)
        .addFields(
          { name: '👤 Palpiteiro', value: interaction.user.username, inline: true },
          { name: '🕐 Jogo', value: `${jogo.hora} (Brasília)`, inline: true })
        .setFooter({ text: 'Hub Lab C.O • Exato = 10pts | Resultado = 3pts' });
      await interaction.editReply({ embeds: [embed] });
    } else if (commandName === 'exato') {
      const egc = interaction.options.getInteger('gols_casa');
      const egf = interaction.options.getInteger('gols_fora');
      const hoje = new Date().toISOString().split('T')[0];
      let bolao = null;
      try {
        const r = await fetch(`http://localhost:${process.env.PORT || 8080}/api/bolao-exato`);
        if (r.ok) { const d = await r.json(); bolao = d.bolao; }
      } catch {}
      if (!bolao) return interaction.editReply('❌ O bolão exato de hoje ainda não foi definido. Aguarde a agenda das 11h!');
      sync.salvarPalpiteExato(bolao.id, interaction.user.id, interaction.user.username, egc, egf);
      const embed = new EmbedBuilder().setColor(0xFF2E63).setTitle('🎯 Palpite no Bolão Exato!')
        .setDescription(`**${bolao.time_casa} ${egc} x ${egf} ${bolao.time_fora}**`)
        .setFooter({ text: 'Crave o exato e vire o 👑 Rei do Exato!' });
      await interaction.editReply({ embeds: [embed] });
      const membro = await interaction.guild.members.fetch(interaction.user.id);
      const ehStaff = membro.permissions.has(PermissionsBitField.Flags.Administrator)
        || membro.roles.cache.some(r => /fundador|moderador/i.test(r.name));
      if (!ehStaff) return interaction.editReply('❌ Só a staff pode usar esse comando.');
      const pid = interaction.options.getString('partida_id');
      const gc = interaction.options.getInteger('gols_casa');
      const gf = interaction.options.getInteger('gols_fora');
      db.fecharPalpites(pid, 'Time Casa', 'Time Fora');
      const resultados = db.pontuar(pid, gc, gf);
      const chR = canal(CH.ranking);
      if (chR) chR.send({ embeds: [embedRanking(db.ranking())] }).catch(() => {});
      sync.syncRanking(db.ranking().slice(0, 50)); // grava no Supabase (loga)
      await interaction.editReply(`✅ Resultado registrado! ${Object.keys(resultados).length} palpite(s) pontuado(s).`);
    }
  } catch (e) {
    console.error(`Erro no comando ${commandName}:`, e);
    if (interaction.deferred) interaction.editReply('❌ Ocorreu um erro. Tente novamente em instantes.').catch(() => {});
  }
});

client.once('clientReady', async () => {
  console.log(`✅ Hub Lab C.O Bot online! Logado como ${client.user.tag}`);
  armaz.diagnostico();
  await armaz.initSupabase();
  dica.setRefs(EmbedBuilder, AVISO_APOSTA);
  diagnosticoCanais();
  servidor.iniciarServidor(process.env.PORT || 3000);
  // Handler do webhook do cargo Sócio (site → bot, após pagamento confirmado)
  servidor.registrarWebhook(async ({ usuarioId, acao }) => {
    try {
      if (!usuarioId || !acao) return;
      const CARGO_SOCIO = process.env.CARGO_SOCIO || 'Sócio';
      // descobre o discord_id do usuário pelo Supabase
      let discordId = null;
      try {
        const sb = armaz.supabaseClient ? armaz.supabaseClient() : null;
        if (sb) {
          const { data } = await sb.from('usuarios').select('discord_id').eq('id', usuarioId).maybeSingle();
          discordId = data?.discord_id || null;
        }
      } catch (e) { console.error('[WEBHOOK] supabase:', e.message); }
      if (!discordId) { console.warn(`[WEBHOOK] sem discord_id pro usuário ${usuarioId}`); return; }

      const guild = client.guilds.cache.get(process.env.GUILD_ID);
      if (!guild) return;
      let cargo = guild.roles.cache.find(r => r.name === CARGO_SOCIO);
      if (!cargo) cargo = await guild.roles.create({ name: CARGO_SOCIO, colors: { primaryColor: 0xffcf00 }, color: 0xffcf00, reason: 'Cargo de Sócio Premium' }).catch(() => null);
      if (!cargo) return;
      const membro = await guild.members.fetch(discordId).catch(() => null);
      if (!membro) { console.warn(`[WEBHOOK] membro ${discordId} não está no servidor`); return; }

      if (acao === 'ativar_socio') {
        await membro.roles.add(cargo).catch(() => {});
        console.log(`[WEBHOOK] ✅ cargo Sócio dado a ${membro.user.username}`);
      } else if (acao === 'remover_socio') {
        await membro.roles.remove(cargo).catch(() => {});
        console.log(`[WEBHOOK] ✅ cargo Sócio removido de ${membro.user.username}`);
      }
    } catch (e) { console.error('[WEBHOOK] erro:', e.message); }
  });
  sync.init(); // conecta o Supabase estruturado (loga status)
  await registrarComandos();
  com.iniciar(client);   // cargos de time + sequência
  checarAoVivo(); // inicia o monitor inteligente
  wa.iniciarWhatsApp().catch(e => console.error('WPP init:', e.message)); // inicia o WhatsApp
  // Popula o cache de convites (pra detectar quem convida quem)
  for (const guild of client.guilds.cache.values()) {
    try {
      const convites = await guild.invites.fetch();
      const mapa = new Map();
      convites.forEach(i => mapa.set(i.code, i.uses));
      conviteCache.set(guild.id, mapa);
    } catch (e) { console.error('Cache convites:', e.message); }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN não configurado nas variáveis de ambiente!');
} else {
  client.login(process.env.DISCORD_TOKEN);
}
