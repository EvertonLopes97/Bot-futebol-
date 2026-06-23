// api.js — Busca dados da Copa do Mundo na football-data.org
const fetch = require('node-fetch');

const BASE = 'https://api.football-data.org/v4';
const KEY  = process.env.FOOTBALL_API_KEY;
const headers = { 'X-Auth-Token': KEY };

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
  const hoje = new Date().toISOString().split('T')[0];
  const data = await get(`${BASE}/competitions/WC/matches?dateFrom=${hoje}&dateTo=${hoje}`);
  if (!data || !data.matches) return [];
  return data.matches.map(m => ({
    id: m.id,
    casa: traduzTime(m.homeTeam.name),
    fora: traduzTime(m.awayTeam.name),
    hora: new Date(m.utcDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
    status: m.status,
    golsCasa: m.score.fullTime.home,
    golsFora: m.score.fullTime.away,
    fase: m.stage,
  }));
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

module.exports = { jogosDoDia, jogosAoVivo, tabela, artilheiros, traduzTime };
