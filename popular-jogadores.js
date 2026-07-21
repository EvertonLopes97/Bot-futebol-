// popular-jogadores.js — puxa os elencos dos 20 clubes da Série A (API-Football)
// e grava na tabela `jogadores_cartas` do Supabase, que alimenta o Jogo da Memória no site.
//
// Roda sob demanda (comando /popularjogadores, staff). NÃO roda no loop do bot —
// elencos mudam pouco, então cachear e atualizar de vez em quando basta.
//
// Custo: 1 req pra listar os times + 1 req por time = ~21 requisições da cota diária.

const api = require('./api.js');
const armaz = require('./armazenamento.js');
const times = require('./times.js');

const LEAGUE_AF = parseInt(process.env.AF_LEAGUE_BR || '71'); // 71 = Brasileirão Série A na API-Football
const SEASON_AF = parseInt(process.env.AF_SEASON || new Date().getFullYear());

async function popularJogadores(log = console.log) {
  const sb = armaz.supabaseClient ? armaz.supabaseClient() : null;
  if (!sb) { log('[JOGADORES] ❌ Supabase indisponível.'); return { ok: false, erro: 'sem supabase' }; }
  if (!api.getAF) { log('[JOGADORES] ❌ getAF não exportado pelo api.js.'); return { ok: false, erro: 'sem getAF' }; }

  // 1) lista os times da liga (pega os IDs da API-Football)
  log('[JOGADORES] buscando times da liga...');
  const teams = await api.getAF(`/teams?league=${LEAGUE_AF}&season=${SEASON_AF}`);
  if (!teams || !teams.length) {
    log('[JOGADORES] ❌ não retornou times (cota/403? confira a APIFOOTBALL_KEY).');
    return { ok: false, erro: 'sem times' };
  }

  // só os que são da nossa Série A (casamento por nome via times.js)
  const alvos = teams.filter(t => times.ehSerieA(t.team?.name)).map(t => ({
    id: t.team.id, nome: times.canonico(t.team.name), logo: t.team.logo,
  }));
  log(`[JOGADORES] ${alvos.length} clubes reconhecidos da Série A.`);

  let totalJogadores = 0;
  const linhas = [];
  for (const clube of alvos) {
    const squad = await api.getAF(`/players/squads?team=${clube.id}`);
    const elenco = squad?.[0]?.players || [];
    for (const p of elenco) {
      linhas.push({
        clube: clube.nome,
        api_team_id: clube.id,
        nome: p.name,
        posicao: p.position || null,
        foto_url: p.photo || null,
        numero: p.number || null,
      });
    }
    totalJogadores += elenco.length;
    log(`[JOGADORES]   ${clube.nome}: ${elenco.length} jogadores`);
    await new Promise(r => setTimeout(r, 300)); // respira entre requisições
  }

  if (!linhas.length) { log('[JOGADORES] ❌ nenhum jogador coletado.'); return { ok: false, erro: 'vazio' }; }

  // 2) substitui a tabela (limpa e regrava — mantém o elenco fresco)
  await sb.from('jogadores_cartas').delete().neq('id', 0);
  // insere em lotes de 500
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500);
    const { error } = await sb.from('jogadores_cartas').insert(lote);
    if (error) { log('[JOGADORES] ❌ insert:', error.message); return { ok: false, erro: error.message }; }
  }

  log(`[JOGADORES] ✅ ${totalJogadores} jogadores de ${alvos.length} clubes gravados.`);
  return { ok: true, clubes: alvos.length, jogadores: totalJogadores };
}

module.exports = { popularJogadores };
