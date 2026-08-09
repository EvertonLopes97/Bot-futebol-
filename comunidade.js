// =====================================================================
// comunidade.js — Identidade e hábito na Hub Lab C.O
//
// DUAS FEATURES:
//
// 1) CARGOS DE TIME — a pessoa escolhe seu clube e ganha o cargo com a
//    cor dele. Cria identidade e rivalidade natural: o pessoal se
//    reconhece e se provoca sozinho, sem depender de vocês online.
//
// 2) SEQUÊNCIA (streak) — conta dias seguidos de atividade. É a mecânica
//    do Duolingo: as pessoas voltam pra não perder o que construíram.
//    É SILENCIOSA (não notifica ninguém), então zero risco de spam.
//
// COMO ENCAIXAR no index.js:
//   const com = require('./comunidade');
//   // no ready:            com.iniciar(client);
//   // no interactionCreate: if (await com.tratarComando(interaction)) return;
//   // no messageCreate:     com.marcarAtividade(msg.author.id, msg.author.username);
//   // e adicionar com.comandos() na lista de slash commands
// =====================================================================

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || __dirname;
const DB = path.join(DIR, 'comunidade.json');

// ── Os 20 clubes com suas cores oficiais ──────────────────────────────
// A cor vira a cor do cargo no Discord — fica bonito na lista de membros.
const CLUBES = [
  { nome: 'Flamengo',      emoji: '🔴⚫', cor: 0xE30613 },
  { nome: 'Corinthians',   emoji: '⚫⚪', cor: 0x000000 },
  { nome: 'Palmeiras',     emoji: '🟢⚪', cor: 0x006437 },
  { nome: 'São Paulo',     emoji: '🔴⚪', cor: 0xFE0000 },
  { nome: 'Vasco',         emoji: '⚫⚪', cor: 0x231F20 },
  { nome: 'Cruzeiro',      emoji: '🔵⚪', cor: 0x003399 },
  { nome: 'Atlético-MG',   emoji: '⚫⚪', cor: 0x1B1B1B },
  { nome: 'Grêmio',        emoji: '🔵⚫', cor: 0x0D80BF },
  { nome: 'Internacional', emoji: '🔴⚪', cor: 0xE5050F },
  { nome: 'Santos',        emoji: '⚪⚫', cor: 0xFFFFFF },
  { nome: 'Botafogo',      emoji: '⚫⭐', cor: 0x2C2C2C },
  { nome: 'Fluminense',    emoji: '🟢🔴', cor: 0x7A0026 },
  { nome: 'Bahia',         emoji: '🔵🔴', cor: 0x005CA9 },
  { nome: 'Athletico-PR',  emoji: '🔴⚫', cor: 0xC8102E },
  { nome: 'Vitória',       emoji: '🔴⚫', cor: 0xE30613 },
  { nome: 'Coritiba',      emoji: '🟢⚪', cor: 0x006B3F },
  { nome: 'Bragantino',    emoji: '🔴⚪', cor: 0xD50032 },
  { nome: 'Chapecoense',   emoji: '🟢⚪', cor: 0x006F3C },
  { nome: 'Remo',          emoji: '🔵⚪', cor: 0x004B87 },
  { nome: 'Mirassol',      emoji: '🟡🟢', cor: 0xFFD100 },
];

const PREFIXO_CARGO = process.env.PREFIXO_CARGO_TIME || 'Torcida';

// ── Persistência ──────────────────────────────────────────────────────
function carregar() {
  try {
    if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({ streaks: {}, times: {} }));
    return JSON.parse(fs.readFileSync(DB, 'utf8'));
  } catch (e) {
    console.error('[COMUNIDADE] erro ao carregar:', e.message);
    return { streaks: {}, times: {} };
  }
}
function salvar(d) {
  try { fs.writeFileSync(DB, JSON.stringify(d, null, 2)); }
  catch (e) { console.error('[COMUNIDADE] erro ao salvar:', e.message); }
}

function hojeBR() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function ontemBR() {
  return new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// ── SEQUÊNCIA ─────────────────────────────────────────────────────────
// Marca que a pessoa apareceu hoje. Chamada a cada mensagem/palpite.
// Silenciosa: não responde nada, só registra.
function marcarAtividade(id, nome) {
  if (!id) return null;
  const d = carregar();
  const hoje = hojeBR();
  const s = d.streaks[id] || { nome, atual: 0, recorde: 0, ultimoDia: null, totalDias: 0 };

  if (s.ultimoDia === hoje) { // já contou hoje
    if (nome) { s.nome = nome; d.streaks[id] = s; salvar(d); }
    return null;
  }

  // Continuou a sequência ou recomeçou?
  s.atual = (s.ultimoDia === ontemBR()) ? s.atual + 1 : 1;
  s.ultimoDia = hoje;
  s.totalDias = (s.totalDias || 0) + 1;
  if (nome) s.nome = nome;
  if (s.atual > (s.recorde || 0)) s.recorde = s.atual;

  d.streaks[id] = s;
  salvar(d);
  return { atual: s.atual, recorde: s.recorde, novoRecorde: s.atual === s.recorde && s.atual > 1 };
}

function streakDe(id) {
  const d = carregar();
  const s = d.streaks[id];
  if (!s) return null;
  // Se faltou ontem e hoje, a sequência já era
  const viva = s.ultimoDia === hojeBR() || s.ultimoDia === ontemBR();
  return { ...s, atual: viva ? s.atual : 0 };
}

function rankingStreak(limite = 10) {
  const d = carregar();
  const hoje = hojeBR(), ontem = ontemBR();
  return Object.entries(d.streaks)
    .map(([id, s]) => ({
      id, nome: s.nome,
      atual: (s.ultimoDia === hoje || s.ultimoDia === ontem) ? s.atual : 0,
      recorde: s.recorde || 0,
    }))
    .filter(s => s.atual > 0)
    .sort((a, b) => b.atual - a.atual)
    .slice(0, limite);
}

// Emoji que representa o tamanho da sequência (dá sensação de progressão)
function emojiStreak(n) {
  if (n >= 100) return '💎';
  if (n >= 50)  return '👑';
  if (n >= 30)  return '🔥';
  if (n >= 14)  return '⚡';
  if (n >= 7)   return '🌟';
  if (n >= 3)   return '✨';
  return '🌱';
}

// ── CARGOS DE TIME ────────────────────────────────────────────────────
function acharClube(nome) {
  const n = String(nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return CLUBES.find(c =>
    c.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === n
  );
}

async function darCargoTime(interaction, nomeTime) {
  const clube = acharClube(nomeTime);
  if (!clube) return { erro: 'Time não encontrado.' };

  const guild = interaction.guild;
  const membro = interaction.member;
  const nomeCargo = `${PREFIXO_CARGO} ${clube.nome}`;

  // Tira os cargos de outros times (a pessoa só torce pra um... em tese)
  const cargosTime = guild.roles.cache.filter(r => r.name.startsWith(PREFIXO_CARGO + ' '));
  for (const [, r] of cargosTime) {
    if (r.name !== nomeCargo && membro.roles.cache.has(r.id)) {
      await membro.roles.remove(r).catch(() => {});
    }
  }

  // Acha ou cria o cargo do time
  let cargo = guild.roles.cache.find(r => r.name === nomeCargo);
  if (!cargo) {
    // "colors" é o campo novo do discord.js; "color" ainda funciona mas
    // avisa depreciação no log. Mandamos os dois: a versão nova usa
    // "colors" e ignora o resto; a antiga usa "color". Sem warning, sem quebrar.
    cargo = await guild.roles.create({
      name: nomeCargo,
      colors: { primaryColor: clube.cor },
      color: clube.cor,
      reason: 'Cargo de torcida',
      mentionable: true,  // permite marcar a torcida toda: útil pra "torcida do Galo, o jogo é agora"
    }).catch(() => null);
    if (!cargo) return { erro: 'Não consegui criar o cargo. O bot tem permissão de Gerenciar Cargos?' };
  }

  await membro.roles.add(cargo).catch(() => {});

  // registra no banco (pra estatística de torcida)
  const d = carregar();
  d.times[membro.id] = { nome: membro.user.username, time: clube.nome, em: Date.now() };
  salvar(d);

  return { ok: true, clube, cargo };
}

function contarTorcidas() {
  const d = carregar();
  const contagem = {};
  for (const v of Object.values(d.times)) {
    contagem[v.time] = (contagem[v.time] || 0) + 1;
  }
  return Object.entries(contagem).sort((a, b) => b[1] - a[1]);
}

// ── COMANDOS SLASH ────────────────────────────────────────────────────
function comandos() {
  return [
    new SlashCommandBuilder()
      .setName('time')
      .setDescription('Escolha seu time e ganhe o cargo da torcida!')
      .addStringOption(o => o.setName('clube').setDescription('Seu time do coração')
        .setRequired(true)
        .addChoices(...CLUBES.slice(0, 25).map(c => ({ name: c.nome, value: c.nome })))),

    new SlashCommandBuilder()
      .setName('torcidas')
      .setDescription('Veja quantos torcedores de cada time tem no servidor'),

    new SlashCommandBuilder()
      .setName('sequencia')
      .setDescription('Sua sequência de dias seguidos na Hub Lab'),

    new SlashCommandBuilder()
      .setName('ranksequencia')
      .setDescription('Quem tem a maior sequência de dias na comunidade'),
  ];
}

// Devolve true se tratou o comando (pra o index saber que não precisa seguir).
// IMPORTANTE: o index.js já chama deferReply() antes de nos chamar, por isso
// aqui usamos direto editReply() — chamar deferReply de novo daria erro.
async function tratarComando(interaction) {
  const cmd = interaction.commandName;

  if (cmd === 'time') {
    const escolha = interaction.options.getString('clube');
    const r = await darCargoTime(interaction, escolha);
    if (r.erro) return await interaction.editReply(r.erro), true;

    const emb = new EmbedBuilder()
      .setColor(r.clube.cor)
      .setTitle(`${r.clube.emoji} ${r.clube.nome}!`)
      .setDescription(
        `<@${interaction.member.id}> agora faz parte da **Torcida do ${r.clube.nome}**!\n\n` +
        `Seu cargo já apareceu na lista de membros. Bora provocar a rivalidade aí! 🔥`
      );
    await interaction.editReply({ embeds: [emb] });
    return true;
  }

  if (cmd === 'torcidas') {
    const lista = contarTorcidas();
    if (!lista.length) return await interaction.editReply('Ninguém escolheu time ainda! Use `/time` pra ser o primeiro.'), true;

    const total = lista.reduce((s, [, n]) => s + n, 0);
    const linhas = lista.map(([time, n], i) => {
      const c = acharClube(time);
      const pct = Math.round((n / total) * 100);
      const barra = '█'.repeat(Math.max(1, Math.round(pct / 5)));
      return `${['🥇','🥈','🥉'][i] || `${i + 1}.`} ${c?.emoji || ''} **${time}** — ${n} (${pct}%)\n\`${barra}\``;
    }).join('\n');

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0xC6F432)
      .setTitle('🏟️ Torcidas da Hub Lab')
      .setDescription(linhas)
      .setFooter({ text: `${total} torcedores declarados · use /time pra escolher o seu` })] });
    return true;
  }

  if (cmd === 'sequencia') {
    const s = streakDe(interaction.user.id);
    if (!s || !s.atual) {
      await interaction.editReply('Você ainda não tem sequência! Participe hoje (mande mensagem ou dê um palpite) e comece a sua. 🌱');
      return true;
    }
    const emb = new EmbedBuilder()
      .setColor(0xC6F432)
      .setTitle(`${emojiStreak(s.atual)} Sequência de ${s.atual} dia${s.atual > 1 ? 's' : ''}!`)
      .setDescription(
        `**Atual:** ${s.atual} dias seguidos\n` +
        `**Seu recorde:** ${s.recorde} dias\n` +
        `**Total de dias ativos:** ${s.totalDias || s.atual}\n\n` +
        (s.atual >= 7 ? '🔥 Você tá voando! Não perde essa sequência não.' :
         `Faltam **${7 - s.atual}** dias pra chegar em 🌟 uma semana seguida!`)
      );
    await interaction.editReply({ embeds: [emb] });
    return true;
  }

  if (cmd === 'ranksequencia') {
    const top = rankingStreak(10);
    if (!top.length) return await interaction.editReply('Ninguém tem sequência ativa ainda. Seja o primeiro!'), true;
    const linhas = top.map((s, i) =>
      `${['🥇','🥈','🥉'][i] || `${i + 1}.`} ${emojiStreak(s.atual)} **${s.nome}** — ${s.atual} dias (recorde: ${s.recorde})`
    ).join('\n');
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0xC6F432)
      .setTitle('🔥 Maiores sequências da Hub Lab')
      .setDescription(linhas)
      .setFooter({ text: 'Apareça todo dia pra manter a sua!' })] });
    return true;
  }

  return false; // não era comando meu
}

function iniciar(client) {
  console.log('[COMUNIDADE] cargos de time + sequência ativos.');
}

module.exports = {
  iniciar, comandos, tratarComando,
  marcarAtividade, streakDe, rankingStreak, emojiStreak,
  CLUBES, contarTorcidas, darCargoTime, acharClube,
};
