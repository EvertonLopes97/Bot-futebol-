// index.js — Bot principal da Hub Lab C.O
// Comandos: /jogos /tabela /artilheiros /palpite /ranking /resultado
// Automático: jogos do dia às 8h, gols ao vivo, fecha palpites antes do jogo

require('dotenv').config(); // só pra rodar local; no Railway usa variáveis de ambiente
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, Routes, REST } = require('discord.js');
const cron  = require('node-cron');
const api   = require('./api');
const db    = require('./palpites');

// ── Cliente Discord ───────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── IDs dos canais (vêm das variáveis de ambiente) ───────────
const CH = {
  gols:     process.env.CANAL_GOLS,
  jogos:    process.env.CANAL_JOGOS,
  tabela:   process.env.CANAL_TABELA,
  palpites: process.env.CANAL_PALPITES,
  ranking:  process.env.CANAL_RANKING,
};

// ── Cores da Hub Lab C.O ─────────────────────────────────────
const COR_LIME    = 0xC6F432;
const COR_GOL     = 0xFF3D7F;
const COR_TABELA  = 0x378ADD;
const COR_RANKING = 0xFFD700;
const COR_ERRO    = 0xE24B4A;

// ── Helper: pega canal pelo ID ────────────────────────────────
function canal(id) { return client.channels.cache.get(id); }

// ══════════════════════════════════════════════════════════════
// EMBEDS (cards visuais)
// ══════════════════════════════════════════════════════════════

function embedJogosDoDia(jogos) {
  if (!jogos.length) {
    return new EmbedBuilder()
      .setColor(COR_LIME)
      .setTitle('⚽ Copa do Mundo — Jogos de Hoje')
      .setDescription('Nenhum jogo hoje. Aproveita pra palpitar nos próximos! 😄')
      .setFooter({ text: 'Hub Lab C.O • football-data.org' });
  }

  const linhas = jogos.map(j => {
    const placar = (j.golsCasa !== null && j.golsFora !== null)
      ? `**${j.golsCasa} x ${j.golsFora}**`
      : 'vs';
    const status = j.status === 'FINISHED' ? '✅' : j.status === 'IN_PLAY' ? '🔴 AO VIVO' : `🕐 ${j.hora}`;
    return `${status} **${j.casa}** ${placar} **${j.fora}**`;
  });

  return new EmbedBuilder()
    .setColor(COR_LIME)
    .setTitle('⚽ Copa do Mundo — Jogos de Hoje')
    .setDescription(linhas.join('\n'))
    .setFooter({ text: 'Hub Lab C.O • Use /palpite pra palpitar!' })
    .setTimestamp();
}

function embedGol(jogo) {
  return new EmbedBuilder()
    .setColor(COR_GOL)
    .setTitle('⚽ GOOOOL!')
    .setDescription(`## ${jogo.casa} **${jogo.golsCasa}** x **${jogo.golsFora}** ${jogo.fora}`)
    .addFields({ name: '🕐 Minuto', value: `${jogo.minuto}'`, inline: true })
    .setFooter({ text: 'Hub Lab C.O • Copa do Mundo 2026' })
    .setTimestamp();
}

function embedFimDeJogo(jogo) {
  const vencedor = jogo.golsCasa > jogo.golsFora ? jogo.casa
    : jogo.golsFora > jogo.golsCasa ? jogo.fora : 'Empate';
  return new EmbedBuilder()
    .setColor(COR_LIME)
    .setTitle('🏁 Fim de Jogo!')
    .setDescription(`## ${jogo.casa} **${jogo.golsCasa}** x **${jogo.golsFora}** ${jogo.fora}`)
    .addFields({ name: '🏆 Resultado', value: vencedor === 'Empate' ? '🤝 Empate!' : `🎉 Vitória do ${vencedor}!` })
    .setFooter({ text: 'Hub Lab C.O' })
    .setTimestamp();
}

function embedTabela(grupos) {
  const embed = new EmbedBuilder()
    .setColor(COR_TABELA)
    .setTitle('📊 Copa do Mundo — Classificação')
    .setFooter({ text: 'Hub Lab C.O • football-data.org' })
    .setTimestamp();

  const gruposParaMostrar = grupos.slice(0, 4); // máx 4 grupos por embed
  for (const g of gruposParaMostrar) {
    const nome = g.grupo.replace('GROUP_', 'Grupo ');
    const linhas = g.times.map(t =>
      `${t.pos}. **${t.time}** — ${t.pts}pts | ${t.j}J ${t.v}V ${t.e}E ${t.d}D (${t.sg > 0 ? '+' : ''}${t.sg})`
    ).join('\n');
    embed.addFields({ name: `⚽ ${nome}`, value: linhas || 'Sem dados', inline: false });
  }
  return embed;
}

function embedArtilheiros(lista) {
  const medalhas = ['🥇', '🥈', '🥉'];
  const linhas = lista.map((a, i) =>
    `${medalhas[i] || `${a.pos}.`} **${a.nome}** (${a.time}) — ${a.gols} gol${a.gols !== 1 ? 's' : ''}`
  ).join('\n');

  return new EmbedBuilder()
    .setColor(COR_GOL)
    .setTitle('🥇 Copa do Mundo — Artilheiros')
    .setDescription(linhas || 'Ainda sem gols marcados.')
    .setFooter({ text: 'Hub Lab C.O' })
    .setTimestamp();
}

function embedRanking(lista) {
  if (!lista.length) {
    return new EmbedBuilder()
      .setColor(COR_RANKING)
      .setTitle('🏆 Ranking de Palpites — Hub Lab C.O')
      .setDescription('Nenhum palpite pontuado ainda. Joga lá! /palpite')
      .setFooter({ text: 'Hub Lab C.O' });
  }

  const medalhas = ['🥇', '🥈', '🥉'];
  const linhas = lista.slice(0, 10).map((p, i) =>
    `${medalhas[i] || `${i + 1}.`} **${p.nome}** — **${p.pts} pts** | ${p.exatos} placar exato | ${p.participacoes} palpite${p.participacoes !== 1 ? 's' : ''}`
  ).join('\n');

  return new EmbedBuilder()
    .setColor(COR_RANKING)
    .setTitle('🏆 Ranking de Palpites — Hub Lab C.O')
    .setDescription(linhas)
    .setFooter({ text: 'Placar exato = 10pts | Resultado certo = 3pts | Participou = 1pt' })
    .setTimestamp();
}

// ══════════════════════════════════════════════════════════════
// AUTOMAÇÕES (cron jobs)
// ══════════════════════════════════════════════════════════════

// Estado pra detectar gols (guarda o placar anterior de cada jogo)
const placarAnterior = {};
// Estado pra saber quais jogos já foram fechados e encerrados
const palpitesFechados = new Set();
const jogosEncerrados = new Set();

// ─ Jogos do dia às 8h (horário de Brasília) ──────────────────
cron.schedule('0 8 * * *', async () => {
  const ch = canal(CH.jogos);
  if (!ch) return;
  try {
    const jogos = await api.jogosDoDia();
    await ch.send({ embeds: [embedJogosDoDia(jogos)] });
  } catch (e) { console.error('Erro jogos do dia:', e.message); }
}, { timezone: 'America/Sao_Paulo' });

// ─ Monitor de gols (a cada 30s durante o dia) ────────────────
cron.schedule('*/30 * * * * *', async () => {
  try {
    const aoVivo = await api.jogosAoVivo();
    const chGols = canal(CH.gols);

    for (const jogo of aoVivo) {
      const key = String(jogo.id);
      const ant = placarAnterior[key];

      // Fecha palpites 1 min antes do jogo (quando status muda pra IN_PLAY)
      if (!palpitesFechados.has(key)) {
        db.fecharPalpites(key, jogo.casa, jogo.fora);
        palpitesFechados.add(key);
        const chP = canal(CH.palpites);
        if (chP) await chP.send(`🔒 **Palpites fechados para ${jogo.casa} x ${jogo.fora}!** O jogo começou!`);
      }

      // Detecta gol (placar mudou)
      if (ant && (jogo.golsCasa !== ant.golsCasa || jogo.golsFora !== ant.golsFora)) {
        if (chGols) await chGols.send({ embeds: [embedGol(jogo)] });
      }

      placarAnterior[key] = { golsCasa: jogo.golsCasa, golsFora: jogo.golsFora };
    }

    // Detecta jogos que acabaram (estavam ao vivo, saíram da lista)
    const aoVivoIds = new Set(aoVivo.map(j => String(j.id)));
    for (const key of Object.keys(placarAnterior)) {
      if (!aoVivoIds.has(key) && !jogosEncerrados.has(key)) {
        jogosEncerrados.add(key);
        const ant = placarAnterior[key];
        const dadosP = db.dadosPartida(key);
        if (!dadosP) continue;

        // Monta embed de fim de jogo
        const jogoFim = { casa: dadosP.nomeCasa, fora: dadosP.nomeFora, golsCasa: ant.golsCasa, golsFora: ant.golsFora };
        if (chGols) await chGols.send({ embeds: [embedFimDeJogo(jogoFim)] });

        // Pontua os palpites
        const resultados = db.pontuar(key, ant.golsCasa, ant.golsFora);
        const chR = canal(CH.ranking);
        if (chR && Object.keys(resultados).length > 0) {
          const rank = db.ranking();
          await chR.send({ embeds: [embedRanking(rank)] });
        }
      }
    }
  } catch (e) { console.error('Erro monitor ao vivo:', e.message); }
});

// ══════════════════════════════════════════════════════════════
// COMANDOS SLASH
// ══════════════════════════════════════════════════════════════

const comandos = [
  new SlashCommandBuilder()
    .setName('jogos')
    .setDescription('Mostra os jogos da Copa de hoje'),

  new SlashCommandBuilder()
    .setName('tabela')
    .setDescription('Mostra a classificação da Copa do Mundo'),

  new SlashCommandBuilder()
    .setName('artilheiros')
    .setDescription('Top 10 artilheiros da Copa'),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Ranking de palpites da Hub Lab C.O'),

  new SlashCommandBuilder()
    .setName('palpite')
    .setDescription('Dê seu palpite para um jogo')
    .addStringOption(o => o.setName('time_casa').setDescription('Time da casa (ex: Brasil)').setRequired(true))
    .addIntegerOption(o => o.setName('gols_casa').setDescription('Gols do time da casa').setRequired(true).setMinValue(0).setMaxValue(20))
    .addIntegerOption(o => o.setName('gols_fora').setDescription('Gols do time de fora').setRequired(true).setMinValue(0).setMaxValue(20))
    .addStringOption(o => o.setName('time_fora').setDescription('Time de fora (ex: Argentina)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('resultado')
    .setDescription('(Staff) Registra o resultado de um jogo manualmente')
    .addStringOption(o => o.setName('partida_id').setDescription('ID da partida').setRequired(true))
    .addIntegerOption(o => o.setName('gols_casa').setDescription('Gols do time da casa').setRequired(true).setMinValue(0).setMaxValue(20))
    .addIntegerOption(o => o.setName('gols_fora').setDescription('Gols do time de fora').setRequired(true).setMinValue(0).setMaxValue(20)),
];

// ─ Registra os comandos no Discord ───────────────────────────
async function registrarComandos() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('Registrando comandos slash...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: comandos.map(c => c.toJSON()) });
    console.log('Comandos registrados!');
  } catch (e) { console.error('Erro ao registrar comandos:', e); }
}

// ─ Lida com os comandos ──────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply(); // evita timeout

  const { commandName } = interaction;

  try {
    // /jogos
    if (commandName === 'jogos') {
      const jogos = await api.jogosDoDia();
      await interaction.editReply({ embeds: [embedJogosDoDia(jogos)] });
    }

    // /tabela
    else if (commandName === 'tabela') {
      const grupos = await api.tabela();
      if (!grupos.length) { await interaction.editReply('Tabela ainda não disponível.'); return; }
      await interaction.editReply({ embeds: [embedTabela(grupos)] });
    }

    // /artilheiros
    else if (commandName === 'artilheiros') {
      const lista = await api.artilheiros();
      await interaction.editReply({ embeds: [embedArtilheiros(lista)] });
    }

    // /ranking
    else if (commandName === 'ranking') {
      const rank = db.ranking();
      await interaction.editReply({ embeds: [embedRanking(rank)] });
    }

    // /palpite
    else if (commandName === 'palpite') {
      const timeCasa = interaction.options.getString('time_casa');
      const timeFora = interaction.options.getString('time_fora');
      const golsCasa = interaction.options.getInteger('gols_casa');
      const golsFora = interaction.options.getInteger('gols_fora');

      // Busca o jogo do dia que bate com os times
      const jogos = await api.jogosDoDia();
      const jogo = jogos.find(j =>
        j.casa.toLowerCase().includes(timeCasa.toLowerCase()) ||
        j.fora.toLowerCase().includes(timeFora.toLowerCase())
      );

      if (!jogo) {
        await interaction.editReply(`❌ Jogo não encontrado hoje. Use **/jogos** pra ver os jogos disponíveis.`);
        return;
      }

      const res = db.registrar(
        interaction.user.id,
        interaction.user.username,
        String(jogo.id),
        golsCasa,
        golsFora
      );

      if (res === 'fechado' || res === 'encerrado') {
        await interaction.editReply(`🔒 Palpites já fechados para **${jogo.casa} x ${jogo.fora}**!`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(COR_LIME)
        .setTitle('🎯 Palpite registrado!')
        .setDescription(`**${jogo.casa} ${golsCasa} x ${golsFora} ${jogo.fora}**`)
        .addFields(
          { name: '👤 Palpiteiro', value: interaction.user.username, inline: true },
          { name: '🕐 Jogo', value: `${jogo.hora} (Brasília)`, inline: true }
        )
        .setFooter({ text: 'Hub Lab C.O • Placar exato = 10pts | Resultado certo = 3pts' });

      await interaction.editReply({ embeds: [embed] });
    }

    // /resultado (só staff)
    else if (commandName === 'resultado') {
      const membro = await interaction.guild.members.fetch(interaction.user.id);
      const ehStaff = membro.roles.cache.some(r =>
        ['Fundador', '👑 Fundador', 'Moderador', '🛡️ Moderador'].includes(r.name)
      );
      if (!ehStaff) {
        await interaction.editReply('❌ Só a staff pode usar esse comando.');
        return;
      }

      const partidaId = interaction.options.getString('partida_id');
      const golsCasa  = interaction.options.getInteger('gols_casa');
      const golsFora  = interaction.options.getInteger('gols_fora');

      db.fecharPalpites(partidaId, 'Time Casa', 'Time Fora');
      const resultados = db.pontuar(partidaId, golsCasa, golsFora);
      const rank = db.ranking();

      const chR = canal(CH.ranking);
      if (chR) await chR.send({ embeds: [embedRanking(rank)] });

      await interaction.editReply(`✅ Resultado registrado! ${Object.keys(resultados).length} palpites pontuados. Ranking atualizado em <#${CH.ranking}>.`);
    }

  } catch (e) {
    console.error(`Erro no comando ${commandName}:`, e);
    await interaction.editReply('❌ Ocorreu um erro. Tente novamente em instantes.');
  }
});

// ── Bot pronto ────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Hub Lab C.O Bot online! Logado como ${client.user.tag}`);
  await registrarComandos();
});

client.login(process.env.DISCORD_TOKEN);
