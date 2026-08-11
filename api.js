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
//
// ─────────────────────────────────────────────────────────────────────────────
// CORREÇÃO 22/07 — a cota da API-Football estava sendo torrada antes da hora.
// Quatro causas, quatro consertos, todos na FONTE 2:
//
//   1. SEM CACHE. Cada ciclo do monitor refazia as mesmas chamadas. Agora há
//      cache por caminho, com validade curta pro ao vivo e longa pro que não muda.
//   2. LIMITE DIÁRIO vinha como HTTP 200 (dentro de json.errors.requests), então
//      a pausa de 429 NUNCA disparava e o bot seguia martelando a API já esgotada
//      — daí a enxurrada de erros idênticos no log. Agora esse caso pausa até o
//      reset (00:00 UTC).
//   3. CONTADOR resetava a cada `pm2 restart` (você tinha 7 restarts), dando
//      "cota nova" fantasma enquanto a cota REAL na API seguia contando. Agora o
//      contador é gravado em disco e sobrevive a restart.
//   4. DATA FORA DA JANELA. O plano free só serve de ontem a amanhã. O código
//      pedia depois de amanhã (proximosJogos, d=2) e levava erro {"plan":...},
//      gastando requisição à toa. Agora há uma guarda que nem tenta datas fora
//      da janela do plano.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const pathmod = require('path');

// Node 18+ já tem fetch global; node-fetch vira opcional (não quebra se sumir).
let nodeFetch = null;
try { nodeFetch = require('node-fetch'); } catch { /* usa o fetch global */ }
const fetchFn = (typeof globalThis.fetch === 'function') ? globalThis.fetch.bind(globalThis) : nodeFetch;

const times = require('./times.js');

// ── FONTE 1: football-data.org ──
const BASE = 'https://api.football-data.org/v4';
const KEY  = process.env.FOOTBALL_API_KEY;
const LIGA = process.env.COMPETICAO_LIGA || 'BSA'; // BSA = Brasileirão Série A. (WC = Copa do Mundo)

// Competições extras buscadas junto com a principal (mesma API football-data).
// CLI = Copa Libertadores. Configurável: LIGAS_EXTRAS=CLI,OUTRA
// Vazio no .env desliga. Copa do Brasil NÃO existe na football-data —
// ela só vem pela API-Football (janela de 3 dias no plano grátis).
const LIGAS_EXTRAS = (process.env.LIGAS_EXTRAS ?? 'CLI')
  .split(',').map(s => s.trim()).filter(Boolean);
const headers = {
  'X-Auth-Token': KEY,
  'Accept': 'application/json',
  'Accept-Encoding': 'identity', // resposta SEM compressão (evita "Premature close")
};

// ── FONTE 2: API-Football ──
const AF_DIRETO_KEY = process.env.APIFOOTBALL_KEY;              // caminho A (direto, recomendado)
const AF_RAPID_KEY  = process.env.RAPIDAPI_KEY;                 // caminho B (via RapidAPI)
const AF_RAPID_HOST = process.env.APIFOOTBALL_HOST || 'api-football-v1.p.rapidapi.com';
const AF_MODO = AF_DIRETO_KEY ? 'direto' : (AF_RAPID_KEY ? 'rapidapi' : 'off');
const AF_BASE = AF_DIRETO_KEY
  ? 'https://v3.football.api-sports.io'
  : `https://${AF_RAPID_HOST}/v3`;
const AF_HEADERS = AF_DIRETO_KEY
  ? { 'x-apisports-key': AF_DIRETO_KEY }
  : { 'x-rapidapi-key': AF_RAPID_KEY, 'x-rapidapi-host': AF_RAPID_HOST };

const AF_QUOTA_DIA   = parseInt(process.env.AF_QUOTA_DIA || '90'); // margem sob os 100/dia
const AF_LIGADA      = (process.env.AF_LIGADA || 'true') === 'true';
// Janela de datas que o plano FREE aceita: hoje ± N dias. No free é 1 (ontem..amanhã).
// Quem assinar o Pro pode subir isto por env sem mexer no código.
const AF_JANELA_DIAS = parseInt(process.env.AF_JANELA_DIAS || '1');
const AF_CACHE_FILE  = process.env.AF_CACHE_FILE || pathmod.join(__dirname, '.af-cache.json');

// Pausa curta ao levar 429 por velocidade (não por cota do dia).
const PAUSA_RATE_LIMIT_MS = parseInt(process.env.AF_PAUSA_RATE_LIMIT_MS || '90000'); // 90s
// Intervalo mínimo entre chamadas — evita o 429 de velocidade na origem.
// O plano FREE limita por MINUTO, não só por dia. 350ms permitia ~170/min e
// levava 429 direto. 6,5s dá ~9/min, que passa folgado sob o limite de 10/min.
// Quem assinar plano pago pode baixar isso pelo .env.
const INTERVALO_MIN_MS = parseInt(process.env.AF_INTERVALO_MIN_MS || '6500');
let ultimaChamadaEm = 0;

// ── Datas (definidas cedo; são function declarations, então já valem aqui) ──
function dataISOSaoPaulo(utcDateStr) {
  return new Date(utcDateStr).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function horaSaoPaulo(utcDateStr) {
  return new Date(utcDateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}
function dataLocalBR(utcDateStr) {
  return new Date(utcDateStr).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function hojeISO() { // data local SP — usada nas consultas por data
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function hojeUTC() { // dia UTC — a cota da API zera à meia-noite UTC, não à de SP
  return new Date().toISOString().split('T')[0];
}
function proximoResetUTC() {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 0, 0, 0);
}
function dataSP(offsetDias) {
  return new Date(Date.now() + offsetDias * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function dataDentroDaJanela(dataISO) {
  return dataISO >= dataSP(-AF_JANELA_DIAS) && dataISO <= dataSP(AF_JANELA_DIAS);
}

// ── Estado da FONTE 2, PERSISTIDO em disco (sobrevive a pm2 restart) ──
// { dia(UTC), usadas, pausaAte, cache: { [path]: { em, dados } } }
let afEstado = { dia: hojeUTC(), usadas: 0, pausaAte: 0, cache: {} };
try {
  const salvo = JSON.parse(fs.readFileSync(AF_CACHE_FILE, 'utf8'));
  if (salvo && typeof salvo === 'object') afEstado = Object.assign(afEstado, salvo);
} catch { /* primeira execução: sem arquivo ainda */ }

function afSalvar() {
  // Síncrono e imediato: o contador de cota precisa estar em disco ANTES de a
  // próxima requisição sair, senão um crash entre o incremento e a gravação
  // devolveria "cota fantasma" no restart — exatamente o bug que estamos
  // consertando. O arquivo é pequeno; o custo é desprezível.
  try { fs.writeFileSync(AF_CACHE_FILE, JSON.stringify(afEstado)); }
  catch (e) { console.warn('[API-AF] não gravei o cache:', e.message); }
}

function afResetSeNovoDia() {
  const d = hojeUTC();
  if (d !== afEstado.dia) {
    afEstado.dia = d;
    afEstado.usadas = 0;
    afEstado.pausaAte = 0;
    afEstado.cache = {}; // dia novo: cache velho não serve mais
    afSalvar();
  }
}
function afPodeUsar() {
  afResetSeNovoDia();
  if (!AF_LIGADA || AF_MODO === 'off') return false;
  if (afEstado.pausaAte && Date.now() < afEstado.pausaAte) return false;
  return afEstado.usadas < AF_QUOTA_DIA;
}
// Destrava a pausa na mão. Útil quando um 429 de velocidade travou o bot
// mas a cota real (dashboard.api-football.com) ainda tem folga.
function afDestravar() {
  const tinha = afEstado.pausaAte;
  afEstado.pausaAte = 0;
  afSalvar();
  return { destravado: Boolean(tinha), pausaAnterior: tinha ? new Date(tinha).toISOString() : null };
}

function afStatusQuota() {
  afResetSeNovoDia();
  const pausado = afEstado.pausaAte && Date.now() < afEstado.pausaAte;
  return {
    usadas: afEstado.usadas,
    quota: AF_QUOTA_DIA,
    restantes: Math.max(0, AF_QUOTA_DIA - afEstado.usadas),
    modo: AF_MODO,
    api: 'API-Football',
    cacheEntradas: Object.keys(afEstado.cache).length,
    pausadoAte: pausado ? new Date(afEstado.pausaAte).toISOString() : null,
  };
}

// Validade do cache por tipo de consulta
function afTTL(path) {
  if (path.includes('live=all')) return 25 * 1000;               // ao vivo: 25s
  const m = path.match(/date=(\d{4}-\d{2}-\d{2})/);
  if (m) return (m[1] === hojeISO()) ? 60 * 1000 : 30 * 60 * 1000; // hoje 60s; outros dias 30min
  return 60 * 1000;
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

// ── GET API-Football: cache → guarda de janela → orçamento → rede ──
async function getAF(path) {
  afResetSeNovoDia();

  // (a) Guarda de janela: se é consulta por data fora do que o plano free serve,
  //     nem tenta. Isto sozinho já para o desperdício do "depois de amanhã".
  const md = path.match(/date=(\d{4}-\d{2}-\d{2})/);
  if (md && !dataDentroDaJanela(md[1])) {
    return null;
  }

  // (b) Cache fresco?
  const ent = afEstado.cache[path];
  const agora = Date.now();
  if (ent && (agora - ent.em) < afTTL(path)) {
    return ent.dados;
  }

  // (c) Orçamento/pausa: se estourou ou está pausado, devolve o cache velho em
  //     vez de bater na API. Bot com dado defasado > bot cego.
  if (!afPodeUsar()) {
    return ent ? ent.dados : null;
  }

  // (d) Rede — respeitando o intervalo mínimo entre chamadas
  const desdeUltima = Date.now() - ultimaChamadaEm;
  if (desdeUltima < INTERVALO_MIN_MS) {
    await new Promise(r => setTimeout(r, INTERVALO_MIN_MS - desdeUltima));
  }
  ultimaChamadaEm = Date.now();

  try {
    afEstado.usadas++;
    afSalvar();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetchFn(`${AF_BASE}${path}`, { headers: AF_HEADERS, signal: controller.signal });
    clearTimeout(timeout);

    if (res.status === 403) {
      afEstado.pausaAte = Date.now() + 60 * 60 * 1000; // 403 é PERMISSÃO, não cota
      afSalvar();
      console.error('[API-AF] ❌ 403 = SEM PERMISSÃO (não é cota).' + (AF_MODO === 'rapidapi'
        ? ' Sua RAPIDAPI_KEY não está inscrita na API-Football. MAIS FÁCIL: registre grátis em dashboard.api-football.com e ponha a chave em APIFOOTBALL_KEY.'
        : ' Confira a APIFOOTBALL_KEY no dashboard.api-football.com.'));
      return ent ? ent.dados : null;
    }
    if (res.status === 429) {
      // 429 na API-Football tem DOIS significados: cota do dia acabou, ou
      // requisições demais no mesmo minuto. Tratar os dois como "acabou o dia"
      // travava o bot por horas com cota sobrando — foi o que aconteceu ao
      // popular 20 elencos em sequência.
      //
      // A cota diária de verdade chega como HTTP 200 com errors.requests
      // (tratado mais abaixo). Aqui assumimos rate limit e pausamos pouco.
      afEstado.pausaAte = Date.now() + PAUSA_RATE_LIMIT_MS;
      afSalvar();
      console.warn(`[API-AF] 429 (rate limit) — pausando ${Math.round(PAUSA_RATE_LIMIT_MS / 1000)}s. Se for cota do dia, o próximo erro dirá.`);
      return ent ? ent.dados : null;
    }
    if (!res.ok) {
      console.error(`[API-AF] HTTP ${res.status} em ${path}`);
      return ent ? ent.dados : null;
    }

    const json = await res.json();

    // A API-Football devolve erros com HTTP 200, dentro de json.errors.
    if (json.errors && Object.keys(json.errors).length) {
      const e = json.errors;
      if (e.requests) {
        // ESTE era o buraco nº2: limite diário chega como 200, não como 429.
        // Agora pausamos até o reset em vez de martelar a API esgotada.
        afEstado.pausaAte = proximoResetUTC();
        afSalvar();
        console.warn('[API-AF] limite diário atingido — pausando até 00:00 UTC (não adianta insistir).');
        return ent ? ent.dados : null;
      }
      if (e.plan || e.access) {
        // Data/recurso fora do plano free. Guarda um vazio com validade longa
        // pra este caminho não ser repetido o dia todo.
        afEstado.cache[path] = { em: agora, dados: [] };
        afSalvar();
        console.warn('[API-AF] fora do plano free:', JSON.stringify(e).slice(0, 140));
        return [];
      }
      console.warn('[API-AF] erro da API:', JSON.stringify(e).slice(0, 200));
      return ent ? ent.dados : null;
    }

    const dados = json.response || [];
    afEstado.cache[path] = { em: agora, dados };

    // Poda: não deixa o arquivo de cache crescer sem fim
    const chaves = Object.keys(afEstado.cache);
    if (chaves.length > 200) {
      chaves.sort((a, b) => afEstado.cache[a].em - afEstado.cache[b].em)
        .slice(0, 80).forEach(k => delete afEstado.cache[k]);
    }
    afSalvar();
    return dados;
  } catch (e) {
    console.error('[API-AF] exceção:', e.message);
    return ent ? ent.dados : null;
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
function traduzTime(nome) {
  if (times.ehSerieA(nome)) return times.canonico(nome);
  return TIMES[nome] || nome;
}

// ── Normalização de status ──
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
// Só o Brasileirão tem rodada numerada que o site usa pra agrupar.
// Sem competition informado, assume Brasileirão (era o comportamento antigo,
// quando a única liga buscada era a BSA).
function ehBrasileirao(comp) {
  if (!comp) return true;
  if (comp.code) return comp.code === 'BSA';
  return /brasileir/i.test(comp.name || '');
}

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
    // ATENÇÃO: só o Brasileirão tem "rodada" que faz sentido numerar.
    // A Libertadores também manda matchday (=1 na fase de grupos), e isso
    // fazia o site achar que a rodada atual era a 1 — escondendo os jogos
    // do Brasileirão, que está na rodada 20.
    // Detectamos pelo código (BSA) OU pelo nome, porque nem toda resposta
    // da API traz o campo `code`.
    rodada: ehBrasileirao(m.competition) ? (m.matchday ?? null) : null,
    // A football-data manda a competição em m.competition.name quando a
    // consulta cobre mais de uma. Antes isso era fixo em "Brasileirão Série A",
    // o que rotularia jogo de Libertadores errado.
    competicao: m.competition?.name || 'Brasileirão Série A',
    fonte: 'fd',
  };
}

function mapAF(f) {
  const pen = f.score?.penalty || {};
  const temPen = pen.home != null && pen.away != null;
  const utc = f.fixture?.date;
  return {
    id: 'af_' + f.fixture?.id,
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
    rodada: null,
    competicao: f.league?.name || 'Outra competição',
    fonte: 'af',
  };
}

// ── Dedup ──
// Normaliza nome de time pra comparação, tolerando as variações que cada
// API usa. Times brasileiros passam pelo times.js (que tem as variantes);
// os estrangeiros não estão lá, então limpamos os prefixos/sufixos mais
// comuns — foi o que fazia "CS Independiente Rivadavia" e "Independiente
// Rivadavia" contarem como jogos diferentes e duplicarem o palpite.
function nomeParaChave(nome) {
  const canonico = times.canonico(nome);          // se for BR, vira o nome oficial
  return times.norm(canonico)
    // prefixos e sufixos de clube que variam entre APIs
    .replace(/\b(cs|ca|cd|sc|ec|fc|afc|ac|cf|club|clube|atletico|atlético|deportivo)\b/g, ' ')
    .replace(/\b(fc|sc|ec|cf|afc|ac|sad|ltda)\b\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chaveJogo(j) {
  return `${j.data}|${nomeParaChave(j.casa)}|${nomeParaChave(j.fora)}`;
}
// Remove jogo repetido de QUALQUER origem.
// Antes só comparávamos FD contra AF — mas desde que passamos a buscar
// BSA e CLI separadamente, o mesmo jogo pode vir DUAS VEZES dentro da
// própria lista FD (era isso que duplicava o palpite no site).
// Agora a dedup roda sobre a lista inteira, mantendo a 1ª ocorrência.
function dedup(lista) {
  const vistos = new Set();
  const saida = [];
  for (const j of lista) {
    const k = chaveJogo(j);
    if (vistos.has(k)) continue;
    vistos.add(k);
    saida.push(j);
  }
  return saida;
}

function mesclar(listaFD, listaAF) {
  return dedup([...listaFD, ...listaAF]);
}

// ═══════════════ FUNÇÕES PÚBLICAS ═══════════════

async function jogosDoDia() {
  const ontem  = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const amanha = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const hojeLocal = dataLocalBR(new Date().toISOString());

  const fd = await get(`${BASE}/competitions/${LIGA}/matches?dateFrom=${ontem}&dateTo=${amanha}`);
  let listaFD = (fd?.matches || []).map(mapFD);

  // Libertadores: a football-data cobre (código CLI) e nossos times jogam.
  // Sem isso, jogo de Liberta só apareceria pela API-Football, que no plano
  // grátis enxerga apenas 3 dias à frente.
  for (const extra of LIGAS_EXTRAS) {
    const fx = await get(`${BASE}/competitions/${extra}/matches?dateFrom=${ontem}&dateTo=${amanha}`);
    const jogosExtra = (fx?.matches || [])
      .map(mapFD)
      // na Liberta tem jogo entre times de fora; só interessa se tem clube nosso
      .filter(j => times.jogoInteressa(j.casa, j.fora));
    if (jogosExtra.length) console.log(`[API-FD] ${extra}: ${jogosExtra.length} jogo(s) com times nossos`);
    // dedup já aqui: o mesmo confronto pode aparecer em mais de uma liga
    listaFD = dedup([...listaFD, ...jogosExtra]);
  }

  let listaAF = [];
  const afHoje = await getAF(`/fixtures?date=${hojeISO()}`);
  if (afHoje) {
    listaAF = afHoje
      .filter(f => times.jogoInteressa(
        f.teams?.home?.name, f.teams?.away?.name,
        // contexto: sem isso, um "Santos" de outro país casa por nome
        { pais: f.league?.country, competicao: f.league?.name }
      ))
      .map(mapAF);
    // DIAGNÓSTICO: se o filtro cortar demais, isto aparece no log e você
    // descobre na hora (em vez de o monitor ficar cego o dia inteiro).
    console.log(`[API] AF: ${afHoje.length} jogos no mundo → ${listaAF.length} dos nossos times`);
  }

  const todos = mesclar(listaFD, listaAF);
  return todos.filter(j =>
    j.dataLocal === hojeLocal ||
    j.status === 'IN_PLAY' || j.status === 'PAUSED'
  );
}

async function jogosAoVivo() {
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

  let listaAF = [];
  const afLive = await getAF('/fixtures?live=all');
  if (afLive) {
    listaAF = afLive
      .filter(f => times.jogoInteressa(
        f.teams?.home?.name, f.teams?.away?.name,
        // contexto: sem isso, um "Santos" de outro país casa por nome
        { pais: f.league?.country, competicao: f.league?.name }
      ))
      .map(f => ({ ...mapAF(f), golsCasa: f.goals?.home ?? 0, golsFora: f.goals?.away ?? 0, minuto: f.fixture?.status?.elapsed || '?' }));
  }

  return mesclar(listaFD, listaAF);
}

async function proximosJogos() {
  const fd = await get(`${BASE}/competitions/${LIGA}/matches?status=SCHEDULED,TIMED`);
  let listaFD = (fd?.matches || []).slice(0, 30).map(mapFD);

  // Mesmas competições extras da agenda do dia (Libertadores, etc.)
  for (const extra of LIGAS_EXTRAS) {
    const fx = await get(`${BASE}/competitions/${extra}/matches?status=SCHEDULED,TIMED`);
    const jogosExtra = (fx?.matches || [])
      .slice(0, 30)
      .map(mapFD)
      .filter(j => times.jogoInteressa(j.casa, j.fora));
    listaFD = dedup([...listaFD, ...jogosExtra]);
  }

  // Só consulta dias DENTRO da janela do plano (a guarda em getAF também protege,
  // mas nem gerar a chamada é mais limpo). No free, AF_JANELA_DIAS=1 → só amanhã.
  let listaAF = [];
  for (let d = 1; d <= AF_JANELA_DIAS; d++) {
    const dia = dataSP(d);
    const r = await getAF(`/fixtures?date=${dia}`);
    if (r) {
      listaAF.push(...r
        .filter(f => times.jogoInteressa(
        f.teams?.home?.name, f.teams?.away?.name,
        // contexto: sem isso, um "Santos" de outro país casa por nome
        { pais: f.league?.country, competicao: f.league?.name }
      ))
        .map(mapAF)
        .filter(j => ['SCHEDULED', 'TIMED'].includes(j.status)));
    }
  }

  return mesclar(listaFD, listaAF).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
}

async function rodadaAtualLiga() {
  const d = await get(`${BASE}/competitions/${LIGA}`);
  const r = d?.currentSeason?.currentMatchday;
  return (typeof r === 'number' && r > 0) ? r : null;
}

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
  traduzTime, dataISOSaoPaulo, afStatusQuota, afDiagnostico, afDestravar, rodadaAtualLiga, getAF, LIGA,
};
