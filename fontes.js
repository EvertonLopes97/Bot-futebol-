// fontes.js — Gerenciador de múltiplas APIs de futebol
// Primária: football-data.org (ilimitada, internacional)
// Backup: dadosfutebol.com.br (plano Free = endpoints básicos)
// NOTA: o plano Free da dadosfutebol NÃO inclui ao vivo.
// O backup usa partidas do dia e filtra as que já têm placar (em andamento).
const fetch = require('node-fetch');

const QUOTA_DIARIA = parseInt(process.env.DF_QUOTA_DIA || '80');
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

// IDs dos campeonatos na dadosfutebol (plano free)
// Copa do Mundo = verificar no /v1/campeonatos
// Brasileirão Série A = 1 (padrão)
const CAMP_IDS = (process.env.DF_CAMP_IDS || '1,2,3').split(',').map(s => s.trim());

async function golsBackup() {
  if (!podeUsarBackup()) return null;
  const headers = {
    'Authorization': `Bearer ${process.env.DADOSFUTEBOL_KEY}`,
    'Accept': 'application/json',
  };
  const hoje = new Date().toISOString().split('T')[0];
  const resultados = [];

  for (const id of CAMP_IDS) {
    if (usadasHoje >= QUOTA_DIARIA) break;
    try {
      usadasHoje++;
      const url = `https://api.dadosfutebol.com.br/v1/campeonatos/${id}/partidas?data=${hoje}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        // 403 = endpoint não disponível no plano, 404 = campeonato não existe
        if (res.status === 403) { console.log(`[BACKUP] camp ${id}: requer plano Pro`); continue; }
        if (res.status === 404) { console.log(`[BACKUP] camp ${id}: não encontrado`); continue; }
        console.log(`[BACKUP] camp ${id}: status ${res.status}`); continue;
      }
      const j = await res.json();
      const lista = j.data || j.partidas || (Array.isArray(j) ? j : []);
      for (const p of lista) {
        // só inclui se tiver placar (jogo em andamento ou encerrado hoje)
        const gc = p.placar_mandante ?? p.gols_mandante;
        const gf = p.placar_visitante ?? p.gols_visitante;
        if (gc === null || gc === undefined) continue;
        resultados.push({
          casa: p.time_mandante?.nome_popular || p.time_mandante?.nome || '',
          fora: p.time_visitante?.nome_popular || p.time_visitante?.nome || '',
          golsCasa: gc,
          golsFora: gf,
        });
      }
    } catch (e) { console.log(`[BACKUP] camp ${id}: ${e.message}`); }
  }

  return resultados.length ? resultados : null;
}

function conciliar(jogoPrimario, listaBackup) {
  if (!listaBackup || !listaBackup.length) {
    return { ...jogoPrimario, confianca: 'única', fonte: 'football-data' };
  }
  const norm = s => (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 4);
  const match = listaBackup.find(b =>
    norm(b.casa) === norm(jogoPrimario.casa) ||
    norm(b.fora) === norm(jogoPrimario.fora)
  );
  if (!match) return { ...jogoPrimario, confianca: 'única', fonte: 'football-data' };
  const igual = match.golsCasa === jogoPrimario.golsCasa &&
                match.golsFora === jogoPrimario.golsFora;
  if (igual) return { golsCasa: jogoPrimario.golsCasa, golsFora: jogoPrimario.golsFora,
    confianca: 'alta (2 fontes concordam)', fonte: 'football-data + dadosfutebol' };
  const gc = Math.max(jogoPrimario.golsCasa ?? 0, match.golsCasa ?? 0);
  const gf = Math.max(jogoPrimario.golsFora ?? 0, match.golsFora ?? 0);
  return { golsCasa: gc, golsFora: gf,
    confianca: 'média (fontes divergem)', fonte: 'conciliado' };
}

function statusQuota() {
  resetSeNovoDia();
  return { usadas: usadasHoje, limite: QUOTA_DIARIA,
    restantes: QUOTA_DIARIA - usadasHoje, api: 'dadosfutebol.com.br (Free)' };
}

module.exports = { golsBackup, conciliar, podeUsarBackup, statusQuota };
