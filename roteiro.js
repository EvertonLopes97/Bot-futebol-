// roteiro.js — Gera roteiro de vídeo de análise pronto pra postar
// Usa os jogos do dia + estatísticas reais pra montar um script de ~2min de fala.
// Pensado pra Nathan/Detto gravarem TikTok/Reels/Kick.

function fmtOdd(o) { return o ? Number(o).toFixed(2) : '—'; }

// Monta o roteiro completo do dia
async function gerarRoteiro(jogos, estat, dica) {
  if (!jogos || !jogos.length) {
    return '🎬 *ROTEIRO DO DIA*\n\nSem jogos relevantes hoje. Dia de descanso ou de planejar a próxima rodada!';
  }

  // ordena por relevância (jogos mais "quentes" primeiro)
  const ordenados = jogos
    .map(j => ({ ...j, score: dica.relevanciaJogo ? dica.relevanciaJogo(j) : 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3); // top 3 jogos do dia

  let r = `🎬 *ROTEIRO DE ANÁLISE — ${new Date().toLocaleDateString('pt-BR')}*\n`;
  r += `_Roteiro pronto pra gravar (TikTok/Reels/Kick). Tempo estimado: ~2min._\n\n`;

  // ── ABERTURA ──
  r += `━━━━━━━━━━━━━━━\n`;
  r += `📍 *ABERTURA (10s)*\n`;
  r += `"Fala, galera do Hub Lab! Hoje tem ${jogos.length} jogos e eu separei os ${ordenados.length} mais quentes pra vocês. Cola aqui que vou dar minha leitura de cada um e já solta o palpite no fim. Bora!"\n\n`;

  // ── ANÁLISE DE CADA JOGO ──
  let idx = 1;
  for (const j of ordenados) {
    r += `━━━━━━━━━━━━━━━\n`;
    r += `⚽ *JOGO ${idx}: ${j.casa} x ${j.fora}* (${j.hora || 'horário a confirmar'})\n\n`;

    let sc = null, sf = null;
    if (estat) {
      try { [sc, sf] = await Promise.all([estat.statsTime(j.casa), estat.statsTime(j.fora)]); } catch {}
    }

    // dados pra fala
    const oddCasa = j.melhor?.casa?.odd;
    const oddFora = j.melhor?.fora?.odd;
    const favorito = (oddCasa && oddCasa <= (oddFora || 99)) ? j.casa : j.fora;
    const oddFav = Math.min(oddCasa || 99, oddFora || 99);

    r += `🎙️ *Fala sugerida:*\n`;
    r += `"Olha esse ${j.casa} contra ${j.fora}. `;

    if (sc?.golsMarcadosMedia || sf?.golsMarcadosMedia) {
      const mgC = (sc?.golsMarcadosMedia || 1.2).toFixed(1);
      const mgF = (sf?.golsMarcadosMedia || 1.0).toFixed(1);
      r += `O ${j.casa} vem marcando ${mgC} gols por jogo, e o ${j.fora} ${mgF}. `;
    }
    if (sc?.artilheiro?.nome) {
      r += `Fica de olho no ${sc.artilheiro.nome}, artilheiro do ${j.casa} com ${sc.artilheiro.gols || 'vários'} gols. `;
    }
    if (oddFav && oddFav < 90) {
      r += `As casas pagam ${fmtOdd(oddFav)} no ${favorito}, ou seja, ${favorito} é o favorito mas não é moleza. `;
    }
    r += `Minha leitura: [DÊ SUA OPINIÃO AQUI]."\n\n`;

    // dados de apoio (bullet pra ter na tela)
    r += `📊 *Dados pra mostrar na tela:*\n`;
    if (sc?.golsMarcadosMedia) r += `• ${j.casa}: ${sc.golsMarcadosMedia.toFixed(1)} gols/jogo`;
    if (sc?.escanteiosMedia) r += ` | ${sc.escanteiosMedia.toFixed(1)} escanteios/jogo`;
    r += `\n`;
    if (sf?.golsMarcadosMedia) r += `• ${j.fora}: ${sf.golsMarcadosMedia.toFixed(1)} gols/jogo`;
    if (sf?.escanteiosMedia) r += ` | ${sf.escanteiosMedia.toFixed(1)} escanteios/jogo`;
    r += `\n`;
    if (oddCasa) r += `• Odd ${j.casa}: ${fmtOdd(oddCasa)} | Odd ${j.fora}: ${fmtOdd(oddFora)}\n`;
    r += `\n`;
    idx++;
  }

  // ── PALPITE DO DIA / MÚLTIPLA ──
  r += `━━━━━━━━━━━━━━━\n`;
  r += `🎯 *MÚLTIPLA DO DIA (pra fechar o vídeo)*\n\n`;
  if (estat && dica.montarMultiplasProntas) {
    try {
      const mults = await dica.montarMultiplasProntas(jogos, estat);
      if (mults && mults.length) {
        // pega a "equilibrada" pra sugerir no vídeo
        const m = mults[1] || mults[0];
        const desc = m.data?.description || '';
        r += `_Sugestão de múltipla equilibrada pra mostrar:_\n`;
        r += desc.replace(/\*\*/g, '').replace(/_/g, '') + '\n\n';
      }
    } catch {}
  }
  r += `🎙️ "E a minha múltipla do dia é essa aqui ó. Lembrando: é entretenimento, joga com responsabilidade, +18. Quem quiser palpitar e concorrer no nosso bolão, link na bio: hublab.agency. Tamo junto!"\n\n`;

  // ── ENCERRAMENTO ──
  r += `━━━━━━━━━━━━━━━\n`;
  r += `📍 *ENCERRAMENTO (10s)*\n`;
  r += `"Esse foi o resumo de hoje! Comenta aí qual seu palpite, segue o Hub Lab pra não perder nenhuma, e bora cravar esse exato. Até a próxima!"\n\n`;

  r += `━━━━━━━━━━━━━━━\n`;
  r += `💡 *Dicas de gravação:*\n`;
  r += `• Grava na vertical (9:16) pra TikTok/Reels\n`;
  r += `• Mostra os números na tela enquanto fala\n`;
  r += `• Corta os "[DÊ SUA OPINIÃO]" e coloca a sua leitura pessoal — é o que diferencia\n`;
  r += `• Posta antes das ${ordenados[0]?.hora || '16h'} pra pegar o pré-jogo\n`;

  return r;
}

module.exports = { gerarRoteiro };
