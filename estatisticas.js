// estatisticas.js — Estatísticas via Sofascore (RapidAPI), uso oportunista
// Busca escanteios/cartões médios. Se não tiver dado, retorna null (sem quebrar).
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

// Busca estatísticas de um time pelo sofascoreId (vem do externalProviders da OddsPapi)
// Retorna { escanteiosMedia, cartoesMedia } ou null
async function statsTime(sofascoreId) {
  if (!RAPID_KEY || !sofascoreId) return null;
  const chave = `time_${sofascoreId}`;
  const cacheado = getCache(chave, 24); // 24h de cache
  if (cacheado) return cacheado;

  try {
    const url = `https://${RAPID_HOST}/teams/get-statistics?teamId=${sofascoreId}`;
    const res = await fetch(url, { headers: { 'x-rapidapi-key': RAPID_KEY, 'x-rapidapi-host': RAPID_HOST } });
    if (!res.ok) { console.log('[STATS] sofascore status', res.status); return null; }
    const j = await res.json();
    const s = j.statistics || j.stats || j;
    if (!s) return null;
    const dados = {
      escanteiosMedia: parseFloat(s.cornersPerGame || s.corners || 0) || null,
      cartoesMedia: parseFloat(s.yellowCardsPerGame || s.cards || 0) || null,
    };
    setCache(chave, dados);
    return dados;
  } catch (e) { console.log('[STATS]', e.message); return null; }
}

// Monta sugestões de mercado baseadas em estatística (oportunista)
// Retorna array de { mercado, odd, justificativa } — vazio se sem dados
async function mercadosEstatisticos(fixture) {
  const ext = fixture.externalProviders || {};
  const id1 = ext.sofascoreId || fixture.participant1SofascoreId;
  if (!id1) return [];

  const stats = await statsTime(id1);
  if (!stats) return [];

  const sugestoes = [];
  if (stats.escanteiosMedia && stats.escanteiosMedia > 5) {
    const linha = Math.floor(stats.escanteiosMedia + stats.escanteiosMedia) - 0.5; // linha do jogo (soma dos dois ~)
    sugestoes.push({
      mercado: `+${linha.toFixed(1)} escanteios`,
      odd: 1.85, // odd ilustrativa quando não vem da casa
      justificativa: `média ~${stats.escanteiosMedia.toFixed(1)}/jogo`,
    });
  }
  if (stats.cartoesMedia && stats.cartoesMedia > 1.5) {
    sugestoes.push({
      mercado: `+3.5 cartões`,
      odd: 2.0,
      justificativa: `média ~${stats.cartoesMedia.toFixed(1)} cartões/jogo`,
    });
  }
  return sugestoes;
}

module.exports = { statsTime, mercadosEstatisticos };
