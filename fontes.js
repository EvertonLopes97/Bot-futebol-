// fontes.js — Gerenciador de múltiplas APIs de futebol (primária + backup)
// Primária: football-data.org (ilimitada, internacional)
// Backup: dadosfutebol.com.br (dados em português, futebol brasileiro + Copa)
// Estratégia: backup só roda DURANTE jogos pra economizar quota.
const fetch = require('node-fetch');

// ── Controle de quota do backup (limite do plano grátis) ──
const QUOTA_DIARIA = parseInt(process.env.DF_QUOTA_DIA || '90');
let usadasHoje = 0;
let diaAtual = new Date().toISOString().split('T')[0];

function resetSeNovoDia() {
  const hoje = new Date().toISOString().split('T')[0];
  if (hoje !== diaAtual) { diaAtual = hoje; usadasHoje = 0; }
}
function podeUsarBackup() {
  resetSeNovoDia();
  return !!(process.env.DADOSFUTEBOL_KEY) && usadasHoje < QUOTA_DIARIA;
}

// ── Backup: dadosfutebol.com.br (partidas ao vivo) ──
// Endpoint: GET /v1/campeonatos/{id}/partidas?ao_vivo=true
// Cobre: Brasileirão A/B, Copa do Brasil, Libertadores, Sul-Americana, Copa do Mundo
// Campos: placar_mandante, placar_visitante, ao_vivo, encerrada, time_mandante.nome, time_visitante.nome
async function golsBackup() {
  if (!podeUsarBackup()) return null;
  try {
    usadasHoje++;
    const headers = { 'Authorization': `Bearer ${process.env.DADOSFUTEBOL_KEY}` };

    // Busca partidas ao vivo de todos os campeonatos de uma vez (1 chamada)
    // Tenta múltiplos endpoints (a dadosfutebol pode usar qualquer um destes)
    const endpoints = [
      'https://api.dadosfutebol.com.br/v1/partidas?status=ao_vivo',
      'https://api.dadosfutebol.com.br/v1/partidas?ao_vivo=1',
      'https://api.dadosfutebol.com.br/v1/partidas/ao-vivo',
      'https://api.dadosfutebol.com.br/v1/ao-vivo',
    ];
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { headers });
        if (res.ok) return normalizarDadosFutebol(await res.json());
        console.log('[BACKUP] tentou', url, '→ status', res.status);
      } catch (e) { console.log('[BACKUP] tentou', url, '→', e.message); }
    }
    console.error('[BACKUP] nenhum endpoint funcionou. Verifique a documentação da dadosfutebol.');
    return null;
  } catch (e) { console.error('[BACKUP]', e.message); return null; }
}

// Normaliza a resposta da dadosfutebol pro formato do bot
function normalizarDadosFutebol(j) {
  // Pode vir como { data: [...] } ou direto como array
  const lista = j.data || j.partidas || (Array.isArray(j) ? j : []);
  return (Array.isArray(lista) ? lista : [])
    .filter(p => p.ao_vivo || !p.encerrada)
    .map(p => ({
      // dadosfutebol usa nomes em português
      casa: p.time_mandante?.nome_popular || p.time_mandante?.nome || p.mandante || '',
      fora: p.time_visitante?.nome_popular || p.time_visitante?.nome || p.visitante || '',
      golsCasa: p.placar_mandante ?? p.gols_mandante ?? null,
      golsFora: p.placar_visitante ?? p.gols_visitante ?? null,
    }))
    .filter(p => p.casa && p.fora && p.golsCasa !== null);
}

// ── Concilia as duas fontes pro mesmo jogo ──
// Retorna o placar mais recente (o maior) quando há divergência
function conciliar(jogoPrimario, listaBackup) {
  if (!listaBackup || !listaBackup.length) {
    return { ...jogoPrimario, confianca: 'única', fonte: 'football-data' };
  }

  // Normaliza pra comparação (remove acentos, lowercase, primeiras 4 letras)
  const norm = s => (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 4);

  const match = listaBackup.find(b =>
    norm(b.casa) === norm(jogoPrimario.casa) ||
    norm(b.fora) === norm(jogoPrimario.fora) ||
    norm(b.casa).includes(norm(jogoPrimario.casa)) ||
    norm(jogoPrimario.casa).includes(norm(b.casa))
  );

  if (!match) return { ...jogoPrimario, confianca: 'única', fonte: 'football-data' };

  const igual = match.golsCasa === jogoPrimario.golsCasa &&
                match.golsFora === jogoPrimario.golsFora;

  if (igual) {
    return {
      golsCasa: jogoPrimario.golsCasa,
      golsFora: jogoPrimario.golsFora,
      confianca: 'alta (2 fontes concordam)',
      fonte: 'football-data + dadosfutebol'
    };
  }

  // Divergência: usa o MAIOR placar (gol recém saiu numa fonte e a outra ainda não atualizou)
  const gc = Math.max(jogoPrimario.golsCasa ?? 0, match.golsCasa ?? 0);
  const gf = Math.max(jogoPrimario.golsFora ?? 0, match.golsFora ?? 0);
  return {
    golsCasa: gc,
    golsFora: gf,
    confianca: 'média (fontes divergem, usando placar mais recente)',
    fonte: 'conciliado'
  };
}

function statusQuota() {
  resetSeNovoDia();
  return { usadas: usadasHoje, limite: QUOTA_DIARIA, restantes: QUOTA_DIARIA - usadasHoje, api: 'dadosfutebol.com.br' };
}

module.exports = { golsBackup, conciliar, podeUsarBackup, statusQuota };
