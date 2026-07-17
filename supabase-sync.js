// supabase-sync.js — Sincroniza dados do bot → tabelas estruturadas do Supabase
// Para o site ler ranking, jogos e palpites do MESMO lugar.
// LOGA cada operação (sucesso/erro) pra facilitar debug no Railway.

// Data "hoje" no fuso de São Paulo (AAAA-MM-DD) — usado em TODAS as tabelas
// pra o site e o bot sempre concordarem sobre qual é "hoje".
function hojeSP() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

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
    const hoje = hojeSP();
    const linhas = jogos
      // ignora jogos sem nome dos times (evita quebrar o insert com not-null)
      .filter(j => (j.casa || j.time_casa) && (j.fora || j.time_fora))
      .map(j => ({
        api_id: String(j.id),
        time_casa: j.casa || j.time_casa || 'A definir',
        time_fora: j.fora || j.time_fora || 'A definir',
        gols_casa: (j.golsCasa ?? j.gols_casa ?? null),
        gols_fora: (j.golsFora ?? j.gols_fora ?? null),
        penaltis_casa: (j.penaltisCasa ?? j.penaltis_casa ?? null),
        penaltis_fora: (j.penaltisFora ?? j.penaltis_fora ?? null),
        status: j.status || 'TIMED',
        hora: j.hora || null,
        data: (j.data || hoje),
        rodada: (j.rodada ?? null),
        competicao: (j.competicao || null),
        atualizado_em: new Date().toISOString(),
      }));
    if (!linhas.length) { console.log('[SYNC] ⚠️ nenhum jogo válido pra enviar (todos sem nome).'); return; }
    // remove só jogos que já PASSARAM (data anterior a hoje), mantém hoje + futuros
    await supabase.from('jogos_bot').delete().lt('data', hoje);
    const { error } = await supabase.from('jogos_bot').upsert(linhas, { onConflict: 'api_id' });
    if (error) console.error('[SYNC] ❌ jogos:', error.message);
    else console.log(`[SYNC] ✅ ${linhas.length} jogos enviados (hoje + próximos), passados removidos.`);
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

// Apura os palpites do SITE (palpites_bot) quando um jogo termina.
// Soma pontos num ranking PRÓPRIO DO SITE (ranking_site) — separado do Discord.
// Marca o palpite como apurado pra nunca contar duas vezes.
async function apurarPalpitesSite(jogoApiId, golsCasa, golsFora) {
  if (!supabase) return;
  try {
    const { data: palps } = await supabase.from('palpites_bot')
      .select('*').eq('jogo_api_id', String(jogoApiId)).or('apurado.is.null,apurado.eq.false');
    if (!palps || !palps.length) { console.log(`[APURAR-SITE] nenhum palpite pendente pro jogo ${jogoApiId}`); return; }

    for (const p of palps) {
      let pts = 1, tipo = 'participou';
      if (p.palpite_casa === golsCasa && p.palpite_fora === golsFora) { pts = 10; tipo = 'exato'; }
      else if (Math.sign(p.palpite_casa - p.palpite_fora) === Math.sign(golsCasa - golsFora)) { pts = 3; tipo = 'resultado'; }

      await supabase.from('palpites_bot').update({ apurado: true, pontos_ganhos: pts }).eq('id', p.id);

      // soma no RANKING DO SITE (ranking_site), casando por discord_id
      const { data: rk } = await supabase.from('ranking_site').select('*').eq('discord_id', String(p.discord_id)).maybeSingle();
      if (rk) {
        await supabase.from('ranking_site').update({
          nome: p.nome || rk.nome,
          pontos: (rk.pontos || 0) + pts,
          exatos: (rk.exatos || 0) + (tipo === 'exato' ? 1 : 0),
          participacoes: (rk.participacoes || 0) + 1,
          atualizado_em: new Date().toISOString(),
        }).eq('discord_id', String(p.discord_id));
      } else {
        await supabase.from('ranking_site').insert({
          discord_id: String(p.discord_id), nome: p.nome || 'Membro',
          pontos: pts, exatos: (tipo === 'exato' ? 1 : 0), participacoes: 1,
          atualizado_em: new Date().toISOString(),
        });
      }
    }
    console.log(`[APURAR-SITE] ✅ ${palps.length} palpite(s) do site apurados (ranking_site) pro jogo ${jogoApiId}`);
  } catch (e) { console.error('[APURAR-SITE] ❌', e.message); }
}


// Chave única do bolão: UMA POR COMPETIÇÃO + RODADA.
// Brasileirão 15ª rodada → "Brasileirão Série A|R15"
// Libertadores quartas   → "Copa Libertadores|Quarter-finals"
function chaveBolao(jogo) {
  const comp = jogo.competicao || 'Outra';
  const ident = jogo.rodada != null ? `R${jogo.rodada}` : (jogo.fase || jogo.data);
  return `${comp}|${ident}`;
}

async function definirBolaoRodada(jogo) {
  if (!supabase) return null;
  try {
    const chave = chaveBolao(jogo);
    const { data: resultado, error } = await supabase.from('bolao_exato').upsert({
      chave,
      competicao: jogo.competicao || null,
      rodada: jogo.rodada ?? null,
      fase: jogo.fase || null,
      data: jogo.data,
      hora: jogo.hora || null,
      jogo_api_id: String(jogo.id),
      time_casa: jogo.casa,
      time_fora: jogo.fora,
    }, { onConflict: 'chave' }).select().single();
    if (error) { console.error('[EXATO] ❌ definir:', error.message); return null; }
    console.log(`[EXATO] ✅ bolão [${chave}]: ${jogo.casa} x ${jogo.fora} — ${jogo.data} ${jogo.hora || ''}`);
    return resultado;
  } catch (e) { console.error('[EXATO] ❌ exceção:', e.message); return null; }
}

// Salva palpite no bolão exato
async function salvarPalpiteExato(bolaoId, discordId, nome, gc, gf) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from('palpites_exato').upsert({
      bolao_id: bolaoId, discord_id: String(discordId), nome,
      palpite_casa: gc, palpite_fora: gf,
    }, { onConflict: 'bolao_id,discord_id' });
    if (error) console.error('[EXATO] ❌ palpite:', error.message);
    else console.log(`[EXATO] ✅ palpite exato: ${nome} ${gc}x${gf}`);
  } catch (e) { console.error('[EXATO] ❌ palpite exceção:', e.message); }
}

// Quando o jogo do bolão acaba: marca quem cravou e atualiza o "rei do exato"
async function apurarBolaoExato(jogoApiId, golsCasa, golsFora) {
  if (!supabase) return [];
  try {
    const { data: bolao } = await supabase.from('bolao_exato')
      .select('*').eq('jogo_api_id', String(jogoApiId)).maybeSingle();
    if (!bolao || bolao.encerrado) return [];

    await supabase.from('bolao_exato').update({
      gols_casa: golsCasa, gols_fora: golsFora, encerrado: true,
    }).eq('id', bolao.id);

    const { data: palps } = await supabase.from('palpites_exato')
      .select('*').eq('bolao_id', bolao.id);
    const cravaram = (palps || []).filter(p => p.palpite_casa === golsCasa && p.palpite_fora === golsFora);

    for (const c of cravaram) {
      await supabase.from('palpites_exato').update({ cravou: true }).eq('id', c.id);
      // soma os 10 pontos do exato no ranking do site (se o palpite tem discord_id)
      if (c.discord_id) {
        const { data: rk } = await supabase.from('ranking_site').select('*').eq('discord_id', String(c.discord_id)).maybeSingle();
        if (rk) {
          await supabase.from('ranking_site').update({
            pontos: (rk.pontos || 0) + 10, exatos: (rk.exatos || 0) + 1,
            atualizado_em: new Date().toISOString(),
          }).eq('discord_id', String(c.discord_id));
        } else {
          await supabase.from('ranking_site').insert({
            discord_id: String(c.discord_id), nome: c.nome || 'Membro',
            pontos: 10, exatos: 1, participacoes: 1, atualizado_em: new Date().toISOString(),
          });
        }
      }
    }
    // atualiza o rei do exato (último que cravou vira destaque)
    if (cravaram.length) {
      const rei = cravaram[cravaram.length - 1];
      await supabase.from('rei_do_exato').upsert({
        id: 1, nome: rei.nome,
        jogo: `${bolao.time_casa} x ${bolao.time_fora}`,
        placar: `${golsCasa}x${golsFora}`,
        data_craque: new Date().toISOString(),
      });
      console.log(`[EXATO] 👑 novo rei do exato: ${rei.nome} cravou ${golsCasa}x${golsFora}`);
    } else {
      console.log('[EXATO] ninguém cravou o exato dessa vez.');
    }
    return cravaram;
  } catch (e) { console.error('[EXATO] ❌ apurar:', e.message); return []; }
}

// Salva uma odd GREEN (fixa até o dia seguinte)
async function salvarGreen(descricao, odd, jogo) {
  if (!supabase) return;
  try {
    const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
    const { error } = await supabase.from('odds_green').insert({
      descricao, odd, jogo,
      fixado_ate: amanha.toISOString().split('T')[0],
    });
    if (error) console.error('[GREEN] ❌', error.message);
    else console.log(`[GREEN] ✅ green salvo: ${descricao} @ ${odd}`);
  } catch (e) { console.error('[GREEN] ❌ exceção:', e.message); }
}


// Salva/atualiza o status da live (controlado por /live no Discord)
async function setLiveStatus({ ativa, plataforma, canal }) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from('live_status').upsert({
      id: 1, ativa, plataforma, canal,
      atualizado_em: new Date().toISOString(),
    });
    if (error) console.error('[SYNC] ❌ live_status:', error.message);
    else console.log(`[SYNC] ✅ live status: ${ativa ? 'AO VIVO' : 'offline'} (${plataforma}: ${canal})`);
  } catch (e) { console.error('[SYNC] ❌ live exceção:', e.message); }
}

module.exports = { init, syncRanking, syncJogos, syncPalpite, definirBolaoRodada, salvarPalpiteExato, apurarBolaoExato, apurarPalpitesSite, salvarGreen, salvarOddsDoDia, marcarGreen, setLiveStatus };

// Salva as odds do dia no Supabase (ficam ativas até meia-noite)
async function salvarOddsDoDia(odds) {
  if (!supabase || !odds || !odds.length) return;
  try {
    const hoje = hojeSP();
    // limpa as do dia anterior e salva as novas
    await supabase.from('odds_dia').delete().lt('data', hoje);
    const linhas = odds.map(j => ({
      data: hoje,
      jogo: `${j.casa} x ${j.fora}`,
      favorito: j.melhor.casa.odd <= (j.melhor.fora.odd||99) ? j.casa : j.fora,
      odd_favorito: Math.min(j.melhor.casa.odd||99, j.melhor.fora.odd||99),
      odd_casa: j.melhor.casa.odd, odd_fora: j.melhor.fora.odd,
      odd_empate: j.melhor.empate?.odd || null,
      odd_over25: j.melhor.over25?.odd || null,
      odd_under25: j.melhor.under25?.odd || null,
      odd_ambas_sim: j.melhor.ambasSim?.odd || null,
      book: j.melhor.casa.book || j.melhor.fora.book,
      green: false,
    }));
    const { error } = await supabase.from('odds_dia').upsert(linhas, { onConflict: 'data,jogo' });
    if (error) console.error('[SYNC] ❌ odds_dia:', error.message);
    else console.log(`[SYNC] ✅ ${linhas.length} odds do dia salvas.`);
  } catch (e) { console.error('[SYNC] ❌ odds_dia exceção:', e.message); }
}

// Marca uma odd como green
async function marcarGreen(jogo, descricao, odd) {
  if (!supabase) return;
  try {
    const hoje = hojeSP();
    await supabase.from('odds_dia').update({ green: true }).eq('data', hoje).eq('jogo', jogo);
    // também salva na tabela de histórico de greens
    const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
    await supabase.from('odds_green').insert({ descricao, odd, jogo, fixado_ate: amanha.toISOString().split('T')[0] });
    console.log(`[SYNC] ✅ green marcado: ${jogo}`);
  } catch (e) { console.error('[SYNC] ❌ green:', e.message); }
}
