// Referências injetadas pelo index.js (EmbedBuilder e aviso)
let EmbedBuilderRef = null;
let AVISO_REF = '+18 | Conteúdo recreativo, não é recomendação de aposta. Jogue com responsabilidade.';
function setRefs(EmbedBuilder, aviso) { EmbedBuilderRef = EmbedBuilder; if (aviso) AVISO_REF = aviso; }

// dicadodia.js — Comparador de odds + dica do dia (recreativo, +18)
// Usa OddsPapi (grátis, 350+ casas) pra odds. Compara casas e monta múltipla honesta.
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const CACHE = path.join(DIR, 'odds_cache.json');

const ODDSPAPI_KEY = process.env.ODDSPAPI_KEY;
const ODDSPAPI_BASE = 'https://api.oddspapi.io';
// ── Orçamento diário de cota (250/mês ÷ dias do mês = req/dia) ──
const COTA_MENSAL = parseInt(process.env.ODDSPAPI_COTA_MES || '250');
function diasNoMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function orcamentoDiario() {
  return Math.max(2, Math.floor(COTA_MENSAL / diasNoMes())); // mínimo 2
}
// quantos jogos buscar por entrega (metade do orçamento, pois são 2 entregas/dia)
function jogosPorEntrega() {
  return Math.max(1, Math.floor(orcamentoDiario() / 2));
}

// Filtro Copa do Mundo: tournamentId da Copa na OddsPapi (configurável)
const COPA_TOURNAMENT_IDS = (process.env.ODDSPAPI_COPA_IDS || '').split(',').map(s=>s.trim()).filter(Boolean);
const SO_COPA = (process.env.SO_COPA || 'true') === 'true';


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
  const cacheado = getCache('odds_dia', 180);
  if (cacheado) return cacheado;
  if (!ODDSPAPI_KEY) { console.error('[ODDS] ODDSPAPI_KEY ausente'); return []; }

  try {
    // Formato EXATO da doc: from/to em ISO 8601, máximo 10 dias, hasOdds=true
    const agora = new Date();
    const from = agora.toISOString().split('.')[0] + 'Z';
    const to = new Date(agora.getTime() + 2*86400000).toISOString().split('.')[0] + 'Z';
    const urlFix = `${ODDSPAPI_BASE}/v4/fixtures?apiKey=${ODDSPAPI_KEY}&sportId=10&from=${from}&to=${to}&hasOdds=true`;
    const resFix = await fetch(urlFix);
    if (!resFix.ok) { console.error('[ODDS] fixtures status', resFix.status); return []; }
    let fixtures = await resFix.json();
    if (!Array.isArray(fixtures)) { console.log('[ODDS] resposta inesperada'); return []; }
    console.log(`[ODDS] ${fixtures.length} jogos com odds encontrados`);

    // Filtro Copa do Mundo (tolerante): por nome do torneio OU tournamentId configurado
    if (SO_COPA) {
      const copaFiltro = fixtures.filter(f =>
        /world cup|copa do mundo|fifa|mundial/i.test(f.tournamentName || '') ||
        (COPA_TOURNAMENT_IDS.length && COPA_TOURNAMENT_IDS.includes(String(f.tournamentId)))
      );
      // se o filtro achou jogos da Copa, usa; senão, usa todos (pra não ficar vazio)
      if (copaFiltro.length) { fixtures = copaFiltro; console.log(`[ODDS] ${fixtures.length} são da Copa`); }
      else console.log('[ODDS] nenhum jogo da Copa identificado, mostrando todos disponíveis');
    }

    fixtures = fixtures.slice(0, jogosPorEntrega());
    if (!fixtures.length) { console.log('[ODDS] nenhum jogo após filtro'); return []; }

    const jogos = [];
    for (const f of fixtures) {
      try {
        const urlOdds = `${ODDSPAPI_BASE}/v4/odds?apiKey=${ODDSPAPI_KEY}&fixtureId=${f.fixtureId}`;
        const resOdds = await fetch(urlOdds);
        if (!resOdds.ok) { console.log('[ODDS] odds status', resOdds.status, 'p/', f.fixtureId); continue; }
        const oddsData = await resOdds.json();
        const jogo = extrairMelhorOdd(f, oddsData);
        if (jogo) jogos.push(jogo);
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) { console.log('[ODDS] erro jogo:', e.message); }
    }

    if (jogos.length) { console.log(`[ODDS] ✅ ${jogos.length} jogos prontos`); setCache('odds_dia', jogos); }
    else console.log('[ODDS] nenhuma odd extraída');
    return jogos;
  } catch (e) { console.error('[ODDS]', e.message); return []; }
}

// Extrai a melhor odd (1/X/2) entre todas as casas pra um jogo
function extrairMelhorOdd(fixture, oddsData) {
  try {
    const casa = fixture.participant1Name || oddsData.participant1Name || 'Casa';
    const fora = fixture.participant2Name || oddsData.participant2Name || 'Fora';
    const melhor = { casa: { odd: 0, book: '' }, empate: { odd: 0, book: '' }, fora: { odd: 0, book: '' } };
    const books = oddsData.bookmakerOdds || {};

    for (const [bookSlug, bookData] of Object.entries(books)) {
      const markets = (bookData && bookData.markets) || {};
      const m101 = markets['101']; // 101 = Full Time Result (1X2)
      if (!m101 || !m101.outcomes) continue;
      const oc = m101.outcomes;
      // outcome 101=home, 102=draw, 103=away
      const preco = (id) => {
        try { return oc[id].players['0'].price || 0; } catch { return 0; }
      };
      const ph = preco('101'), pd = preco('102'), pa = preco('103');
      if (ph > melhor.casa.odd) melhor.casa = { odd: ph, book: bookSlug };
      if (pd > melhor.empate.odd) melhor.empate = { odd: pd, book: bookSlug };
      if (pa > melhor.fora.odd) melhor.fora = { odd: pa, book: bookSlug };
    }
    if (!melhor.casa.odd && !melhor.fora.odd) return null;
    return { casa, fora, melhor };
  } catch { return null; }
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

// Monta 3 múltiplas prontas: Segura, Equilibrada e Dos Sonhos
async function montarMultiplasProntas(jogos, estatisticas) {
  const ordenados = jogos
    .map(j => ({ ...j, score: relevanciaJogo(j) }))
    .filter(j => j.melhor.casa.odd > 0 || j.melhor.fora.odd > 0)
    .sort((a,b) => b.score - a.score);

  if (!ordenados.length) return [];

  function favorito(j) {
    return (j.melhor.casa.odd && j.melhor.casa.odd <= (j.melhor.fora.odd || 99))
      ? { time: j.casa, odd: j.melhor.casa.odd, book: j.melhor.casa.book, jogo: `${j.casa} x ${j.fora}` }
      : { time: j.fora, odd: j.melhor.fora.odd, book: j.melhor.fora.book, jogo: `${j.casa} x ${j.fora}` };
  }

  function montar(titulo, cor, candidatos, alvoMin, alvoMax, extras) {
    const pernas = [];
    let comb = 1;
    for (const c of candidatos) {
      if (comb >= alvoMax) break;
      pernas.push({ txt: `${c.time} vence (${c.jogo})`, odd: c.odd, book: c.book });
      comb *= c.odd;
      if (comb >= alvoMin && pernas.length >= 2) break;
    }
    for (const e of (extras || [])) { pernas.push(e); comb *= e.odd; }
    if (pernas.length < 2) return null;
    const prob = pernas.reduce((a,p)=>a*(p.odd>0?1/p.odd:0),1);
    const linhas = pernas.map(p => {
      const tag = p.tipo === 'REAL' ? ' 📊' : (p.tipo === 'ESTIMATIVA' ? ' ~' : '');
      const just = p.justificativa ? ` _(${p.justificativa})_` : '';
      return `• ${p.txt}${tag} — odd ${p.odd.toFixed(2)}${p.book?` (${p.book})`:''}${just}`;
    }).join('\n');
    return new EmbedBuilderRef()
      .setColor(cor)
      .setTitle(titulo)
      .setDescription(linhas)
      .addFields(
        { name: 'Odd combinada', value: `${comb.toFixed(2)}x`, inline: true },
        { name: 'Chance real', value: `${(prob*100).toFixed(1)}% (1 em ${Math.round(1/prob)})`, inline: true },
      )
      .setFooter({ text: '📊 = baseado em estatística real | ~ = estimativa. ' + AVISO_REF });
  }

  const favs = ordenados.map(favorito).filter(f => f.odd >= 1.3 && f.odd <= 2.5);

  const embeds = [];
  const segura = montar('🟢 Múltipla Segura', 0x1D9E75, favs, 2.5, 4);
  if (segura) embeds.push(segura);
  const equil = montar('🟡 Múltipla Equilibrada', 0xEF9F27, favs, 6, 12);
  if (equil) embeds.push(equil);

  // DOS SONHOS: análise estatística REAL dos 3 jogos em destaque
  let mercadosCraque = [];
  if (estatisticas && estatisticas.mercadosAnalisados) {
    const destaques = ordenados.slice(0, 3);
    for (const j of destaques) {
      try {
        const m = await estatisticas.mercadosAnalisados(j.casa, j.fora);
        // pega o melhor mercado analisado de cada jogo (máx 1 por jogo p/ economizar)
        if (m && m.length) {
          mercadosCraque.push({ txt: `${m[0].mercado} (${j.casa} x ${j.fora})`, odd: m[0].odd, book: 'análise', tipo: m[0].tipo, justificativa: m[0].justificativa });
        }
      } catch (e) { console.log('[ANALISE]', e.message); }
    }
  }
  // se a análise não trouxe nada, cai pros estimados (marcados como tal)
  if (!mercadosCraque.length) {
    mercadosCraque = [
      { txt: '+9.5 escanteios no jogo do favorito', odd: 2.4, book: 'estimado', tipo: 'ESTIMATIVA' },
      { txt: 'Gol de artilheiro', odd: 2.2, book: 'estimado', tipo: 'ESTIMATIVA' },
    ];
  }
  const sonhos = montar('🌟 Múltipla DOS SONHOS', 0xFF2E63, favs, 4, 6, mercadosCraque);
  if (sonhos) embeds.push(sonhos);

  return embeds;
}

module.exports = { buscarOddsDoDia, dicasDoDia, multiplaDosSonhos, relevanciaJogo, montarMultiplasProntas, setRefs };
