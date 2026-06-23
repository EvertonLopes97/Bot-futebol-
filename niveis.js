// niveis.js — Sistema de XP, níveis e convites da Hub Lab C.O
const fs   = require('fs');
const path = require('path');

const DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DB  = path.join(DIR, 'niveis.json');

// ── Escala de 10 níveis (tiers atuais + novos) ──────────────
// Cada nível exige XP acumulado. Curva crescente pra dar progressão.
const NIVEIS = [
  { nivel: 1,  nome: '🌱 Novato',     xp: 0 },
  { nivel: 2,  nome: '🐣 Iniciante',  xp: 100 },
  { nivel: 3,  nome: '💪 Engajado',   xp: 300 },
  { nivel: 4,  nome: '🎯 Ativo',      xp: 700 },
  { nivel: 5,  nome: '🔥 Veterano',   xp: 1400 },
  { nivel: 6,  nome: '⭐ Destaque',   xp: 2500 },
  { nivel: 7,  nome: '🏅 Craque',     xp: 4200 },
  { nivel: 8,  nome: '💎 Ídolo',      xp: 6500 },
  { nivel: 9,  nome: '👑 Lenda',      xp: 9500 },
  { nivel: 10, nome: '🌟 Imortal',    xp: 14000 },
];

// ── Tabela de XP por ação ────────────────────────────────────
const XP_ACOES = {
  mensagem:        2,    // cada mensagem (com teto diário)
  reacao:          1,    // reagir a algo
  msg_relevante:   15,   // mensagem que recebeu muitas reações (auto) ou staff (manual)
  palpite:         5,    // deu um palpite no bolão
  ganhador_dia:    50,   // venceu o ranking de palpites do dia
  convite:         40,   // trouxe um membro novo (também conta no ranking de convites)
  presenca_live:   30,   // esteve na live (manual ou via voice)
  seguir_rede:     20,   // comprovou follow (manual pela staff)
  evento:          25,   // participou de evento (manual)
  bonus_staff:     0,    // valor livre dado pela staff
};

// Teto diário de XP por mensagens (anti-spam)
const TETO_MSG_DIARIO = 60; // ~30 mensagens/dia contam

const VIP_MULT = 1.5;

function carregar() {
  try {
    if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({ usuarios: {}, convites: {} }));
    return JSON.parse(fs.readFileSync(DB, 'utf8'));
  } catch (e) {
    console.error('[NIVEIS] erro ao carregar:', e.message);
    return { usuarios: {}, convites: {} };
  }
}
function salvar(d) {
  try { fs.writeFileSync(DB, JSON.stringify(d, null, 2)); }
  catch (e) { console.error('[NIVEIS] erro ao salvar:', e.message); }
}

function hoje() { return new Date().toISOString().split('T')[0]; }

function nivelPorXp(xp) {
  let atual = NIVEIS[0];
  for (const n of NIVEIS) if (xp >= n.xp) atual = n;
  return atual;
}
function proximoNivel(xp) {
  return NIVEIS.find(n => n.xp > xp) || null;
}

// Garante o registro do usuário
function getUser(d, id, nome) {
  if (!d.usuarios[id]) d.usuarios[id] = { nome, xp: 0, nivel: 1, msgHoje: 0, dia: hoje(), convidados: 0 };
  if (nome) d.usuarios[id].nome = nome;
  return d.usuarios[id];
}

// Adiciona XP. Retorna { subiu, nivelNovo } se mudou de nível.
function darXp(id, nome, acao, ehVip, valorLivre) {
  const d = carregar();
  const u = getUser(d, id, nome);

  // Reset do teto diário de mensagens
  if (u.dia !== hoje()) { u.dia = hoje(); u.msgHoje = 0; }

  let base = acao === 'bonus_staff' ? (valorLivre || 0) : (XP_ACOES[acao] || 0);

  // Teto diário só pra mensagens
  if (acao === 'mensagem') {
    if (u.msgHoje >= TETO_MSG_DIARIO) { salvar(d); return null; }
    u.msgHoje += base;
  }

  if (ehVip) base = Math.round(base * VIP_MULT);

  const nivelAntes = nivelPorXp(u.xp).nivel;
  u.xp += base;
  const nivelDepois = nivelPorXp(u.xp);
  u.nivel = nivelDepois.nivel;

  salvar(d);

  if (nivelDepois.nivel > nivelAntes) return { subiu: true, nivelNovo: nivelDepois, xpGanho: base };
  return { subiu: false, xpGanho: base };
}

// Registra um convite (quem convidou) — conta no ranking de convites E dá XP
function registrarConvite(convidanteId, convidanteNome, ehVip) {
  const d = carregar();
  const u = getUser(d, convidanteId, convidanteNome);
  u.convidados = (u.convidados || 0) + 1;
  if (!d.convites[convidanteId]) d.convites[convidanteId] = { nome: convidanteNome, total: 0 };
  d.convites[convidanteId].total += 1;
  d.convites[convidanteId].nome = convidanteNome;
  salvar(d);
  // dá XP pelo convite (balanceado: 40 XP)
  return darXp(convidanteId, convidanteNome, 'convite', ehVip);
}

function statusUsuario(id) {
  const d = carregar();
  const u = d.usuarios[id];
  if (!u) return null;
  const nv = nivelPorXp(u.xp);
  const prox = proximoNivel(u.xp);
  return {
    nome: u.nome, xp: u.xp, nivel: nv.nome, nivelNum: nv.nivel,
    convidados: u.convidados || 0,
    proximo: prox ? { nome: prox.nome, faltam: prox.xp - u.xp } : null,
  };
}

function rankingXp(limite = 10) {
  const d = carregar();
  return Object.entries(d.usuarios)
    .map(([id, u]) => ({ id, nome: u.nome, xp: u.xp, nivel: nivelPorXp(u.xp).nome }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limite);
}

function rankingConvites(limite = 10) {
  const d = carregar();
  return Object.entries(d.convites)
    .map(([id, c]) => ({ id, nome: c.nome, total: c.total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limite);
}

module.exports = {
  NIVEIS, XP_ACOES, darXp, registrarConvite, statusUsuario,
  rankingXp, rankingConvites, nivelPorXp,
};
