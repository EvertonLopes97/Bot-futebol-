// api.js — Busca dados da Copa do Mundo na football-data.org
const fetch = require('node-fetch');

const BASE = 'https://api.football-data.org/v4';
const KEY  = process.env.FOOTBALL_API_KEY;

const headers = { 'X-Auth-Token': KEY };

// Tradução de nomes de times (API retorna em inglês)
const TIMES = {
  'Brazil':'Brasil','Argentina':'Argentina','France':'França',
  'England':'Inglaterra','Portugal':'Portugal','Spain':'Espanha',
  'Germany':'Alemanha','Netherlands':'Holanda','Uruguay':'Uruguai',
  'Colombia':'Colômbia','Mexico':'México','USA':'Estados Unidos',
  'Canada':'Canadá','Morocco':'Marrocos','Japan':'Japão',
  'South Korea':'Coreia do Sul','Australia':'Austrália','Senegal':'Senegal',
  'Croatia':'Croácia','Switzerland':'Suíça','Denmark':'Dinamarca',
  'Belgium':'Bélgica','Poland':'Polônia','Serbia':'Sérvia',
  'Ecuador':'Equador','Cameroon':'Camarões','Ghana':'Gana',
  'Tunisia':'Tunísia','Saudi Arabia':'Arábia Saudita','Iran':'Irã',
  'Qatar':'Catar','Costa Rica':'Costa Rica','Paraguay':'Paraguai',
  'Turkey':'Turquia','Austria':'Áustria','Norway':'Noruega',
  'Sweden':'Suécia','Ukraine':'Ucrânia','Hungary':'Hungria',
  'Slovakia':'Eslováquia','Wales':'País de Gales','Scotland':'Escócia',
  'Algeria':'Argélia','Nigeria':'Nigéria','Egypt':'Egito',
  'South Africa':'África do Sul','Ivory Coast':'Costa do Marfim',
  'New Zealand':'Nova Zelândia','Haiti':'Haiti','Bolivia':'Bolívia',
  'Chile':'Chile','Peru':'Peru','Venezuela':'Venezuela',
  'Panama':'Panamá','Honduras':'Honduras','Jamaica':'Jamaica',
  'Cuba':'Cuba','Curacao':'Curaçao','Cape Verde':'Cabo Verde',
  'Mali':'Mali','Burkina Faso':'Burkina Faso','Iraq':'Iraque',
  'Jordan':'Jordânia','Saudi Arabia':'Arábia Saudita','Uzbekistan':'Uzbequistão',
};

function traduzTime(nome) {
  return TIMES[nome] || nome;
}

// Jogos do dia (Copa do Mundo = WC)
async function jogosDoDia() {
  const hoje = new Date().toISOString().split('T')[0];
  const res = await fetch(`${BASE}/competitions/WC/matches?dateFrom=${hoje}&dateTo=${hoje}`, { headers });
  const data = await res.json();
  return (data.matches || []).map(m => ({
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

// Todos os jogos ao vivo agora
async function jogosAoVivo() {
  const res = await fetch(`${BASE}/competitions/WC/matches?status=IN_PLAY,PAUSED`, { headers });
  const data = await res.json();
  return (data.matches || []).map(m => ({
    id: m.id,
    casa: traduzTime(m.homeTeam.name),
    fora: traduzTime(m.awayTeam.name),
    golsCasa: m.score.fullTime.home ?? m.score.halfTime.home ?? 0,
    golsFora: m.score.fullTime.away ?? m.score.halfTime.away ?? 0,
    minuto: m.minute || '?',
    status: m.status,
  }));
}

// Resultados do dia (jogos encerrados)
async function resultadosDoDia() {
  const hoje = new Date().toISOString().split('T')[0];
  const res = await fetch(`${BASE}/competitions/WC/matches?dateFrom=${hoje}&dateTo=${hoje}&status=FINISHED`, { headers });
  const data = await res.json();
  return (data.matches || []).map(m => ({
    casa: traduzTime(m.homeTeam.name),
    fora: traduzTime(m.awayTeam.name),
    golsCasa: m.score.fullTime.home,
    golsFora: m.score.fullTime.away,
  }));
}

// Classificação / tabela
async function tabela() {
  const res = await fetch(`${BASE}/competitions/WC/standings`, { headers });
  const data = await res.json();
  if (!data.standings) return [];
  return (data.standings || []).map(grupo => ({
    grupo: grupo.group,
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

// Artilheiros
async function artilheiros() {
  const res = await fetch(`${BASE}/competitions/WC/scorers?limit=10`, { headers });
  const data = await res.json();
  return (data.scorers || []).map((s, i) => ({
    pos: i + 1,
    nome: s.player.name,
    time: traduzTime(s.team.name),
    gols: s.goals,
    assistencias: s.assists || 0,
  }));
}

module.exports = { jogosDoDia, jogosAoVivo, resultadosDoDia, tabela, artilheiros, traduzTime };
