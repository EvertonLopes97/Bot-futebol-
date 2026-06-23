// palpites.js — Sistema de palpites e ranking
// Usa um arquivo JSON simples como banco de dados (sem custo)
const fs   = require('fs');
const path = require('path');

const DB = path.join(__dirname, 'palpites.json');

// Carrega o banco (cria se não existir)
function carregar() {
  if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({ palpites: {}, partidas: {} }));
  return JSON.parse(fs.readFileSync(DB, 'utf8'));
}

function salvar(dados) {
  fs.writeFileSync(DB, JSON.stringify(dados, null, 2));
}

// Registra ou atualiza o palpite de um usuário pra uma partida
// Retorna: 'ok' | 'fechado' | 'encerrado'
function registrar(userId, nomeUsuario, partidaId, golsCasa, golsFora) {
  const dados = carregar();
  const partida = dados.partidas[partidaId];

  if (partida && partida.fechada) return 'fechado';
  if (partida && partida.encerrada) return 'encerrado';

  if (!dados.palpites[partidaId]) dados.palpites[partidaId] = {};

  dados.palpites[partidaId][userId] = {
    nome: nomeUsuario,
    golsCasa,
    golsFora,
    criadoEm: new Date().toISOString(),
  };

  salvar(dados);
  return 'ok';
}

// Fecha os palpites de uma partida (chamado antes do apito)
function fecharPalpites(partidaId, nomeCasa, nomeFora) {
  const dados = carregar();
  if (!dados.partidas[partidaId]) dados.partidas[partidaId] = {};
  dados.partidas[partidaId].fechada = true;
  dados.partidas[partidaId].nomeCasa = nomeCasa;
  dados.partidas[partidaId].nomeFora = nomeFora;
  salvar(dados);
}

// Pontua os palpites após o resultado final
// Regras: exato +10 | resultado certo +3 | participou +1
function pontuar(partidaId, golsCasaReal, golsForaReal) {
  const dados = carregar();
  const palpitesPartida = dados.palpites[partidaId] || {};
  const partida = dados.partidas[partidaId] || {};

  if (partida.encerrada) return {}; // já pontuado

  const resultados = {};

  for (const [userId, p] of Object.entries(palpitesPartida)) {
    let pts = 1; // participou
    const acertouExato = p.golsCasa === golsCasaReal && p.golsFora === golsForaReal;
    const resultadoReal = Math.sign(golsCasaReal - golsForaReal);
    const resultadoPalpite = Math.sign(p.golsCasa - p.golsFora);
    const acertouResultado = resultadoReal === resultadoPalpite;

    if (acertouExato) {
      pts = 10;
    } else if (acertouResultado) {
      pts = 3;
    }

    resultados[userId] = { nome: p.nome, pts, acertouExato, acertouResultado };
  }

  // Marca partida como encerrada e salva pontuação
  dados.partidas[partidaId] = {
    ...partida,
    encerrada: true,
    golsCasaReal,
    golsForaReal,
    pontuados: resultados,
  };
  salvar(dados);
  return resultados;
}

// Ranking geral (soma todos os pontos de todas as partidas)
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

// Palpites de uma partida específica
function palpitesDaPartida(partidaId) {
  const dados = carregar();
  return dados.palpites[partidaId] || {};
}

// Partida pelo ID
function dadosPartida(partidaId) {
  const dados = carregar();
  return dados.partidas[partidaId] || null;
}

module.exports = { registrar, fecharPalpites, pontuar, ranking, palpitesDaPartida, dadosPartida };
