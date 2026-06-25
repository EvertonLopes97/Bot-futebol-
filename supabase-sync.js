// supabase-sync.js — Sincroniza dados do bot → tabelas estruturadas do Supabase
// Para o site ler ranking, jogos e palpites do MESMO lugar.
// LOGA cada operação (sucesso/erro) pra facilitar debug no Railway.
let supabase = null;

function init() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.log('[SYNC] ⚠️ Supabase NÃO configurado (faltam SUPABASE_URL/KEY). Sync desativado.');
    return false;
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    // realtime desativado: o bot só escreve/lê, não precisa de WebSocket
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
      realtime: { params: { eventsPerSecond: 0 } },
      auth: { persistSession: false },
    });
    console.log('[SYNC] ✅ Supabase conectado para sincronização estruturada.');
    return true;
  } catch (e) {
    console.error('[SYNC] ❌ erro ao conectar Supabase:', e.message);
    return false;
  }
}

// Sincroniza o ranking de palpites → tabela ranking_bot
async function syncRanking(ranking) {
  if (!supabase) return;
  if (!ranking || !ranking.length) { console.log('[SYNC] ranking vazio, nada a enviar.'); return; }
  try {
    const linhas = ranking.map((r, i) => ({
      discord_id: String(r.id || r.discord_id || ''),
      nome: r.nome || 'Membro',
      pontos: r.pts ?? r.pontos ?? 0,
      exatos: r.exatos ?? 0,
      participacoes: r.participacoes ?? 0,
      posicao: i + 1,
      atualizado_em: new Date().toISOString(),
    }));
    const { error } = await supabase.from('ranking_bot').upsert(linhas, { onConflict: 'discord_id' });
    if (error) console.error('[SYNC] ❌ ranking:', error.message);
    else console.log(`[SYNC] ✅ ranking enviado (${linhas.length} jogadores).`);
  } catch (e) { console.error('[SYNC] ❌ ranking exceção:', e.message); }
}

// Sincroniza os jogos do dia → tabela jogos_bot
async function syncJogos(jogos) {
  if (!supabase) return;
  if (!jogos || !jogos.length) { console.log('[SYNC] sem jogos pra enviar.'); return; }
  try {
    const linhas = jogos.map(j => ({
      api_id: String(j.id),
      time_casa: j.casa,
      time_fora: j.fora,
      gols_casa: j.golsCasa,
      gols_fora: j.golsFora,
      status: j.status,
      hora: j.hora || null,
      atualizado_em: new Date().toISOString(),
    }));
    const { error } = await supabase.from('jogos_bot').upsert(linhas, { onConflict: 'api_id' });
    if (error) console.error('[SYNC] ❌ jogos:', error.message);
    else console.log(`[SYNC] ✅ jogos enviados (${linhas.length}).`);
  } catch (e) { console.error('[SYNC] ❌ jogos exceção:', e.message); }
}

// Salva um palpite individual → tabela palpites_bot
async function syncPalpite(discordId, nome, jogoId, golsCasa, golsFora) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from('palpites_bot').upsert({
      discord_id: String(discordId), nome,
      jogo_api_id: String(jogoId),
      palpite_casa: golsCasa, palpite_fora: golsFora,
      criado_em: new Date().toISOString(),
    }, { onConflict: 'discord_id,jogo_api_id' });
    if (error) console.error('[SYNC] ❌ palpite:', error.message);
    else console.log(`[SYNC] ✅ palpite salvo: ${nome} ${golsCasa}x${golsFora} jogo ${jogoId}`);
  } catch (e) { console.error('[SYNC] ❌ palpite exceção:', e.message); }
}

module.exports = { init, syncRanking, syncJogos, syncPalpite };
