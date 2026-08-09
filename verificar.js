// =====================================================================
// verificar.js — Confere fatos na API antes de você gravar
//
// PROBLEMA QUE RESOLVE:
//   Notícia de portal erra, atrasa e se contradiz. Se você grava "fulano
//   foi do Galo pro Flu" e está errado, o comentário te corrige em 2
//   minutos. Este módulo consulta a API-Football (dado estruturado, não
//   texto de matéria) e confirma:
//     - em que clube o jogador está HOJE
//     - o histórico de transferências dele
//     - o elenco atual de um clube
//
// USA a APIFOOTBALL_KEY que o bot já tem.
//
// ⚠️ LIMITE DO PLANO FREE: a API-Football gratuita tem cota diária e a
//   janela de datas é curta pra jogos — MAS transferências e elencos não
//   dependem de data, então funcionam normal. Cada consulta gasta 1 da
//   cota; o módulo tem cache de 24h pra não desperdiçar.
// =====================================================================

const fs = require('fs');
const path = require('path');

const AF_BASE = 'https://v3.football.api-sports.io';
const DIR = process.env.DATA_DIR || __dirname;
const CACHE = path.join(DIR, '.verificar-cache.json');
const CACHE_HORAS = 24;

// ── Cache simples (a cota é preciosa) ─────────────────────────────────
function lerCache() {
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; }
}
function salvarCache(c) {
  try { fs.writeFileSync(CACHE, JSON.stringify(c)); } catch {}
}
function doCache(chave) {
  const c = lerCache();
  const item = c[chave];
  if (!item) return null;
  if (Date.now() - item.em > CACHE_HORAS * 3600000) return null;
  return item.dado;
}
function porCache(chave, dado) {
  const c = lerCache();
  c[chave] = { dado, em: Date.now() };
  salvarCache(c);
}

async function af(caminho) {
  const chave = process.env.APIFOOTBALL_KEY;
  if (!chave) return { erro: 'APIFOOTBALL_KEY não configurada' };

  const cacheKey = caminho;
  const emCache = doCache(cacheKey);
  if (emCache) return emCache;

  try {
    const r = await fetch(`${AF_BASE}${caminho}`, {
      headers: { 'x-apisports-key': chave },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { erro: `HTTP ${r.status}` };
    const j = await r.json();
    if (j.errors && Object.keys(j.errors).length) {
      return { erro: JSON.stringify(j.errors) };
    }
    const resultado = j.response || [];
    porCache(cacheKey, resultado);
    return resultado;
  } catch (e) {
    return { erro: e.message };
  }
}

// ── Acha o jogador pelo nome ──────────────────────────────────────────
async function acharJogador(nome) {
  const busca = String(nome || '').trim();
  if (busca.length < 3) return { erro: 'Nome muito curto (mínimo 3 letras).' };

  const r = await af(`/players/profiles?search=${encodeURIComponent(busca)}`);
  if (r.erro) return r;
  if (!r.length) return { erro: `Não achei jogador com o nome "${busca}".` };

  return r.slice(0, 5).map(x => ({
    id: x.player?.id,
    nome: x.player?.name,
    nomeCompleto: [x.player?.firstname, x.player?.lastname].filter(Boolean).join(' '),
    idade: x.player?.age,
    nacionalidade: x.player?.nationality,
    posicao: x.player?.position,
    foto: x.player?.photo,
  }));
}

// ── Onde o jogador está HOJE ──────────────────────────────────────────
async function clubeAtual(playerId) {
  const temporada = parseInt(process.env.AF_SEASON || new Date().getFullYear());
  const r = await af(`/players?id=${playerId}&season=${temporada}`);
  if (r.erro) return r;
  if (!r.length) return { erro: 'Sem dados desse jogador na temporada.' };

  const p = r[0];
  const times = (p.statistics || [])
    .map(s => ({
      clube: s.team?.name,
      liga: s.league?.name,
      pais: s.league?.country,
      jogos: s.games?.appearences || 0,
      gols: s.goals?.total || 0,
    }))
    .filter(t => t.clube);

  return {
    nome: p.player?.name,
    idade: p.player?.age,
    temporada,
    times,
    // o clube com mais jogos na temporada é o "atual" mais provável
    principal: times.sort((a, b) => b.jogos - a.jogos)[0] || null,
  };
}

// ── Histórico de transferências ───────────────────────────────────────
async function transferencias(playerId) {
  const r = await af(`/transfers?player=${playerId}`);
  if (r.erro) return r;
  if (!r.length) return { erro: 'Sem histórico de transferência registrado.' };

  const lista = (r[0].transfers || []).map(t => ({
    data: t.date,
    de: t.teams?.out?.name,
    para: t.teams?.in?.name,
    tipo: t.type,   // "Free", "Loan", valor...
  }));

  return { jogador: r[0].player?.name, transferencias: lista.reverse() };
}

// ── Elenco atual de um clube ──────────────────────────────────────────
async function elenco(nomeClube) {
  const busca = String(nomeClube || '').trim();
  const t = await af(`/teams?search=${encodeURIComponent(busca)}`);
  if (t.erro) return t;
  if (!t.length) return { erro: `Não achei o clube "${busca}".` };

  // prioriza time brasileiro quando houver ambiguidade (Santos, etc.)
  const escolhido = t.find(x => /brazil|brasil/i.test(x.team?.country || '')) || t[0];
  const id = escolhido.team?.id;

  const r = await af(`/players/squads?team=${id}`);
  if (r.erro) return r;
  if (!r.length) return { erro: 'Elenco não disponível.' };

  return {
    clube: r[0].team?.name,
    pais: escolhido.team?.country,
    jogadores: (r[0].players || []).map(p => ({
      id: p.id, nome: p.name, idade: p.age, posicao: p.position, numero: p.number,
    })),
  };
}

// ── A pergunta que importa: "fulano está no clube X?" ─────────────────
async function confirmarJogadorNoClube(nomeJogador, nomeClube) {
  const el = await elenco(nomeClube);
  if (el.erro) return el;

  const norm = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  const alvo = norm(nomeJogador);
  const achado = el.jogadores.find(p => {
    const n = norm(p.nome);
    return n === alvo || n.includes(alvo) || alvo.includes(n);
  });

  return {
    clube: el.clube,
    pais: el.pais,
    encontrado: Boolean(achado),
    jogador: achado || null,
    totalElenco: el.jogadores.length,
  };
}

module.exports = {
  acharJogador, clubeAtual, transferencias, elenco, confirmarJogadorNoClube,
};
