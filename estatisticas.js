// estatisticas.js — Análise estatística via Sofascore (RapidAPI)
// Usado SÓ nos 3 jogos em destaque (economiza cota). Marca real vs estimativa.
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const CACHE = path.join(DIR, 'stats_sofa.json');
const RAPID_KEY = process.env.RAPIDAPI_KEY;
const RAPID_HOST = process.env.SOFASCORE_HOST || 'sofascore.p.rapidapi.com';

function getCache(chave, ttlH) {
  try {
    const c = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE,'utf8')) : {};
    const it = c[chave];
    if (it && (Date.now()-it.ts) < ttlH*3600*1000) return it.dados;
  } catch {}
  return null;
}
function setCache(chave, dados) {
  try {
    const c = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE,'utf8')) : {};
    c[chave] = { ts: Date.now(), dados };
    fs.writeFileSync(CACHE, JSON.stringify(c,null,2));
  } catch {}
}

// helper de fetch tolerante
async function rapidGet(endpoint) {
  if (!RAPID_KEY) return null;
  try {
    const url = `https://${RAPID_HOST}${endpoint}`;
    const res = await fetch(url, { headers: { 'x-rapidapi-key': RAPID_KEY, 'x-rapidapi-host': RAPID_HOST } });
    if (!res.ok) { console.log(`[STATS] ${endpoint} → status ${res.status}`); return null; }
    return await res.json();
  } catch (e) { console.log('[STATS] erro:', e.message); return null; }
}

// Procura um time pelo nome e retorna o teamId do Sofascore
async function buscarTimeId(nome) {
  const chave = `id_${nome.toLowerCase()}`;
  const cacheado = getCache(chave, 168); // 7 dias
  if (cacheado) return cacheado;
  // endpoint de busca (tolerante a variações)
  const j = await rapidGet(`/v1/search/multi?query=${encodeURIComponent(nome)}&type=teams`)
         || await rapidGet(`/search?q=${encodeURIComponent(nome)}`);
  if (!j) return null;
  try {
    const results = j.results || j.teams || j.data || [];
    const time = (Array.isArray(results) ? results : []).find(r =>
      (r.entity?.name || r.name || '').toLowerCase().includes(nome.toLowerCase().slice(0,4)));
    const id = time?.entity?.id || time?.id;
    if (id) { setCache(chave, id); return id; }
  } catch {}
  return null;
}

// Estatísticas reais de um time. Retorna o que conseguir; null nos campos sem dado.
async function statsTime(nome) {
  const chave = `stats_${nome.toLowerCase()}`;
  const cacheado = getCache(chave, 24);
  if (cacheado) return cacheado;
  if (!RAPID_KEY) return null;

  const id = await buscarTimeId(nome);
  if (!id) { console.log(`[STATS] time não encontrado: ${nome}`); return null; }

  // tenta endpoints de estatística (tolerante)
  const j = await rapidGet(`/v1/teams/get-statistics?teamId=${id}`)
         || await rapidGet(`/teams/${id}/statistics`);

  const dados = { id, escanteiosMedia: null, golsMarcadosMedia: null, golsSofridosMedia: null, artilheiro: null };
  if (j) {
    try {
      const s = j.statistics || j.stats || j;
      dados.escanteiosMedia = parseFloat(s.cornersAvg || s.corners || s.cornersPerGame) || null;
      dados.golsMarcadosMedia = parseFloat(s.goalsScoredAvg || s.goalsFor) || null;
      dados.golsSofridosMedia = parseFloat(s.goalsConcededAvg || s.goalsAgainst) || null;
    } catch {}
  }

  // tenta pegar o artilheiro do time
  const jp = await rapidGet(`/v1/teams/get-top-players?teamId=${id}`)
          || await rapidGet(`/teams/${id}/top-players`);
  if (jp) {
    try {
      const players = jp.topPlayers?.goals || jp.players || jp.data || [];
      const top = (Array.isArray(players) ? players : [])[0];
      if (top) dados.artilheiro = { nome: top.player?.name || top.name, gols: top.statistics?.goals || top.goals };
    } catch {}
  }

  setCache(chave, dados);
  return dados;
}

// Monta mercados ANALISADOS pra um jogo (real vs estimativa marcado)
async function mercadosAnalisados(casa, fora) {
  const sCasa = await statsTime(casa);
  const sFora = await statsTime(fora);
  const mercados = [];

  // ESCANTEIOS (real se tiver média dos dois)
  if (sCasa?.escanteiosMedia && sFora?.escanteiosMedia) {
    const somaMedia = sCasa.escanteiosMedia + sFora.escanteiosMedia;
    const linha = Math.floor(somaMedia) - 0.5; // linha conservadora abaixo da média
    mercados.push({
      mercado: `+${linha.toFixed(1)} escanteios`,
      odd: 1.85,
      tipo: 'REAL',
      justificativa: `médias somadas ~${somaMedia.toFixed(1)}/jogo`,
    });
  }

  // GOL DE ARTILHEIRO (real se achou o artilheiro)
  const art = (sCasa?.artilheiro?.gols || 0) >= (sFora?.artilheiro?.gols || 0) ? sCasa?.artilheiro : sFora?.artilheiro;
  if (art && art.nome) {
    mercados.push({
      mercado: `Gol de ${art.nome}`,
      odd: 2.5,
      tipo: 'REAL',
      justificativa: `artilheiro do time (${art.gols || '?'} gols)`,
    });
  }

  // GOLS NO JOGO (real se tiver média de gols)
  if (sCasa?.golsMarcadosMedia && sFora?.golsMarcadosMedia) {
    const totalEsperado = sCasa.golsMarcadosMedia + sFora.golsMarcadosMedia;
    if (totalEsperado >= 2.5) {
      mercados.push({
        mercado: '+2.5 gols no jogo',
        odd: 1.9,
        tipo: 'REAL',
        justificativa: `média combinada ~${totalEsperado.toFixed(1)} gols`,
      });
    }
  }

  return mercados;
}

module.exports = { statsTime, mercadosAnalisados, buscarTimeId };
