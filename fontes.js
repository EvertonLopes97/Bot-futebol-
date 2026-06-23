// fontes.js — Gerenciador de múltiplas APIs de futebol (primária + backup)
// Estratégia: football-data (ilimitada) como base; apidofutebol (100/dia) como
// reforço SÓ durante jogos, pra confirmar gols mais rápido e economizar quota.
const fetch = require('node-fetch');

// ── Controle de quota da API brasileira (backup) ──
const QUOTA_DIARIA = parseInt(process.env.BR_QUOTA_DIA || '90'); // margem de segurança
let usadasHoje = 0;
let diaAtual = new Date().toISOString().split('T')[0];

function resetSeNovoDia() {
  const hoje = new Date().toISOString().split('T')[0];
  if (hoje !== diaAtual) { diaAtual = hoje; usadasHoje = 0; }
}
function podeUsarBackup() {
  resetSeNovoDia();
  return process.env.APIDOFUTEBOL_KEY && usadasHoje < QUOTA_DIARIA;
}

// ── Backup: apidofutebol.com (ao vivo) ──
// Só é chamada quando há jogo ativo, pra confirmar placar.
async function golsBackup() {
  if (!podeUsarBackup()) return null;
  try {
    usadasHoje++;
    const res = await fetch('https://api.apidofutebol.com/v1/ao-vivo', {
      headers: { 'Authorization': `Bearer ${process.env.APIDOFUTEBOL_KEY}` }
    });
    if (!res.ok) { console.error('[BACKUP] status', res.status); return null; }
    const j = await res.json();
    const jogos = j.partidas || j.data || j.jogos || [];
    // normaliza pro mesmo formato do bot
    return (Array.isArray(jogos) ? jogos : []).map(p => ({
      casa: p.time_casa || p.mandante || p.home,
      fora: p.time_fora || p.visitante || p.away,
      golsCasa: p.placar_casa ?? p.gols_casa ?? p.home_score,
      golsFora: p.placar_fora ?? p.gols_fora ?? p.away_score,
    }));
  } catch (e) { console.error('[BACKUP]', e.message); return null; }
}

// ── Compara duas fontes pro mesmo jogo e decide o placar confiável ──
// Retorna { golsCasa, golsFora, confianca, fonte }
function conciliar(jogoPrimario, listaBackup) {
  if (!listaBackup) return { ...jogoPrimario, confianca: 'única', fonte: 'football-data' };
  // tenta achar o mesmo jogo no backup (por nome aproximado)
  const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const match = listaBackup.find(b =>
    norm(b.casa).includes(norm(jogoPrimario.casa).slice(0,4)) ||
    norm(b.fora).includes(norm(jogoPrimario.fora).slice(0,4)));
  if (!match) return { ...jogoPrimario, confianca: 'única', fonte: 'football-data' };

  const igual = match.golsCasa === jogoPrimario.golsCasa && match.golsFora === jogoPrimario.golsFora;
  if (igual) {
    return { golsCasa: jogoPrimario.golsCasa, golsFora: jogoPrimario.golsFora, confianca: 'alta (2 fontes concordam)', fonte: 'football-data + apidofutebol' };
  }
  // divergência: usa o MAIOR placar (gol acabou de sair numa fonte e não na outra)
  const gc = Math.max(jogoPrimario.golsCasa ?? 0, match.golsCasa ?? 0);
  const gf = Math.max(jogoPrimario.golsFora ?? 0, match.golsFora ?? 0);
  return { golsCasa: gc, golsFora: gf, confianca: 'media (fontes divergem, usando mais recente)', fonte: 'conciliado' };
}

function statusQuota() {
  resetSeNovoDia();
  return { usadas: usadasHoje, limite: QUOTA_DIARIA, restantes: QUOTA_DIARIA - usadasHoje };
}

module.exports = { golsBackup, conciliar, podeUsarBackup, statusQuota };
