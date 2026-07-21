// popular-jogadores.js — puxa elencos + FOTOS dos 20 clubes da Série A e grava no Supabase.
// Alimenta o Jogo da Memória "Ache o Jogador" no site.
//
// DUAS FONTES em cascata (usa o que estiver disponível):
//   1) API-Football (/players/squads) — elenco + foto. Melhor fonte.
//   2) Sofascore (RapidAPI) — fallback se a API-Football falhar (403/cota).
// Ambas trazem foto_url. Se as duas falharem pra um time, ele fica sem cartas até a próxima.
//
// Roda: comando /popularjogadores (staff) OU automático 1x por semana (agendado no index.js).

const api = require('./api.js');
const armaz = require('./armazenamento.js');
const times = require('./times.js');

const LEAGUE_AF = parseInt(process.env.AF_LEAGUE_BR || '71');
const SEASON_AF = parseInt(process.env.AF_SEASON || new Date().getFullYear());
const RAPID_KEY = process.env.RAPIDAPI_KEY;
const RAPID_HOST = process.env.SOFASCORE_HOST || 'sofascore.p.rapidapi.com';
const nodeFetch = require('node-fetch');
const fetchFn = (typeof globalThis.fetch === 'function') ? globalThis.fetch.bind(globalThis) : nodeFetch;

// ── Fonte 1: API-Football ──
async function elencoAF(teamId) {
  const squad = await api.getAF(`/players/squads?team=${teamId}`);
  const players = squad?.[0]?.players || [];
  return players.map(p => ({ nome: p.name, posicao: p.position || null, foto_url: p.photo || null, numero: p.number || null }));
}
async function timesAF() {
  const teams = await api.getAF(`/teams?league=${LEAGUE_AF}&season=${SEASON_AF}`);
  if (!teams) return null;
  return teams.filter(t => times.ehSerieA(t.team?.name)).map(t => ({ id: t.team.id, nome: times.canonico(t.team.name) }));
}

// ── Fonte 2: Sofascore (RapidAPI) ──
async function rapidGet(endpoint) {
  if (!RAPID_KEY) return null;
  try {
    const res = await fetchFn(`https://${RAPID_HOST}${endpoint}`, { headers: { 'x-rapidapi-key': RAPID_KEY, 'x-rapidapi-host': RAPID_HOST } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function sofaTimeId(nome) {
  const j = await rapidGet(`/v1/search/multi?query=${encodeURIComponent(nome)}&type=teams`) || await rapidGet(`/search?q=${encodeURIComponent(nome)}`);
  const results = j?.results || j?.teams || j?.data || [];
  const time = (Array.isArray(results) ? results : []).find(r => (r.entity?.name || r.name || '').length > 0);
  return time?.entity?.id || time?.id || null;
}
async function elencoSofa(nomeClube) {
  const id = await sofaTimeId(nomeClube);
  if (!id) return [];
  const j = await rapidGet(`/v1/teams/get-squad?teamId=${id}`) || await rapidGet(`/teams/${id}/players`);
  const players = j?.players || j?.squad || j?.data || [];
  return (Array.isArray(players) ? players : []).map(p => {
    const pl = p.player || p;
    const pid = pl.id;
    return {
      nome: pl.name || pl.shortName,
      posicao: pl.position || null,
      foto_url: pid ? `https://api.sofascore.app/api/v1/player/${pid}/image` : null,
      numero: pl.jerseyNumber || null,
    };
  }).filter(p => p.nome);
}

async function popularJogadores(log = console.log) {
  const sb = armaz.supabaseClient ? armaz.supabaseClient() : null;
  if (!sb) { log('[JOGADORES] Supabase indisponivel.'); return { ok: false, erro: 'sem supabase' }; }

  let clubes = await timesAF();
  let fonteTimes = 'API-Football';
  if (!clubes || !clubes.length) {
    log('[JOGADORES] API-Football indisponivel pra listar times - usando lista fixa + Sofascore.');
    clubes = times.NOMES.map(n => ({ id: null, nome: n }));
    fonteTimes = 'Sofascore';
  }
  log(`[JOGADORES] ${clubes.length} clubes (via ${fonteTimes}).`);

  const linhas = [];
  const semElenco = [];
  for (const clube of clubes) {
    let elenco = [];
    let fonte = '';
    if (clube.id) { elenco = await elencoAF(clube.id); if (elenco.length) fonte = 'AF'; }
    if (!elenco.length) { elenco = await elencoSofa(clube.nome); if (elenco.length) fonte = 'Sofa'; }

    if (!elenco.length) { semElenco.push(clube.nome); log(`[JOGADORES]   ${clube.nome}: sem elenco em nenhuma fonte`); continue; }
    for (const p of elenco) {
      if (!p.nome) continue;
      linhas.push({ clube: clube.nome, api_team_id: clube.id, nome: p.nome, posicao: p.posicao, foto_url: p.foto_url, numero: p.numero });
    }
    const comFoto = elenco.filter(p => p.foto_url).length;
    log(`[JOGADORES]   ${clube.nome}: ${elenco.length} jogadores (${comFoto} c/ foto) via ${fonte}`);
    await new Promise(r => setTimeout(r, 300));
  }

  if (!linhas.length) { log('[JOGADORES] nenhum jogador coletado (confira APIFOOTBALL_KEY e RAPIDAPI_KEY).'); return { ok: false, erro: 'vazio' }; }

  await sb.from('jogadores_cartas').delete().neq('id', 0);
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await sb.from('jogadores_cartas').insert(linhas.slice(i, i + 500));
    if (error) { log('[JOGADORES] insert:', error.message); return { ok: false, erro: error.message }; }
  }

  const comFoto = linhas.filter(l => l.foto_url).length;
  log(`[JOGADORES] OK ${linhas.length} jogadores gravados (${comFoto} com foto). Sem elenco: ${semElenco.join(', ') || 'nenhum'}`);
  return { ok: true, jogadores: linhas.length, comFoto, semElenco };
}

module.exports = { popularJogadores };
