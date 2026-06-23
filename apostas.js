// apostas.js — Análise estatística e montador de múltiplas (uso recreativo)
// Puxa stats de UMA API por vez (respeita limites), cacheia e compara fontes.
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const CACHE = path.join(DIR, 'stats_cache.json');

const RAPID_KEY = process.env.RAPIDAPI_KEY; // API-Football (RapidAPI)
const RAPID_HOST = 'api-football-v1.p.rapidapi.com';

// ── cache simples (evita estourar limite das APIs) ──
function lerCache() {
  try { return fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE,'utf8')) : {}; }
  catch { return {}; }
}
function salvarCache(c) { try { fs.writeFileSync(CACHE, JSON.stringify(c,null,2)); } catch {} }

// Cache com validade (TTL) — não repete chamada se buscou há pouco
function getCache(chave, ttlMin) {
  const c = lerCache();
  const item = c[chave];
  if (item && (Date.now() - item.ts) < ttlMin*60*1000) return item.dados;
  return null;
}
function setCache(chave, dados) {
  const c = lerCache();
  c[chave] = { ts: Date.now(), dados };
  salvarCache(c);
}

// ── API-Football (RapidAPI): estatísticas de um time ──
async function statsTime(teamId, leagueId, season) {
  const chave = `stats_${teamId}_${leagueId}_${season}`;
  const cacheado = getCache(chave, 360); // 6h de validade
  if (cacheado) return { ...cacheado, fonte: 'cache' };
  if (!RAPID_KEY) return null;
  try {
    const url = `https://${RAPID_HOST}/v3/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`;
    const res = await fetch(url, { headers: { 'x-rapidapi-key': RAPID_KEY, 'x-rapidapi-host': RAPID_HOST } });
    if (!res.ok) { console.error('[APOSTAS] API-Football status', res.status); return null; }
    const j = await res.json();
    const r = j.response;
    if (!r) return null;
    const dados = {
      time: r.team?.name,
      jogos: r.fixtures?.played?.total || 0,
      golsMarcados: parseFloat(r.goals?.for?.average?.total) || 0,
      golsSofridos: parseFloat(r.goals?.against?.average?.total) || 0,
      cartoesAmarelos: somaCartoes(r.cards?.yellow),
      cartoesVermelhos: somaCartoes(r.cards?.red),
      fonte: 'API-Football',
    };
    setCache(chave, dados);
    return dados;
  } catch (e) { console.error('[APOSTAS]', e.message); return null; }
}
function somaCartoes(obj) {
  if (!obj) return 0;
  let total = 0, jogos = 0;
  for (const faixa of Object.values(obj)) {
    if (faixa && typeof faixa.total === 'number') { total += faixa.total; }
  }
  return total;
}

// ── Probabilidade implícita de uma odd ──
function probImplicita(odd) { return odd > 0 ? (1/odd) : 0; }

// ── Odd combinada de uma múltipla ──
function oddCombinada(odds) { return odds.reduce((a,o)=>a*o, 1); }

// ── Monta análise de uma múltipla ──
// pernas = [{ mercado, odd, probEstimada (0-1, opcional) }]
function analisarMultipla(pernas, valorApostado) {
  const odds = pernas.map(p => p.odd);
  const combinada = oddCombinada(odds);
  const retorno = valorApostado * combinada;

  // Probabilidade real combinada: usa a estimada se houver, senão a implícita da odd
  const probReal = pernas.reduce((acc, p) => {
    const pr = (typeof p.probEstimada === 'number') ? p.probEstimada : probImplicita(p.odd);
    return acc * pr;
  }, 1);

  // Valor esperado (EV): positivo = aposta de valor; negativo = casa tem vantagem
  const ev = (probReal * retorno) - valorApostado;

  let nivel;
  if (combinada <= 2.5) nivel = '🟢 Segura';
  else if (combinada <= 6) nivel = '🟡 Moderada';
  else if (combinada <= 15) nivel = '🟠 Arriscada';
  else nivel = '🔴 Loteria (muito improvável)';

  return {
    pernas,
    oddCombinada: combinada.toFixed(2),
    retorno: retorno.toFixed(2),
    valorApostado,
    probRealPct: (probReal*100).toFixed(2),
    chance: probReal > 0 ? `1 em ${Math.round(1/probReal)}` : '—',
    ev: ev.toFixed(2),
    evPositivo: ev > 0,
    nivel,
  };
}

module.exports = { statsTime, probImplicita, oddCombinada, analisarMultipla };
