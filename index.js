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
  gols:     process.env.CANAL_GOLS,
  jogos:    process.env.CANAL_JOGOS,
  tabela:   process.env.CANAL_TABELA,
  palpites: process.env.CANAL_PALPITES,
  ranking:  process.env.CANAL_RANKING,
  niveis:   process.env.CANAL_NIVEIS,
};
const CARGO_VIP = process.env.CARGO_VIP || 'VIP';
const GUILD_ID = process.env.GUILD_ID; // opcional: deixa comandos instantâneos

const COR_LIME = 0xC6F432, COR_GOL = 0xFF3D7F, COR_TABELA = 0x378ADD, COR_RANKING = 0xFFD700;

function canal(id) { return id ? client.channels.cache.get(id) : null; }

// ════════ EMBEDS ════════
function embedJogosDoDia(jogos) {
  if (!jogos.length) return new EmbedBuilder().setColor(COR_LIME)
    .setTitle('⚽ Copa do Mundo — Jogos de Hoje')
    .setDescription('Nenhum jogo hoje. Aproveita pra palpitar nos próximos! 😄')
    .setFooter({ text: 'Hub Lab C.O' });
  const linhas = jogos.map(j => {
    const placar = (j.golsCasa !== null && j.golsFora !== null) ? `**${j.golsCasa} x ${j.golsFora}**` : 'vs';
    const status = j.status === 'FINISHED' ? '✅' : j.status === 'IN_PLAY' ? '🔴 AO VIVO' : `🕐 ${j.hora}`;
    return `${status} **${j.casa}** ${placar} **${j.fora}**`;
  });
  return new EmbedBuilder().setColor(COR_LIME)
    .setTitle('⚽ Copa do Mundo — Jogos de Hoje')
    .setDescription(linhas.join('\n'))
    .setFooter({ text: 'Hub Lab C.O • Use /palpite pra palpitar!' }).setTimestamp();
}
function embedGol(j) {
  return new EmbedBuilder().setColor(COR_GOL).setTitle('⚽ GOOOOL!')
    .setDescription(`## ${j.casa} **${j.golsCasa}** x **${j.golsFora}** ${j.fora}`)
    .addFields({ name: '🕐 Minuto', value: `${j.minuto}'`, inline: true })
    .setFooter({ text: 'Hub Lab C.O • Copa do Mundo' }).setTimestamp();
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
    .setTitle('📊 Copa do Mundo — Classificação')
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
  return new EmbedBuilder().setColor(COR_GOL).setTitle('🥇 Copa do Mundo — Artilheiros')
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
    .setTitle('📅 Próximos Jogos da Copa')
    .setDescription('Sem jogos agendados no momento.').setFooter({ text: 'Hub Lab C.O' });
  const linhas = jogos.map(j => `📅 ${j.data} ${j.hora} — **${j.casa}** vs **${j.fora}**`);
  return new EmbedBuilder().setColor(COR_LIME)
    .setTitle('📅 Próximos Jogos da Copa')
    .setDescription(linhas.join('\n'))
    .setFooter({ text: 'Hub Lab C.O • Use /palpite pra dar seu palpite!' }).setTimestamp();
}

// ════════ AUTOMAÇÕES (polling inteligente) ════════
const placarAnterior = {};
const palpitesFechados = new Set();
const jogosEncerrados = new Set();

// Jogos do dia às 8h (1 chamada/dia)
cron.schedule('0 8 * * *', async () => {
  const ch = canal(CH.jogos);
  if (!ch) return;
  const jogos = await api.jogosDoDia();
  ch.send({ embeds: [embedJogosDoDia(jogos)] }).catch(e => console.error('Envio jogos:', e.message));
}, { timezone: 'America/Sao_Paulo' });

// Monitor com frequência adaptável:
// - SEM jogo ao vivo: espera 15 min (economiza chamadas)
// - COM jogo ao vivo: checa a cada 45s (pega os gols)
let temJogoAoVivo = false;

async function checarAoVivo() {
  let proximoDelay;
  try {
    const aoVivo = await api.jogosAoVivo();   // 2 chamadas
    const chGols = canal(CH.gols);

    for (const jogo of aoVivo) {
      const key = String(jogo.id);
      if (!palpitesFechados.has(key)) {
        db.fecharPalpites(key, jogo.casa, jogo.fora);
        palpitesFechados.add(key);
        const chP = canal(CH.palpites);
        if (chP) chP.send(`🔒 **Palpites fechados para ${jogo.casa} x ${jogo.fora}!** O jogo começou!`).catch(() => {});
      }
      const ant = placarAnterior[key];
      if (ant && (jogo.golsCasa !== ant.golsCasa || jogo.golsFora !== ant.golsFora)) {
        if (chGols) chGols.send({ embeds: [embedGol(jogo)] }).catch(() => {});
      }
      placarAnterior[key] = { golsCasa: jogo.golsCasa, golsFora: jogo.golsFora };
    }

    const aoVivoIds = new Set(aoVivo.map(j => String(j.id)));
    for (const key of Object.keys(placarAnterior)) {
      if (!aoVivoIds.has(key) && !jogosEncerrados.has(key)) {
        jogosEncerrados.add(key);
        const ant = placarAnterior[key];
        const dadosP = db.dadosPartida(key);
        if (!dadosP) continue;
        const jogoFim = { casa: dadosP.nomeCasa, fora: dadosP.nomeFora, golsCasa: ant.golsCasa, golsFora: ant.golsFora };
        if (chGols) chGols.send({ embeds: [embedFimDeJogo(jogoFim)] }).catch(() => {});
        const resultados = db.pontuar(key, ant.golsCasa, ant.golsFora);
        const chR = canal(CH.ranking);
        if (chR && Object.keys(resultados).length > 0) chR.send({ embeds: [embedRanking(db.ranking())] }).catch(() => {});
      }
    }

    temJogoAoVivo = aoVivo.length > 0;
    // Com jogo: 45s. Sem jogo: 15 min.
    proximoDelay = temJogoAoVivo ? 45 * 1000 : 15 * 60 * 1000;
  } catch (e) {
    console.error('Monitor ao vivo:', e.message);
    proximoDelay = 5 * 60 * 1000; // erro: tenta de novo em 5 min
  }
  setTimeout(checarAoVivo, proximoDelay);
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

// ════════ COMANDOS ════════
const comandos = [
  new SlashCommandBuilder().setName('jogos').setDescription('Mostra os jogos da Copa de hoje'),
  new SlashCommandBuilder().setName('tabela').setDescription('Mostra a classificação da Copa do Mundo'),
  new SlashCommandBuilder().setName('artilheiros').setDescription('Top 10 artilheiros da Copa'),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking de palpites da Hub Lab C.O'),
  new SlashCommandBuilder().setName('proximos').setDescription('Próximos jogos da Copa (pra você palpitar)'),
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
  new SlashCommandBuilder().setName('ganhador').setDescription('(Staff) Marca o ganhador do dia (+50 XP)')
    .addUserOption(o => o.setName('membro').setDescription('Ganhador do dia').setRequired(true)),
  new SlashCommandBuilder().setName('palpite').setDescription('Dê seu palpite para um jogo')
    .addStringOption(o => o.setName('time_casa').setDescription('Time da casa (ex: Brasil)').setRequired(true))
    .addIntegerOption(o => o.setName('gols_casa').setDescription('Gols do time da casa').setRequired(true).setMinValue(0).setMaxValue(20))
    .addIntegerOption(o => o.setName('gols_fora').setDescription('Gols do time de fora').setRequired(true).setMinValue(0).setMaxValue(20))
    .addStringOption(o => o.setName('time_fora').setDescription('Time de fora (ex: Argentina)').setRequired(true)),
  new SlashCommandBuilder().setName('resultado').setDescription('(Staff) Registra resultado manualmente')
    .addStringOption(o => o.setName('partida_id').setDescription('ID da partida').setRequired(true))
    .addIntegerOption(o => o.setName('gols_casa').setDescription('Gols casa').setRequired(true).setMinValue(0).setMaxValue(20))
    .addIntegerOption(o => o.setName('gols_fora').setDescription('Gols fora').setRequired(true).setMinValue(0).setMaxValue(20)),
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
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();
  const { commandName } = interaction;
  try {
    if (commandName === 'jogos') {
      await interaction.editReply({ embeds: [embedJogosDoDia(await api.jogosDoDia())] });
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
      const tc = interaction.options.getString('time_casa');
      const tf = interaction.options.getString('time_fora');
      const gc = interaction.options.getInteger('gols_casa');
      const gf = interaction.options.getInteger('gols_fora');
      const jogos = await api.jogosDoDia();
      const jogo = jogos.find(j =>
        j.casa.toLowerCase().includes(tc.toLowerCase()) || j.fora.toLowerCase().includes(tf.toLowerCase()));
      if (!jogo) return interaction.editReply('❌ Jogo não encontrado hoje. Use **/jogos** pra ver os disponíveis.');
      const res = db.registrar(interaction.user.id, interaction.user.username, String(jogo.id), gc, gf);
      if (res === 'fechado' || res === 'encerrado')
        return interaction.editReply(`🔒 Palpites já fechados para **${jogo.casa} x ${jogo.fora}**!`);
      const embed = new EmbedBuilder().setColor(COR_LIME).setTitle('🎯 Palpite registrado!')
        .setDescription(`**${jogo.casa} ${gc} x ${gf} ${jogo.fora}**`)
        .addFields(
          { name: '👤 Palpiteiro', value: interaction.user.username, inline: true },
          { name: '🕐 Jogo', value: `${jogo.hora} (Brasília)`, inline: true })
        .setFooter({ text: 'Hub Lab C.O • Exato = 10pts | Resultado = 3pts' });
      await interaction.editReply({ embeds: [embed] });
    } else if (commandName === 'resultado') {
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
      await interaction.editReply(`✅ Resultado registrado! ${Object.keys(resultados).length} palpite(s) pontuado(s).`);
    }
  } catch (e) {
    console.error(`Erro no comando ${commandName}:`, e);
    if (interaction.deferred) interaction.editReply('❌ Ocorreu um erro. Tente novamente em instantes.').catch(() => {});
  }
});

client.once('clientReady', async () => {
  console.log(`✅ Hub Lab C.O Bot online! Logado como ${client.user.tag}`);
  await registrarComandos();
  checarAoVivo(); // inicia o monitor inteligente
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
