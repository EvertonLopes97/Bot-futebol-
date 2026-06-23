// dicadodia.js — Comparador de odds + dica do dia (recreativo, +18)
// Usa OddsPapi (grátis, 350+ casas) pra odds. Compara casas e monta múltipla honesta.
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const CACHE = path.join(DIR, 'odds_cache.json');

const ODDSPAPI_KEY = process.env.ODDSPAPI_KEY;
const ODDSPAPI_BASE = 'https://api.oddspapi.io';

// ── cache (respeita o cooldown da API) ──
function getCache(chave, ttlMin) {
  try {
    const c = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE,'utf8')) : {};
    const it = c[chave];
    if (it && (Date.now()-it.ts) < ttlMin*60*1000) return it.dados;
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

function probImplicita(odd) { return odd>0 ? 1/odd : 0; }

// Busca jogos com odds do dia. Retorna lista normalizada.
// OBS: o endpoint exato pode variar conforme o painel da OddsPapi — ajustável via env.
async function buscarOddsDoDia() {
  const cacheado = getCache('odds_dia', 60); // 1h de cache
  if (cacheado) return cacheado;
  if (!ODDSPAPI_KEY) { console.error('[DICA] ODDSPAPI_KEY ausente'); return []; }
  try {
    // sportId 10 = futebol na OddsPapi (confirme no painel). Pega eventos do dia.
    const url = `${ODDSPAPI_BASE}/v4/events?apiKey=${ODDSPAPI_KEY}&sport=football`;
    const res = await fetch(url);
    if (!res.ok) { console.error('[DICA] OddsPapi status', res.status); return []; }
    const j = await res.json();
    const eventos = j.events || j.data || j || [];
    const jogos = (Array.isArray(eventos) ? eventos : []).slice(0, 40).map(normalizarEvento).filter(Boolean);
    setCache('odds_dia', jogos);
    return jogos;
  } catch (e) { console.error('[DICA]', e.message); return []; }
}

// Normaliza um evento (tolerante a variações de formato)
function normalizarEvento(ev) {
  try {
    const casa = ev.home_team || ev.homeTeam || ev.home || '?';
    const fora = ev.away_team || ev.awayTeam || ev.away || '?';
    const bookmakers = ev.bookmakers || ev.bookmakerOdds || [];
    // monta melhor odd por resultado (1 / X / 2)
    const melhor = { casa: { odd: 0, book: '' }, empate: { odd: 0, book: '' }, fora: { odd: 0, book: '' } };
    for (const bk of bookmakers) {
      const nome = bk.title || bk.key || bk.name || 'casa';
      const mkts = bk.markets || [];
      const h2h = mkts.find(m => (m.key||m.market) === 'h2h' || (m.key||'').includes('1x2'));
      if (!h2h) continue;
      for (const o of (h2h.outcomes||[])) {
        const preco = o.price || o.odd || 0;
        if (o.name === casa && preco > melhor.casa.odd) melhor.casa = { odd: preco, book: nome };
        else if (o.name === fora && preco > melhor.fora.odd) melhor.fora = { odd: preco, book: nome };
        else if ((o.name||'').toLowerCase().includes('draw') && preco > melhor.empate.odd) melhor.empate = { odd: preco, book: nome };
      }
    }
    return { casa, fora, melhor };
  } catch { return null; }
}

// ── Popularidade: times grandes e jogos de maior repercussão pesam mais ──
const TIMES_POPULARES = {
  'Brazil':10,'Brasil':10,'Argentina':10,'France':9,'França':9,'England':9,'Inglaterra':9,
  'Spain':8,'Espanha':8,'Portugal':9,'Germany':8,'Alemanha':8,'Netherlands':7,'Holanda':7,
  'Italy':7,'Itália':7,'Uruguay':6,'Uruguai':6,'Colombia':6,'Colômbia':6,'Mexico':6,'México':6,
  'Belgium':6,'Bélgica':6,'Croatia':6,'Croácia':6,'United States':6,'Estados Unidos':6,
  'Japan':5,'Japão':5,'South Korea':5,'Coreia do Sul':5,'Morocco':6,'Marrocos':6,
};
function popTime(nome){ return TIMES_POPULARES[nome] || 3; }

// Score de relevância do jogo: soma da fama dos dois times + bônus se for equilibrado
function relevanciaJogo(j) {
  const p1 = popTime(j.casa), p2 = popTime(j.fora);
  const fama = p1 + p2;
  // jogo equilibrado entre dois grandes vale mais (mais hype)
  const equilibrio = (p1 >= 7 && p2 >= 7) ? 5 : 0;
  return fama + equilibrio;
}

// Dicas do dia: 5 a 10 jogos ordenados por RELEVÂNCIA (popularidade), com destaque pros 3 primeiros
function dicasDoDia(jogos) {
  const comScore = jogos
    .map(j => ({ ...j, score: relevanciaJogo(j) }))
    .filter(j => j.melhor.casa.odd > 0 || j.melhor.fora.odd > 0)
    .sort((a,b) => b.score - a.score);
  const lista = comScore.slice(0, 10);
  return {
    destaques: lista.slice(0, 3),
    outras: lista.slice(3, 10),
  };
}

// Múltipla "dos sonhos": combina mercados de craques/eventos das partidas mais populares
// (resultado + escanteios + chute no gol + gol de craque). Odd alta de propósito.
function multiplaDosSonhos(jogos, mercadosCraques) {
  const top = jogos
    .map(j => ({ ...j, score: relevanciaJogo(j) }))
    .sort((a,b)=>b.score-a.score)
    .slice(0, 4);
  if (!top.length) return null;
  const pernas = [];
  let combinada = 1;
  // resultado do jogo mais popular (favorito por popularidade, não por odd)
  top.forEach((j, i) => {
    const fav = j.melhor.casa.odd <= (j.melhor.fora.odd || 99)
      ? { time: j.casa, odd: j.melhor.casa.odd, book: j.melhor.casa.book }
      : { time: j.fora, odd: j.melhor.fora.odd, book: j.melhor.fora.book };
    if (fav.odd > 0) {
      pernas.push({ mercado: `${fav.time} vence`, odd: fav.odd, book: fav.book });
      combinada *= fav.odd;
    }
  });
  // adiciona mercados "de craque" (vêm prontos/estimados, odds ilustrativas)
  for (const m of (mercadosCraques || [])) {
    pernas.push(m);
    combinada *= m.odd;
  }
  const probReal = pernas.reduce((a,p)=>a*(p.odd>0?1/p.odd:0),1);
  return {
    pernas,
    combinada: combinada.toFixed(2),
    probRealPct: (probReal*100).toFixed(2),
    chance: probReal>0 ? `1 em ${Math.round(1/probReal).toLocaleString('pt-BR')}` : '—',
  };
}

module.exports = { buscarOddsDoDia, dicasDoDia, multiplaDosSonhos, relevanciaJogo };
