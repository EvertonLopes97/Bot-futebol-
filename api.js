// api.js — HÍBRIDO. Segue os TIMES da Série A, não os campeonatos.
//
// FONTE 1 — football-data.org: Brasileirão Série A (BSA).
//   Grátis: 10 req/MINUTO. Folgado → ao vivo de 1 em 1 min.
//   Limitação: o plano free só cobre 12 ligas (BSA sim; Liberta/Copa BR/estaduais não).
//
// FONTE 2 — API-Football v3 (via RapidAPI): TODO o resto.
//   Libertadores, Copa do Brasil, Sul-Americana, estaduais, Mundial, amistosos.
//   Grátis: ~100 req/DIA. Por isso consultamos por DATA (1 req traz o dia inteiro
//   do mundo todo) e filtramos os nossos 20 clubes localmente.
//
// Sem sobreposição: BSA sempre vem da fonte 1; a fonte 2 nunca duplica (dedup por times+data).

const nodeFetch = require('node-fetch');
const fetchFn = (typeof globalThis.fetch === 'function') ? globalThis.fetch.bind(globalThis) : nodeFetch;
const times = require('./times.js');

// ── FONTE 1: football-data.org ──
const BASE = 'https://api.football-data.org/v4';
const KEY  = process.env.FOOTBALL_API_KEY;
const LIGA = process.env.COMPETICAO_LIGA || 'BSA'; // BSA = Brasileirão Série A. (WC = Copa do Mundo)
const headers = {
  'X-Auth-Token': KEY,
  'Accept': 'application/json',
  'Accept-Encoding': 'identity', // resposta SEM compressão (evita "Premature close")
};

// ── FONTE 2: API-Football ──
// Dois caminhos (o bot escolhe sozinho):
//   A) DIRETO em api-sports.io  → APIFOOTBALL_KEY  (recomendado: grátis, sem cartão, todos endpoints)
//      Registre em https://dashboard.api-football.com → header x-apisports-key
//   B) via RapidAPI            → RAPIDAPI_KEY      (precisa estar INSCRITO na API-Football lá)
const AF_DIRETO_KEY = process.env.APIFOOTBALL_KEY;              // caminho A
const AF_RAPID_KEY  = process.env.RAPIDAPI_KEY;                 // caminho B
const AF_RAPID_HOST = process.env.APIFOOTBALL_HOST || 'api-football-v1.p.rapidapi.com';
const AF_MODO = AF_DIRETO_KEY ? 'direto' : (AF_RAPID_KEY ? 'rapidapi' : 'off');
const AF_BASE = AF_DIRETO_KEY
  ? 'https://v3.football.api-sports.io'
  : `https://${AF_RAPID_HOST}/v3`;
const AF_HEADERS = AF_DIRETO_KEY
  ? { 'x-apisports-key': AF_DIRETO_KEY }
  : { 'x-rapidapi-key': AF_RAPID_KEY, 'x-rapidapi-host': AF_RAPID_HOST };

const AF_QUOTA_DIA = parseInt(process.env.AF_QUOTA_DIA || '90'); // margem sob os 100/dia
const AF_LIGADA = (process.env.AF_LIGADA || 'true') === 'true';

let afUsadas = 0;
let afDia = new Date().toISOString().split('T')[0];
let afPausaAte = 0; // pausa após 429

function afResetSeNovoDia() {
  const hoje = new Date().toISOString().split('T')[0];
  if (hoje !== afDia) { afDia = hoje; afUsadas = 0; }
}
function afPodeUsar() {
  afResetSeNovoDia();
  if (!AF_LIGADA || AF_MODO === 'off') return false;
  if (afPausaAte && Date.now() < afPausaAte) return false;
  return afUsadas < AF_QUOTA_DIA;
}
function afStatusQuota() {
  afResetSeNovoDia();
  return { usadas: afUsadas, quota: AF_QUOTA_DIA, restantes: AF_QUOTA_DIA - afUsadas, modo: AF_MODO, api: 'API-Football' };
}

// Converte uma data UTC pra AAAA-MM-DD no fuso de São Paulo (evita jogo de 21h virar "amanhã")
function dataISOSaoPaulo(utcDateStr) {
  return new Date(utcDateStr).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function horaSaoPaulo(utcDateStr) {
  return new Date(utcDateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}
function dataLocalBR(utcDateStr) {
  return new Date(utcDateStr).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function hojeISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// ── GET football-data (com retry — a API às vezes fecha a conexão no meio) ──
async function get(url, tentativa = 1) {
  const MAX = 3;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetchFn(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      if (res.status === 429) console.warn('[API-FD] rate limit (10/min) atingido.');
      else console.error(`[API-FD] HTTP ${res.status} em ${url}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    if (tentativa < MAX) {
      await new Promise(r => setTimeout(r, 800 * tentativa));
      return get(url, tentativa + 1);
    }
    console.error(`[API-FD] falhou após ${MAX} tentativas:`, e.message);
    return null;
  }
}

// ── GET API-Football (com controle de quota) ──
// Diagnóstico: mostra plano e cota REAL. Não consome a cota diária.
async function afDiagnostico() {
  if (AF_MODO === 'off') return { ok: false, erro: 'Sem chave (defina APIFOOTBALL_KEY ou RAPIDAPI_KEY).' };
  try {
    const res = await fetchFn(`${AF_BASE}/status`, { headers: AF_HEADERS });
    if (!res.ok) return { ok: false, modo: AF_MODO, http: res.status,
      erro: res.status === 403 ? 'SEM PERMISSÃO nessa API (não é cota)' : 'falhou' };
    const j = await res.json();
    const r = j.response || {};
    return { ok: true, modo: AF_MODO, plano: r.subscription?.plan, ativo: r.subscription?.active,
             usadas: r.requests?.current, limite: r.requests?.limit_day };
  } catch (e) { return { ok: false, modo: AF_MODO, erro: e.message }; }
}

async function getAF(path) {
  if (!afPodeUsar()) return null;
  try {
    afUsadas++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetchFn(`${AF_BASE}${path}`, { headers: AF_HEADERS, signal: controller.signal });
    clearTimeout(timeout);
    if (res.status === 403) {
      afPausaAte = Date.now() + 60 * 60 * 1000; // 403 é PERMISSÃO, não cota: insistir não adianta
      console.error('[API-AF] ❌ 403 = SEM PERMISSÃO (não é cota).' + (AF_MODO === 'rapidapi'
        ? ' Sua RAPIDAPI_KEY não está inscrita na API-Football. MAIS FÁCIL: registre grátis em dashboard.api-football.com e ponha a chave em APIFOOTBALL_KEY.'
        : ' Confira a APIFOOTBALL_KEY no dashboard.api-football.com.'));
      return null;
    }
    if (res.status === 429) {
      afPausaAte = Date.now() + 30 * 60 * 1000;
      console.warn('[API-AF] 429 — cota diária estourada. Pausando 30 min.');
      return null;
    }
    if (!res.ok) { console.error(`[API-AF] HTTP ${res.status} em ${path}`); return null; }
    const json = await res.json();
    if (json.errors && Object.keys(json.errors).length) {
      console.warn('[API-AF] erro da API:', JSON.stringify(json.errors).slice(0, 200));
      return null;
    }
    return json.response || [];
  } catch (e) {
    console.error('[API-AF] exceção:', e.message);
    return null;
  }
}

// ── Tradução de nomes (seleções + clubes) ──
const TIMES = {
  'Brazil': 'Brasil', 'Argentina': 'Argentina', 'France': 'França', 'Spain': 'Espanha',
  'Germany': 'Alemanha', 'England': 'Inglaterra', 'Portugal': 'Portugal', 'Italy': 'Itália',
  'Netherlands': 'Holanda', 'Belgium': 'Bélgica', 'Croatia': 'Croácia', 'Uruguay': 'Uruguai',
  'Colombia': 'Colômbia', 'Mexico': 'México', 'United States': 'Estados Unidos', 'Japan': 'Japão',
  'Morocco': 'Marrocos', 'Switzerland': 'Suíça', 'Egypt': 'Egito', 'Norway': 'Noruega',
  'Denmark': 'Dinamarca', 'Poland': 'Polônia', 'Serbia': 'Sérvia', 'Sweden': 'Suécia',
  'Ecuador': 'Equador', 'Peru': 'Peru', 'Chile': 'Chile', 'Paraguay': 'Paraguai',
  'Australia': 'Austrália', 'South Korea': 'Coreia do Sul', 'Saudi Arabia': 'Arábia Saudita',
  'Canada': 'Canadá', 'Senegal': 'Senegal', 'Ghana': 'Gana', 'Cameroon': 'Camarões',
  'Tunisia': 'Tunísia', 'Iran': 'Irã', 'Qatar': 'Catar', 'Wales': 'País de Gales',
  'Scotland': 'Escócia', 'Turkey': 'Turquia', 'Greece': 'Grécia', 'Austria': 'Áustria',
};
// Clube da Série A → nome canônico (Flamengo, Atlético-MG...). Senão, tradução de seleção. Senão, o nome cru.
function traduzTime(nome) {
  if (times.ehSerieA(nome)) return times.canonico(nome);
  return TIMES[nome] || nome;
}

// ── Normalização de status ──
// API-Football usa códigos curtos; convertemos pro padrão do football-data
// (que o resto do bot já entende).
const AF_STATUS = {
  TBD: 'SCHEDULED', NS: 'TIMED',
  '1H': 'IN_PLAY', '2H': 'IN_PLAY', ET: 'IN_PLAY', BT: 'IN_PLAY', P: 'IN_PLAY', LIVE: 'IN_PLAY',
  HT: 'PAUSED',
  FT: 'FINISHED', AET: 'FINISHED', PEN: 'FINISHED',
  SUSP: 'SUSPENDED', INT: 'SUSPENDED',
  PST: 'POSTPONED', CANC: 'CANCELLED', ABD: 'CANCELLED', AWD: 'FINISHED', WO: 'FINISHED',
};
function statusAF(short) { return AF_STATUS[short] || 'SCHEDULED'; }

// ── Mapeadores: cada fonte → o mesmo formato interno ──
function mapFD(m) {
  const pen = m.score?.penalties || {};
  const temPen = pen.home != null && pen.away != null;
  const regHome = m.score?.regularTime?.home ?? m.score?.fullTime?.home;
  const regAway = m.score?.regularTime?.away ?? m.score?.fullTime?.away;
  return {
    id: String(m.id),
    casa: traduzTime(m.homeTeam?.name),
    fora: traduzTime(m.awayTeam?.name),
    hora: horaSaoPaulo(m.utcDate),
    data: dataISOSaoPaulo(m.utcDate),
    dataLocal: dataLocalBR(m.utcDate),
    status: m.status,
    golsCasa: temPen ? regHome : (m.score?.fullTime?.home ?? null),
    golsFora: temPen ? regAway : (m.score?.fullTime?.away ?? null),
    penaltisCasa: temPen ? pen.home : null,
    penaltisFora: temPen ? pen.away : null,
    fase: m.stage || null,
    rodada: m.matchday ?? null, // nº da rodada do Brasileirão (1-38). Copa não tem.
    competicao: 'Brasileirão Série A',
    fonte: 'fd',
  };
}

function mapAF(f) {
  const pen = f.score?.penalty || {};
  const temPen = pen.home != null && pen.away != null;
  const utc = f.fixture?.date;
  return {
    id: 'af_' + f.fixture?.id, // prefixo: nunca colide com os IDs do football-data
    casa: traduzTime(f.teams?.home?.name),
    fora: traduzTime(f.teams?.away?.name),
    hora: horaSaoPaulo(utc),
    data: dataISOSaoPaulo(utc),
    dataLocal: dataLocalBR(utc),
    status: statusAF(f.fixture?.status?.short),
    golsCasa: temPen ? (f.score?.fulltime?.home ?? null) : (f.goals?.home ?? null),
    golsFora: temPen ? (f.score?.fulltime?.away ?? null) : (f.goals?.away ?? null),
    penaltisCasa: temPen ? pen.home : null,
    penaltisFora: temPen ? pen.away : null,
    minuto: f.fixture?.status?.elapsed || null,
    fase: f.league?.round || null,
    rodada: null, // copa/mata-mata não tem rodada de pontos corridos
    competicao: f.league?.name || 'Outra competição',
    fonte: 'af',
  };
}

// ── Dedup: se o mesmo confronto/data já veio do football-data, ignora o da API-Football ──
function chaveJogo(j) {
  return `${j.data}|${times.norm(j.casa)}|${times.norm(j.fora)}`;
}
function mesclar(listaFD, listaAF) {
  const vistos = new Set(listaFD.map(chaveJogo));
  const extras = listaAF.filter(j => !vistos.has(chaveJogo(j)));
  return [...listaFD, ...extras];
}

// ═══════════════ FUNÇÕES PÚBLICAS ═══════════════

// Jogos do dia: Brasileirão (FD) + qualquer outro jogo dos nossos clubes (AF)
async function jogosDoDia() {
  const ontem  = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const amanha = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const hojeLocal = dataLocalBR(new Date().toISOString());

  // FONTE 1 — Brasileirão
  const fd = await get(`${BASE}/competitions/${LIGA}/matches?dateFrom=${ontem}&dateTo=${amanha}`);
  let listaFD = (fd?.matches || []).map(mapFD);

  // FONTE 2 — 1 requisição traz o dia inteiro do mundo; filtramos nossos clubes
  let listaAF = [];
  const afHoje = await getAF(`/fixtures?date=${hojeISO()}`);
  if (afHoje) {
    listaAF = afHoje
      .filter(f => times.jogoInteressa(f.teams?.home?.name, f.teams?.away?.name))
      .map(mapAF);
  }

  const todos = mesclar(listaFD, listaAF);
  // Só os de hoje (fuso SP) ou que estão rolando agora
  return todos.filter(j =>
    j.dataLocal === hojeLocal ||
    j.status === 'IN_PLAY' || j.status === 'PAUSED'
  );
}

// Jogos ao vivo agora
async function jogosAoVivo() {
  // FONTE 1 — Brasileirão (a API recusa vírgula no status, então busca separado)
  const [d1, d2] = await Promise.all([
    get(`${BASE}/competitions/${LIGA}/matches?status=IN_PLAY`),
    get(`${BASE}/competitions/${LIGA}/matches?status=PAUSED`),
  ]);
  const listaFD = [...(d1?.matches || []), ...(d2?.matches || [])].map(m => ({
    ...mapFD(m),
    golsCasa: m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? 0,
    golsFora: m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? 0,
    minuto: m.minute || '?',
  }));

  // FONTE 2 — 1 requisição traz TODOS os jogos ao vivo do mundo; filtramos os nossos
  let listaAF = [];
  const afLive = await getAF('/fixtures?live=all');
  if (afLive) {
    listaAF = afLive
      .filter(f => times.jogoInteressa(f.teams?.home?.name, f.teams?.away?.name))
      .map(f => ({ ...mapAF(f), golsCasa: f.goals?.home ?? 0, golsFora: f.goals?.away ?? 0, minuto: f.fixture?.status?.elapsed || '?' }));
  }

  return mesclar(listaFD, listaAF);
}

// Próximos jogos (agendados) — usado pelo bolão de amanhã e pelo /proximos
async function proximosJogos() {
  // FONTE 1 — Brasileirão agendado
  const fd = await get(`${BASE}/competitions/${LIGA}/matches?status=SCHEDULED,TIMED`);
  const listaFD = (fd?.matches || []).slice(0, 30).map(mapFD);

  // FONTE 2 — próximos dias (1 req por dia consultado; 2 dias = 2 reqs)
  let listaAF = [];
  for (let d = 1; d <= 2; d++) {
    const dia = new Date(Date.now() + d * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const r = await getAF(`/fixtures?date=${dia}`);
    if (r) {
      listaAF.push(...r
        .filter(f => times.jogoInteressa(f.teams?.home?.name, f.teams?.away?.name))
        .map(mapAF)
        .filter(j => ['SCHEDULED', 'TIMED'].includes(j.status)));
    }
  }

  return mesclar(listaFD, listaAF).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
}

// Rodada ATUAL do Brasileirão, direto da API (fonte da verdade).
// Não dá pra inferir por "menor rodada em aberto": jogos ADIADOS de rodadas antigas
// ficam eternamente em aberto e envenenariam a conta.
async function rodadaAtualLiga() {
  const d = await get(`${BASE}/competitions/${LIGA}`);
  const r = d?.currentSeason?.currentMatchday;
  return (typeof r === 'number' && r > 0) ? r : null;
}

// Tabela do Brasileirão (football-data)
async function tabela() {
  const data = await get(`${BASE}/competitions/${LIGA}/standings`);
  if (!data || !data.standings) return [];
  return data.standings
    .filter(g => g.type === 'TOTAL')
    .map(grupo => ({
      grupo: grupo.group || 'Classificação',
      times: (grupo.table || []).map(t => ({
        pos: t.position,
        time: traduzTime(t.team.name),
        pts: t.points,
        j: t.playedGames,
        v: t.won,
        e: t.draw,
        d: t.lost,
        sg: t.goalDifference,
        gp: t.goalsFor,
      })),
    }));
}

// Artilheiros do Brasileirão (football-data)
async function artilheiros() {
  const data = await get(`${BASE}/competitions/${LIGA}/scorers?limit=10`);
  if (!data || !data.scorers) return [];
  return data.scorers.map((s, i) => ({
    pos: i + 1,
    nome: s.player.name,
    time: traduzTime(s.team.name),
    gols: s.goals || 0,
    assist: s.assists || 0,
  }));
}

module.exports = {
  jogosDoDia, jogosAoVivo, tabela, artilheiros, proximosJogos,
  traduzTime, dataISOSaoPaulo, afStatusQuota, afDiagnostico, rodadaAtualLiga, getAF, LIGA,
};
