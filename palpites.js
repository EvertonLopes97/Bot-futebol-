// palpites.js — Sistema de palpites e ranking
// Salva num volume persistente do Railway (não perde dados ao reiniciar)
const fs   = require('fs');
const path = require('path');

// Usa o volume do Railway se existir; senão, a pasta local
const DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DB  = path.join(DIR, 'palpites.json');

function carregar() {
  try {
    if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({ palpites: {}, partidas: {} }));
    return JSON.parse(fs.readFileSync(DB, 'utf8'));
  } catch (e) {
    console.error('[DB] Erro ao carregar, recriando:', e.message);
    return { palpites: {}, partidas: {} };
  }
}

function salvar(dados) {
  try {
    fs.writeFileSync(DB, JSON.stringify(dados, null, 2));
  } catch (e) {
    console.error('[DB] Erro ao salvar:', e.message);
  }
}

function registrar(userId, nomeUsuario, partidaId, golsCasa, golsFora) {
  const dados = carregar();
  const partida = dados.partidas[partidaId];
  if (partida && partida.fechada) return 'fechado';
  if (partida && partida.encerrada) return 'encerrado';
  if (!dados.palpites[partidaId]) dados.palpites[partidaId] = {};
  dados.palpites[partidaId][userId] = {
    nome: nomeUsuario, golsCasa, golsFora, criadoEm: new Date().toISOString(),
  };
  salvar(dados);
  return 'ok';
}

function fecharPalpites(partidaId, nomeCasa, nomeFora) {
  const dados = carregar();
  if (!dados.partidas[partidaId]) dados.partidas[partidaId] = {};
  if (dados.partidas[partidaId].fechada) return; // já fechado
  dados.partidas[partidaId].fechada = true;
  dados.partidas[partidaId].nomeCasa = nomeCasa;
  dados.partidas[partidaId].nomeFora = nomeFora;
  salvar(dados);
}

function pontuar(partidaId, golsCasaReal, golsForaReal) {
  const dados = carregar();
  const palpitesPartida = dados.palpites[partidaId] || {};
  const partida = dados.partidas[partidaId] || {};
  if (partida.encerrada) return {}; // já pontuado, não conta de novo

  const resultados = {};
  for (const [userId, p] of Object.entries(palpitesPartida)) {
    let pts = 1; // participou
    const acertouExato = p.golsCasa === golsCasaReal && p.golsFora === golsForaReal;
    const acertouResultado = Math.sign(golsCasaReal - golsForaReal) === Math.sign(p.golsCasa - p.golsFora);
    if (acertouExato) pts = 10;
    else if (acertouResultado) pts = 3;
    resultados[userId] = { nome: p.nome, pts, acertouExato, acertouResultado };
  }
  dados.partidas[partidaId] = { ...partida, encerrada: true, golsCasaReal, golsForaReal, pontuados: resultados };
  salvar(dados);
  return resultados;
}

function ranking() {
  const dados = carregar();
  const placar = {};
  for (const partida of Object.values(dados.partidas)) {
    if (!partida.pontuados) continue;
    for (const [userId, r] of Object.entries(partida.pontuados)) {
      if (!placar[userId]) placar[userId] = { nome: r.nome, pts: 0, exatos: 0, participacoes: 0 };
      placar[userId].pts += r.pts;
      placar[userId].participacoes += 1;
      if (r.acertouExato) placar[userId].exatos += 1;
    }
  }
  return Object.entries(placar)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.pts - a.pts || b.exatos - a.exatos);
}

function dadosPartida(partidaId) {
  const dados = carregar();
  return dados.partidas[partidaId] || null;
}

module.exports = { registrar, fecharPalpites, pontuar, ranking, dadosPartida };
