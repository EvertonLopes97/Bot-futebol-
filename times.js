// times.js — Os 20 clubes da Série A 2026.
// O bot segue os TIMES, não os campeonatos: se o Flamengo joga a Libertadores, entra automático.
//
// Cada clube tem "variantes": como cada API escreve o nome dele.
// O casamento é por nome NORMALIZADO e EXATO (nunca por "contém"),
// pra não confundir Botafogo-RJ com Botafogo-SP, ou Santos com Santos Laguna.

// Normaliza: minúsculas, sem acento, sem pontuação, espaços colapsados.
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
    .toLowerCase()
    .replace(/[.\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// pop = fama (1-10). Usado pra escolher o jogo mais relevante do bolão.
const CLUBES = [
  { nome: 'Flamengo',      pop: 10, variantes: ['Flamengo', 'CR Flamengo', 'Clube de Regatas do Flamengo', 'Flamengo RJ'] },
  { nome: 'Corinthians',   pop: 10, variantes: ['Corinthians', 'SC Corinthians Paulista', 'Corinthians Paulista', 'Sport Club Corinthians Paulista'] },
  { nome: 'Palmeiras',     pop: 9,  variantes: ['Palmeiras', 'SE Palmeiras', 'Sociedade Esportiva Palmeiras'] },
  { nome: 'São Paulo',     pop: 9,  variantes: ['São Paulo', 'Sao Paulo', 'São Paulo FC', 'Sao Paulo FC'] },
  { nome: 'Vasco',         pop: 8,  variantes: ['Vasco', 'Vasco da Gama', 'CR Vasco da Gama', 'Vasco DA Gama'] },
  { nome: 'Cruzeiro',      pop: 8,  variantes: ['Cruzeiro', 'Cruzeiro EC', 'Cruzeiro Esporte Clube'] },
  { nome: 'Grêmio',        pop: 8,  variantes: ['Grêmio', 'Gremio', 'Grêmio FBPA', 'Gremio FBPA', 'Grêmio Foot-Ball Porto Alegrense'] },
  { nome: 'Internacional', pop: 8,  variantes: ['Internacional', 'SC Internacional', 'Sport Club Internacional'] },
  { nome: 'Santos',        pop: 8,  variantes: ['Santos', 'Santos FC', 'Santos Futebol Clube'] },
  { nome: 'Atlético-MG',   pop: 8,  variantes: ['Atlético Mineiro', 'Atletico Mineiro', 'Atlético-MG', 'Atletico-MG', 'CA Mineiro', 'Clube Atlético Mineiro'] },
  { nome: 'Botafogo',      pop: 8,  variantes: ['Botafogo', 'Botafogo FR', 'Botafogo RJ', 'Botafogo de Futebol e Regatas'] },
  { nome: 'Fluminense',    pop: 7,  variantes: ['Fluminense', 'Fluminense FC', 'Fluminense Football Club'] },
  { nome: 'Bahia',         pop: 6,  variantes: ['Bahia', 'EC Bahia', 'Esporte Clube Bahia'] },
  { nome: 'Athletico-PR',  pop: 5,  variantes: ['Athletico Paranaense', 'Athletico-PR', 'Athletico PR', 'Club Athletico Paranaense', 'Atlético Paranaense', 'CA Paranaense'] },
  { nome: 'Vitória',       pop: 5,  variantes: ['Vitória', 'Vitoria', 'EC Vitória', 'EC Vitoria', 'Esporte Clube Vitória'] },
  { nome: 'Coritiba',      pop: 5,  variantes: ['Coritiba', 'Coritiba FC', 'Coritiba FBC', 'Coritiba Foot Ball Club'] },
  { nome: 'Bragantino',    pop: 4,  variantes: ['Red Bull Bragantino', 'RB Bragantino', 'Bragantino', 'Bragantino SP'] },
  { nome: 'Chapecoense',   pop: 4,  variantes: ['Chapecoense', 'Chapecoense AF', 'Chapecoense SC', 'Associação Chapecoense de Futebol'] },
  { nome: 'Remo',          pop: 4,  variantes: ['Remo', 'Clube do Remo', 'Remo PA'] },
  { nome: 'Mirassol',      pop: 3,  variantes: ['Mirassol', 'Mirassol FC', 'Mirassol Futebol Clube'] },
];

// Índice: nome normalizado (de qualquer variante) → clube canônico
const INDICE = new Map();
for (const c of CLUBES) {
  for (const v of c.variantes) INDICE.set(norm(v), c);
}

// É um clube da Série A? (casamento exato, sem falso positivo)
function ehSerieA(nomeApi) {
  return INDICE.has(norm(nomeApi));
}

// Converte o nome de qualquer API pro nome canônico. Se não for da Série A, devolve o nome original.
function canonico(nomeApi) {
  const c = INDICE.get(norm(nomeApi));
  return c ? c.nome : nomeApi;
}

// Fama do time (pra relevância do bolão). Time de fora da Série A = 3.
function popularidade(nomeQualquer) {
  const c = INDICE.get(norm(nomeQualquer));
  return c ? c.pop : 3;
}

// O jogo envolve pelo menos UM clube da Série A? (é isso que decide se entra no bot)
function jogoInteressa(nomeCasa, nomeFora) {
  return ehSerieA(nomeCasa) || ehSerieA(nomeFora);
}

const NOMES = CLUBES.map(c => c.nome);

module.exports = { CLUBES, NOMES, norm, ehSerieA, canonico, popularidade, jogoInteressa };
