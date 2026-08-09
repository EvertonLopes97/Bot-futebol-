// =====================================================================
// roteiro-ia.js — Gera o roteiro do vídeo a partir das notícias do dia
//
// USA A GROQ (grátis, sem cartão): https://console.groq.com
// Free tier: 1.000 requisições/dia e ~200 mil tokens/dia. Você usa 2 por
// dia. Sobra MUITO.
//
// COMO PEGAR A CHAVE:
//   1. console.groq.com → cria conta (Google/GitHub)
//   2. API Keys → Create API Key
//   3. copia e põe no .env:  GROQ_API_KEY=gsk_...
//
// SEM A CHAVE o módulo não quebra: ele devolve a pauta simples do
// noticias.js (manchetes + estrutura), que já funciona.
//
// ⚠️ SOBRE O TEXTO GERADO:
//   A IA escreve a partir das MANCHETES (fatos públicos), não copia
//   matéria de portal. Mas leia antes de gravar: ela pode errar detalhe,
//   e o roteiro é ponto de partida — a sua opinião é o que diferencia
//   o canal. Ler texto de IA na íntegra soa genérico e o público sente.
// =====================================================================

const noticias = require('./noticias.js');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELO = process.env.GROQ_MODELO || 'llama-3.3-70b-versatile';
const MODELO_FALLBACK = 'llama-3.1-8b-instant';

function temChave() { return Boolean(process.env.GROQ_API_KEY); }

async function chamarGroq(mensagens, { modelo = MODELO, maxTokens = 2000 } = {}) {
  const chave = process.env.GROQ_API_KEY;
  if (!chave) return null;

  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
      body: JSON.stringify({
        model: modelo,
        messages: mensagens,
        temperature: 0.8,      // criativo, mas não viajando
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (r.status === 429) {
      console.log('[ROTEIRO-IA] limite atingido, tentando modelo menor...');
      if (modelo !== MODELO_FALLBACK) {
        return chamarGroq(mensagens, { modelo: MODELO_FALLBACK, maxTokens });
      }
      return null;
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.log(`[ROTEIRO-IA] HTTP ${r.status}: ${t.slice(0, 200)}`);
      return null;
    }

    const j = await r.json();
    return j.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.log('[ROTEIRO-IA] erro:', e.message);
    return null;
  }
}

// ── O prompt: é aqui que mora a qualidade ─────────────────────────────
const PERSONA = `Você é roteirista de um canal brasileiro de futebol chamado Hub Lab.
O apresentador é jovem, fala de forma direta e informal, com gíria de torcedor,
sem ser caricato. O canal é "futebol sem clubismo": analisa todos os times,
provoca com bom humor, mas não ofende torcida.

REGRAS DO ROTEIRO:
- Português do Brasil, linguagem falada (é pra LER em voz alta, não pra ler na tela)
- Frases curtas. Nada de parágrafo comprido.
- Nunca invente estatística, número, placar ou declaração. Só use o que está nas manchetes.
- Se não souber um detalhe, fale de forma genérica em vez de inventar.
- Não copie texto de matéria. Escreva com palavras próprias, opinativas.
- Cada bloco tem que ter uma OPINIÃO clara, não só o relato do fato.
- Termine sempre chamando pro Discord do Hub Lab.`;

// ── Formato MONETIZÁVEL (TikTok Creator Rewards) ──────────────────────
// Vídeos com MENOS de 1 minuto NÃO são elegíveis ao programa.
// Vídeos de 1 a 3 minutos têm multiplicador MAIOR de receita.
// Por isso este formato mira 90-150 segundos: passa do mínimo com folga
// e entra na faixa premiada.
function promptMonetizavel(lista) {
  const manchetes = lista.slice(0, 6).map((n, i) =>
    `${i + 1}. [${n.clubes.join(', ')}] ${n.titulo}`).join('\n');

  return [
    { role: 'system', content: PERSONA },
    { role: 'user', content:
`Monte o roteiro de um vídeo de 90 a 150 SEGUNDOS (1min30 a 2min30) pra
TikTok. É formato monetizável: precisa passar de 1 minuto e segurar a
atenção até o fim, porque o pagamento leva em conta o tempo assistido.

MANCHETES DE HOJE:
${manchetes}

REGRAS DESSE FORMATO:
- Tem que ter MOTIVO pra pessoa ficar até o fim (deixe a informação mais
  forte pro final, e avise no começo que ela vem)
- A cada ~20 segundos, um mini-gancho ("mas calma que tem mais", "e o
  pior nem é isso")
- Nada de enrolar pra encher tempo: cada frase entrega algo

FORMATO DA RESPOSTA:

🎬 TÍTULO: (até 60 caracteres)

⏱️ 0-8s — GANCHO + PROMESSA
(Fisga E avisa o que vem no fim. Ex: "e no final eu te conto qual time
saiu no prejuízo")

⏱️ 8-40s — BLOCO 1
(A primeira notícia, com contexto e opinião)

⏱️ 40-45s — MINI-GANCHO
(Uma frase que segura: "mas isso não é nem o mais estranho")

⏱️ 45-90s — BLOCO 2 e 3
(As outras notícias, comentadas)

⏱️ 90-120s — O QUE FOI PROMETIDO
(Entregue o que você prometeu no gancho. É aqui que a retenção se paga.)

⏱️ 120-150s — FECHO
(Pergunta pro público + chamada pro Discord do Hub Lab)

📌 LEGENDA + 5 HASHTAGS` }
  ];
}

// ── Formato CURIOSIDADE / COMPARAÇÃO ──────────────────────────────────
// Ex: "Galo 2021 x Fluminense 2026", "onde estão os campeões de tal ano".
// Esse tipo rende muito porque mistura nostalgia + discussão de torcida.
function promptCuriosidade(tema, dados = '') {
  return [
    { role: 'system', content: PERSONA },
    { role: 'user', content:
`Monte o roteiro de um vídeo de CURIOSIDADE/COMPARAÇÃO de 90 a 150
segundos pra TikTok (formato monetizável, precisa passar de 1 minuto).

TEMA: ${tema}

${dados ? `DADOS CONFIRMADOS (use SÓ estes, não invente outros):\n${dados}\n` : ''}

REGRAS CRÍTICAS:
- NUNCA invente número, ano, título, estatística ou nome de jogador
- Se precisar de um dado que não está acima, escreva [CONFERIR: o que
  precisa checar] no lugar — o apresentador confirma antes de gravar
- Comparação de time gera briga de torcida: provoque com bom humor, sem
  desmerecer

FORMATO DA RESPOSTA:

🎬 TÍTULO: (até 60 caracteres, com o gancho da comparação)

⏱️ 0-8s — GANCHO
(A pergunta que faz parar o scroll. Ex: "esse time seria campeão hoje?")

⏱️ 8-50s — LADO A
(Apresente o primeiro time/jogador/época com os dados)

⏱️ 50-55s — VIRADA
("agora olha o outro lado")

⏱️ 55-110s — LADO B
(O segundo, comparando ponto a ponto)

⏱️ 110-140s — VEREDITO
(Sua opinião crava um lado. Sem cima do muro — é isso que gera comentário.)

⏱️ 140-150s — FECHO
(Joga a pergunta pro público + chamada pro Discord)

📌 LEGENDA + 5 HASHTAGS
⚠️ CONFERIR ANTES DE GRAVAR: (liste todos os dados que o apresentador
precisa confirmar)` }
  ];
}

function promptManha(lista) {
  const manchetes = lista.slice(0, 5).map((n, i) =>
    `${i + 1}. [${n.clubes.join(', ')}] ${n.titulo}`).join('\n');

  return [
    { role: 'system', content: PERSONA },
    { role: 'user', content:
`Monte o roteiro de um vídeo CURTO (60 a 90 segundos) de manhã, formato vertical
pra TikTok/Reels/Shorts, com as notícias de hoje.

MANCHETES DE HOJE:
${manchetes}

FORMATO DA RESPOSTA (siga exatamente):

🎬 TÍTULO SUGERIDO: (uma linha chamativa, até 60 caracteres)

⏱️ GANCHO (0-5s):
(2 frases no máximo. Tem que fazer parar o scroll. Comece pela notícia mais forte.)

⏱️ CORPO (5-60s):
(Passe pelas 3 notícias mais fortes. Para cada uma: o fato em 1 frase + sua opinião em 1 frase.
Separe cada notícia com uma quebra de linha.)

⏱️ FECHO (60-90s):
(Uma provocação/pergunta pro público comentar + chamada pro Discord do Hub Lab.)

📌 LEGENDA DO POST:
(2 linhas + 5 hashtags brasileiras de futebol)` }
  ];
}

function promptNoite(lista, jogos = []) {
  const manchetes = lista.slice(0, 6).map((n, i) =>
    `${i + 1}. [${n.clubes.join(', ')}] ${n.titulo}`).join('\n');
  const linhaJogos = jogos.length
    ? `\nJOGOS DE HOJE: ${jogos.map(j => `${j.casa} x ${j.fora}`).join(' · ')}`
    : '';

  return [
    { role: 'system', content: PERSONA },
    { role: 'user', content:
`Monte o roteiro de um vídeo de ANÁLISE da noite (3 a 5 minutos), formato horizontal
pro YouTube. É o fechamento do dia: o que rolou e o que esperar.

MANCHETES DE HOJE:
${manchetes}${linhaJogos}

FORMATO DA RESPOSTA (siga exatamente):

🎬 TÍTULO SUGERIDO: (chamativo, até 70 caracteres, bom pra clique sem ser mentira)

⏱️ ABERTURA (0-20s):
(Cumprimento rápido + o que vem no vídeo. Dê o motivo pra ficar até o fim.)

⏱️ BLOCO 1 — a mais quente (20s-1min30):
(Contexto + sua análise. Termine com uma opinião cravada.)

⏱️ BLOCO 2 — mercado/bastidor (1min30-3min):
(Duas ou três notícias menores, comentadas.)

⏱️ BLOCO 3 — o que esperar (3min-4min):
(O que fica pra amanhã/próxima rodada.)

⏱️ FECHO (4min-5min):
(Pergunta pro público + chamada pro Discord + pedido de inscrição.)

📌 DESCRIÇÃO DO VÍDEO:
(3 linhas + os links: Discord e site hublab.agency)

🏷️ TAGS: (10 tags separadas por vírgula)` }
  ];
}

// ── Geração ───────────────────────────────────────────────────────────
async function gerarRoteiro({ periodo = 'manha', jogos = [], tema = '', dados = '' } = {}) {
  // Curiosidade/comparação não depende de notícia do dia — usa o tema dado
  if (periodo === 'curiosidade') {
    if (!tema) return { erro: 'Informe o tema da comparação (ex: "Galo 2021 x Fluminense 2026").' };
    if (!temChave()) return { erro: 'Precisa da GROQ_API_KEY pra gerar curiosidade. Pegue grátis em console.groq.com' };
    const texto = await chamarGroq(promptCuriosidade(tema, dados), { maxTokens: 2000 });
    if (!texto) return { erro: 'A IA não respondeu. Tenta de novo em instantes.' };
    return { texto, periodo, tema };
  }

  const lista = await noticias.buscarNoticias({ apenasNovas: false, minScore: 5 });
  if (!lista.length) return { erro: 'Sem notícias relevantes agora.' };

  // Sem chave da Groq: devolve a pauta simples (não quebra)
  if (!temChave()) {
    const p = noticias.montarPauta(lista);
    return {
      semIA: true,
      texto: `${p.linhas}\n\n${p.roteiro}\n\n` +
             `💡 *Quer o roteiro completo escrito? Configure GROQ_API_KEY no .env (grátis em console.groq.com)*`,
      noticias: lista.slice(0, 5),
    };
  }

  let mensagens, tokens;
  if (periodo === 'noite')            { mensagens = promptNoite(lista, jogos); tokens = 2500; }
  else if (periodo === 'monetizavel') { mensagens = promptMonetizavel(lista);  tokens = 2000; }
  else                                { mensagens = promptManha(lista);        tokens = 1200; }

  const texto = await chamarGroq(mensagens, { maxTokens: tokens });

  if (!texto) {
    const p = noticias.montarPauta(lista);
    return { semIA: true, texto: `${p.linhas}\n\n${p.roteiro}\n\n⚠️ *A IA não respondeu; segue a pauta simples.*`, noticias: lista.slice(0, 5) };
  }

  return { texto, noticias: lista.slice(0, 5), periodo };
}

// ── Envio pro Discord (quebra em pedaços de 1900 chars) ───────────────
async function enviarRoteiro(canal, resultado, periodo) {
  if (!canal?.isTextBased?.()) return false;

  const CABECALHOS = {
    noite:       '🌙 **ROTEIRO DA NOITE** — vídeo de análise (YouTube)\n',
    monetizavel: '💰 **ROTEIRO MONETIZÁVEL** — 90-150s (TikTok Creator Rewards)\n',
    curiosidade: '🔍 **CURIOSIDADE / COMPARAÇÃO** — 90-150s (monetizável)\n',
    manha:       '☀️ **ROTEIRO DA MANHÃ** — vídeo curto (TikTok/Reels/Shorts)\n',
  };
  const cabecalho = CABECALHOS[periodo] || CABECALHOS.manha;

  const rodape = '\n\n📎 *Fontes das notícias no canal de pauta. Confira os fatos antes de gravar.*';
  const texto = cabecalho + resultado.texto + rodape;

  for (let i = 0; i < texto.length; i += 1900) {
    await canal.send(texto.slice(i, i + 1900)).catch(() => {});
    await new Promise(r => setTimeout(r, 400));
  }
  return true;
}

module.exports = { gerarRoteiro, enviarRoteiro, temChave, chamarGroq, promptCuriosidade, promptMonetizavel };
