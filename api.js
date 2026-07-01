// api.js — Busca dados da Copa do Mundo na football-data.org
const fetch = require('node-fetch');

const BASE = 'https://api.football-data.org/v4';
const KEY  = process.env.FOOTBALL_API_KEY;
const headers = { 'X-Auth-Token': KEY };

// Converte uma data UTC pra AAAA-MM-DD no fuso de São Paulo (evita jogo de 21h virar "amanhã")
function dataISOSaoPaulo(utcDateStr) {
  const partes = new Date(utcDateStr).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // en-CA = AAAA-MM-DD
  return partes; // já vem no formato ISO AAAA-MM-DD
}

// Helper que busca e trata erros (rate limit, manutenção, etc.) sem travar o bot
async function get(url) {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`[API] Status ${res.status} em ${url}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`[API] Falha ao buscar ${url}:`, e.message);
    return null;
  }
}

// Tradução de nomes de times (API retorna em inglês)
const TIMES = {
  'Brazil':'Brasil','Argentina':'Argentina','France':'França',
  'England':'Inglaterra','Portugal':'Portugal','Spain':'Espanha',
  'Germany':'Alemanha','Netherlands':'Holanda','Uruguay':'Uruguai',
  'Colombia':'Colômbia','Mexico':'México','USA':'Estados Unidos',
  'United States':'Estados Unidos','Canada':'Canadá','Morocco':'Marrocos',
  'Japan':'Japão','South Korea':'Coreia do Sul','Korea Republic':'Coreia do Sul',
  'Australia':'Austrália','Senegal':'Senegal','Croatia':'Croácia',
  'Switzerland':'Suíça','Denmark':'Dinamarca','Belgium':'Bélgica',
  'Poland':'Polônia','Serbia':'Sérvia','Ecuador':'Equador',
  'Cameroon':'Camarões','Ghana':'Gana','Tunisia':'Tunísia',
  'Saudi Arabia':'Arábia Saudita','Iran':'Irã','IR Iran':'Irã',
  'Qatar':'Catar','Costa Rica':'Costa Rica','Paraguay':'Paraguai',
  'Turkey':'Turquia','Turkiye':'Turquia','Austria':'Áustria',
  'Norway':'Noruega','Sweden':'Suécia','Ukraine':'Ucrânia',
  'Hungary':'Hungria','Slovakia':'Eslováquia','Wales':'País de Gales',
  'Scotland':'Escócia','Algeria':'Argélia','Nigeria':'Nigéria',
  'Egypt':'Egito','South Africa':'África do Sul','Ivory Coast':'Costa do Marfim',
  'New Zealand':'Nova Zelândia','Haiti':'Haiti','Bolivia':'Bolívia',
  'Chile':'Chile','Peru':'Peru','Venezuela':'Venezuela',
  'Panama':'Panamá','Honduras':'Honduras','Jamaica':'Jamaica',
  'Cuba':'Cuba','Curacao':'Curaçao','Cape Verde':'Cabo Verde',
  'Mali':'Mali','Burkina Faso':'Burkina Faso','Iraq':'Iraque',
  'Jordan':'Jordânia','Uzbekistan':'Uzbequistão','Congo DR':'Congo DR',
  'DR Congo':'Congo DR','Bosnia and Herzegovina':'Bósnia e Herz.',
};
function traduzTime(nome) { return TIMES[nome] || nome; }

async function jogosDoDia() {
  // Janela ampla: ontem até amanhã (cobre fuso UTC vs Brasil e jogos de madrugada)
  const ontem = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const amanha = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const data = await get(`${BASE}/competitions/WC/matches?dateFrom=${ontem}&dateTo=${amanha}`);
  if (!data || !data.matches) return [];
  // Filtra só os jogos cuja data LOCAL (Brasil) é hoje, OU que estão em andamento
  const hojeLocal = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return data.matches.map(m => ({
    id: m.id,
    casa: traduzTime(m.homeTeam.name),
    fora: traduzTime(m.awayTeam.name),
    hora: new Date(m.utcDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
    data: dataISOSaoPaulo(m.utcDate), // ISO pro Supabase (fuso SP, evita virar 'amanhã')
    dataLocal: new Date(m.utcDate).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    status: m.status,
    golsCasa: m.score.fullTime.home,
    golsFora: m.score.fullTime.away,
    fase: m.stage,
  })).filter(j =>
    j.dataLocal === hojeLocal ||
    j.status === 'IN_PLAY' || j.status === 'PAUSED' ||
    (j.golsCasa !== null && j.status !== 'FINISHED')
  );
}

async function jogosAoVivo() {
  // Busca IN_PLAY e PAUSED separadamente (a API recusa vírgula no status)
  const [d1, d2] = await Promise.all([
    get(`${BASE}/competitions/WC/matches?status=IN_PLAY`),
    get(`${BASE}/competitions/WC/matches?status=PAUSED`),
  ]);
  const matches = [...(d1?.matches || []), ...(d2?.matches || [])];
  if (!matches.length) return [];
  return matches.map(m => ({
    id: m.id,
    casa: traduzTime(m.homeTeam.name),
    fora: traduzTime(m.awayTeam.name),
    golsCasa: m.score.fullTime.home ?? m.score.halfTime.home ?? 0,
    golsFora: m.score.fullTime.away ?? m.score.halfTime.away ?? 0,
    minuto: m.minute || '?',
    status: m.status,
  }));
}

async function tabela() {
  const data = await get(`${BASE}/competitions/WC/standings`);
  if (!data || !data.standings) return [];
  return data.standings
    .filter(g => g.type === 'TOTAL')
    .map(grupo => ({
      grupo: grupo.group || 'Grupo',
      times: grupo.table.map(t => ({
        pos: t.position,
        time: traduzTime(t.team.name),
        pts: t.points,
        j: t.playedGames,
        v: t.won,
        e: t.draw,
        d: t.lost,
        sg: t.goalDifference,
        gp: t.goalsFor,
      }))
    }));
}

async function artilheiros() {
  const data = await get(`${BASE}/competitions/WC/scorers?limit=10`);
  if (!data || !data.scorers) return [];
  return data.scorers.map((s, i) => ({
    pos: i + 1,
    nome: s.player.name,
    time: traduzTime(s.team.name),
    gols: s.goals || 0,
    assistencias: s.assists || 0,
  }));
}

async function proximosJogos() {
  const data = await get(`${BASE}/competitions/WC/matches?status=SCHEDULED,TIMED`);
  if (!data || !data.matches) return [];
  return data.matches.slice(0, 15).map(m => ({
    id: m.id,
    casa: traduzTime(m.homeTeam.name),
    fora: traduzTime(m.awayTeam.name),
    data: dataISOSaoPaulo(m.utcDate), // ISO AAAA-MM-DD pro Supabase (fuso SP)
    dataBR: new Date(m.utcDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }),
    hora: new Date(m.utcDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
    status: m.status,
    golsCasa: m.score.fullTime.home,
    golsFora: m.score.fullTime.away,
  }));
}

module.exports = { jogosDoDia, jogosAoVivo, tabela, artilheiros, proximosJogos, traduzTime };
