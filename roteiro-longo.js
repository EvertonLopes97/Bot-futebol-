// =====================================================================
// roteiro-longo.js — Dois roteiros de 8+ minutos por dia, prontos pra ler
//
// O QUE MUDA em relação ao roteiro-ia.js:
//   - Texto CORRIDO pra ler na frente da câmera (não são tópicos)
//   - 8 a 12 minutos de vídeo (1500-2200 palavras)
//   - Gerado EM BLOCOS e juntado — modelo não entrega 2000 palavras de
//     uma vez, então pedimos parte por parte e costuramos
//   - Notícia não usada ACUMULA pro dia seguinte
//
// DOIS ROTEIROS DIÁRIOS:
//   1. NOTÍCIAS / RESUMO DA RODADA (noite)
//   2. CURIOSIDADE (todo dia, tema rotativo)
// =====================================================================

const fs = require('fs');
const path = require('path');
const noticias = require('./noticias.js');
const roteiroIA = require('./roteiro-ia.js');
const pesquisa = require('./pesquisa.js');   // apura fatos antes de escrever

const DIR = process.env.DATA_DIR || __dirname;
const ACUMULO = path.join(DIR, 'noticias-acumuladas.json');

// ── Acúmulo: notícia que não virou vídeo fica pro dia seguinte ────────
function lerAcumulo() {
  try { return JSON.parse(fs.readFileSync(ACUMULO, 'utf8')); }
  catch { return { pendentes: [], ultimoVideo: null }; }
}
function salvarAcumulo(d) {
  try {
    // guarda no máximo 25 pendentes (2-3 dias de notícia)
    d.pendentes = d.pendentes.slice(-25);
    fs.writeFileSync(ACUMULO, JSON.stringify(d, null, 2));
  } catch (e) { console.error('[ROTEIRO-LONGO] salvar:', e.message); }
}

// Guarda as notícias que NÃO entraram no vídeo de hoje
function acumular(naoUsadas) {
  const d = lerAcumulo();
  const links = new Set(d.pendentes.map(p => p.link));
  for (const n of naoUsadas) {
    if (!links.has(n.link)) d.pendentes.push({
      titulo: n.titulo, link: n.link, clubes: n.clubes,
      fonte: n.fonte, tags: n.tags, score: n.score, em: Date.now(),
    });
  }
  salvarAcumulo(d);
  return d.pendentes.length;
}

// Marca que o vídeo foi feito e limpa o que foi usado
function marcarVideoFeito(usadas) {
  const d = lerAcumulo();
  const usados = new Set(usadas.map(u => u.link));
  d.pendentes = d.pendentes.filter(p => !usados.has(p.link));
  d.ultimoVideo = new Date().toISOString();
  salvarAcumulo(d);
}

// Junta o que acumulou + o que é novo, sem repetir
async function noticiasDoVideo(quantidade = 8) {
  const d = lerAcumulo();
  const frescas = await noticias.buscarNoticias({ apenasNovas: false, minScore: 5 });

  const vistos = new Set();
  const juntas = [];

  // acumuladas primeiro (são as que ficaram esperando)
  for (const p of d.pendentes) {
    if (!vistos.has(p.link)) { vistos.add(p.link); juntas.push({ ...p, acumulada: true }); }
  }
  for (const n of frescas) {
    if (!vistos.has(n.link)) { vistos.add(n.link); juntas.push(n); }
  }

  juntas.sort((a, b) => (b.score || 0) - (a.score || 0));
  return {
    usar: juntas.slice(0, quantidade),
    sobra: juntas.slice(quantidade),
    totalAcumulado: d.pendentes.length,
  };
}

// ── PERSONA ───────────────────────────────────────────────────────────
const PERSONA_LONGO = `Você é roteirista do canal Detto TV, de futebol brasileiro.

O apresentador lê o roteiro OLHANDO PRA CÂMERA, então o texto precisa ser
FALADO, não escrito. Nada de "conforme mencionado" ou "vale ressaltar".

COMO ESCREVER:
- Português do Brasil falado, informal, com gíria de torcedor
- Frases curtas. Ritmo. O cara lê rápido.
- Escreva o texto COMPLETO, palavra por palavra — ele vai LER isso
- NÃO use marcadores, tópicos ou bullet points no meio da fala
- NÃO escreva "[dê sua opinião aqui]" — VOCÊ escreve a opinião
- Cada assunto precisa de uma OPINIÃO cravada, não só o relato
- "Futebol sem clubismo": provoca todo mundo, não humilha ninguém

═══ REGRAS DE PRECISÃO — AS MAIS IMPORTANTES ═══

1. SEMPRE CITE NOMES. Nome do jogador, do time, do técnico. Falar "um
   jogador jovem" ou "dois gigantes europeus" é PROIBIDO. Se o nome está
   na informação que te dei, USE. Se NÃO está, escreva assim:
   [CONFERIR NOME] — e o apresentador preenche antes de gravar.

2. NUNCA INVENTE: estatística, placar, ano, valor, data, declaração,
   nome de jogador ou história. Se você não tem o dado, NÃO ESCREVA
   sobre ele. Prefira falar menos e certo do que muito e errado.

3. PROIBIDO inventar história ou fato histórico. Se o tema pede um caso
   histórico e você não tem certeza absoluta, escreva:
   [CONFERIR: preciso do fato X] em vez de criar uma versão.

4. Se a notícia que te dei é vaga (não diz o nome, não diz o valor),
   COMENTE ESSA VAGUIDADE em vez de preencher com invenção. Exemplo:
   "e olha que curioso, nem divulgaram o nome do garoto ainda".

5. NÃO ENCHA LINGUIÇA. Texto genérico do tipo "é uma decisão difícil,
   por um lado... por outro lado..." é lixo. Cada frase precisa
   entregar informação ou opinião concreta.

Não escreva marcações de tempo, nem "(pausa)", nem instruções de câmera.
Só o texto pra falar.`;

// ── Roteiro de NOTÍCIAS (em 3 blocos pra dar tamanho) ─────────────────
function blocosNoticias(lista, jogos = []) {
  // Manda TÍTULO + RESUMO. Sem o resumo a IA só tem a manchete e inventa
  // o resto (foi o que gerou "218 milhões" sem nome de jogador).
  const manchetes = lista.map((n, i) =>
    `${i + 1}. [${n.clubes.join(', ')}] ${n.titulo}\n` +
    `   RESUMO DA MATÉRIA: ${(n.resumo || '(o portal não deu resumo)').slice(0, 400)}`
  ).join('\n\n');
  const linhaJogos = jogos.length
    ? `\nJOGOS: ${jogos.map(j => `${j.casa} ${j.golsCasa ?? ''}x${j.golsFora ?? ''} ${j.fora}`).join(' · ')}`
    : '';

  return [
    // BLOCO 1 — abertura + primeiro assunto
    { rotulo: 'abertura', tokens: 1800, msg:
`Escreva a ABERTURA e o PRIMEIRO BLOCO de um vídeo de futebol de 8 a 12 minutos.

NOTÍCIAS DE HOJE:
${manchetes}${linhaJogos}

Escreva, em texto corrido pra ler na câmera:

1) ABERTURA (uns 150 palavras): cumprimento, o que vem no vídeo, e um
motivo forte pra pessoa ficar até o fim.

2) PRIMEIRO ASSUNTO (uns 400 palavras): pegue a notícia MAIS FORTE da
lista. Conte o que aconteceu, dê contexto, e crave sua opinião.

Escreva APENAS o texto falado. Sem títulos, sem marcações.` },

    // BLOCO 2 — miolo
    { rotulo: 'miolo', tokens: 2200, msg:
`Continue o MESMO vídeo. Agora o MIOLO (uns 700 palavras).

NOTÍCIAS DISPONÍVEIS:
${manchetes}${linhaJogos}

Pegue de 3 a 4 notícias (pule a primeira da lista, que já foi usada) e
comente uma a uma. Para cada: o que rolou, por que importa, e sua
opinião. Faça a transição entre elas de forma natural, como quem conversa.

Escreva APENAS o texto falado, continuando de onde parou.` },

    // BLOCO 3 — fecho
    { rotulo: 'fecho', tokens: 1400, msg:
`Termine o MESMO vídeo (uns 350 palavras).

NOTÍCIAS: ${manchetes}${linhaJogos}

Escreva:
1) Um último assunto rápido (o que sobrou de interessante)
2) O que esperar dos próximos dias
3) Fecho: pergunta pro público comentar + chamada pro Discord do Hub Lab
   (hublab.agency) + pedido de inscrição no canal

Escreva APENAS o texto falado.` },
  ];
}

// ── Roteiro de CURIOSIDADE ────────────────────────────────────────────
//
// ⚠️ MUDANÇA IMPORTANTE: os temas antigos eram históricos ("as maiores
// viradas", "clássicos que nasceram de rivalidades inesperadas"). A IA
// NÃO SABE essas histórias e inventava — chegou a criar uma origem falsa
// pro clássico Atlético x Cruzeiro.
//
// Agora os temas são ANCORADOS NO PRESENTE: coisas que dá pra checar na
// API ou que saem das notícias do dia. E todo tema histórico exige que
// VOCÊ passe os dados no campo `dados`.
const TEMAS_CURIOSIDADE = [
  'A rodada que passou: o que os números dizem que a narração não disse',
  'Os jogadores mais decisivos do Brasileirão até aqui',
  'Quem está salvando e quem está afundando seu time nesta temporada',
  'O elenco mais caro x o elenco que mais rende: vale o investimento?',
  'Os times que mais mudaram de treinador e o que isso custou',
  'A briga pelo Z4: quem tem o calendário mais fácil até o fim',
  'Reforços que chegaram e ainda não justificaram o preço',
  'As zebras da rodada e o que elas mudam na tabela',
];

// Temas HISTÓRICOS só entram se você fornecer os dados, porque a IA
// inventaria. Use assim: /videocuriosidade tema:... dados:...
const TEMAS_QUE_EXIGEM_DADOS = /hist[óo]ri|antigament|d[ée]cada|anos \d{2}|origem d|nasceu|primeiro t[íi]tulo|maiores? vice|lend[áa]ri/i;

function temaDoDia() {
  // roda o tema pelo dia do ano, então não repete por 12 dias
  const dia = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return TEMAS_CURIOSIDADE[dia % TEMAS_CURIOSIDADE.length];
}

function blocosCuriosidade(tema, dados = '', contexto = '') {
  const exigeDados = TEMAS_QUE_EXIGEM_DADOS.test(tema);

  const base = `TEMA: ${tema}

${dados ? `DADOS CONFIRMADOS (use SOMENTE estes fatos):\n${dados}\n` : ''}
${contexto ? `CONTEXTO ATUAL (notícias e jogos reais de agora):\n${contexto}\n` : ''}

═══ REGRA ABSOLUTA ═══
${exigeDados && !dados
  ? `Este tema pede fatos históricos que você NÃO TEM. NÃO INVENTE.
Escreva o roteiro deixando [CONFERIR: qual fato] em cada ponto que
precisa de dado histórico, e foque no que dá pra falar com segurança.`
  : `Só cite nome, ano, número ou fato que esteja escrito acima.
Para qualquer outro, escreva [CONFERIR: o quê] no lugar.`}

NUNCA:
- Invente história de origem de clássico, rivalidade ou clube
- Diga "um jogador", "um time grande", "dois gigantes" — CITE O NOME
- Escreva parágrafo genérico do tipo "é uma decisão difícil, por um lado..."

SEMPRE:
- Nome completo dos times e jogadores em cada bloco
- Se não tiver o dado, ADMITA isso no texto (fica mais honesto e o
  público valoriza) ou marque [CONFERIR]`;

  return [
    { rotulo: 'abertura', tokens: 1800, msg:
`Escreva a ABERTURA e o PRIMEIRO BLOCO de um vídeo de curiosidades de
futebol de 8 a 12 minutos.

${base}

1) ABERTURA (uns 150 palavras): um gancho que prenda, e a promessa do
que vem no vídeo.
2) PRIMEIRO CASO (uns 400 palavras): o mais forte do tema, contado como
história — com começo, meio e fim.

Escreva APENAS o texto falado, sem marcações.` },

    { rotulo: 'miolo', tokens: 2200, msg:
`Continue o MESMO vídeo. MIOLO (uns 700 palavras).

${base}

Traga mais 3 ou 4 casos/exemplos do tema, um a um, com transição natural.
Cada um com sua opinião ao fim.

⚠️ CITE O NOME DE CADA TIME E JOGADOR que mencionar. Não escreva "o
outro time" nem "esse clube" sem antes dizer qual é.

Escreva APENAS o texto falado.` },

    { rotulo: 'fecho', tokens: 1400, msg:
`Termine o MESMO vídeo (uns 350 palavras).

${base}

1) O caso mais surpreendente de todos (guarde o melhor pro fim)
2) Uma reflexão sobre o tema
3) Fecho: pergunta pro público + chamada pro Discord (hublab.agency) +
   pedido de inscrição

Escreva APENAS o texto falado.` },
  ];
}

// ── Geração em blocos ─────────────────────────────────────────────────
async function gerarEmBlocos(blocos, contextoInicial) {
  const partes = [];
  let historico = [
    { role: 'system', content: PERSONA_LONGO },
  ];

  for (const b of blocos) {
    historico.push({ role: 'user', content: b.msg });
    const texto = await roteiroIA.chamarGroq(historico, { maxTokens: b.tokens });
    if (!texto) {
      console.log(`[ROTEIRO-LONGO] bloco "${b.rotulo}" falhou`);
      continue;
    }
    partes.push(texto.trim());
    // mantém o contexto pra continuidade, mas resumido (economiza token)
    historico.push({ role: 'assistant', content: texto.slice(-800) });
    await new Promise(r => setTimeout(r, 1500)); // respeita rate limit
  }

  return partes.join('\n\n');
}

// ── REVISÃO AUTOMÁTICA — pega os vícios antes de você ler ─────────────
// Não substitui sua conferência, mas avisa dos problemas mais comuns.
function revisar(texto) {
  const avisos = [];
  const t = String(texto || '');

  const conferir = (t.match(/\[CONFERIR[^\]]*\]/gi) || []);
  if (conferir.length) {
    avisos.push(`⚠️ ${conferir.length} ponto(s) marcado(s) como [CONFERIR] — preencha antes de gravar`);
  }

  // frases vagas que indicam que a IA não tinha o dado
  const vagas = [
    [/\bum jogador (jovem|promissor|talentoso)\b/gi, 'diz "um jogador" sem citar o nome'],
    [/\bdois gigantes\b/gi, 'diz "dois gigantes" sem citar quais'],
    [/\bum time (grande|gigante)\b/gi, 'diz "um time grande" sem nome'],
    [/\besse (clube|time)\b(?![^.]*\b[A-ZÁÉÍÓÚ])/g, 'usa "esse time" sem nome próximo'],
    [/por um lado[^.]*por outro lado/gi, 'parágrafo genérico "por um lado... por outro"'],
    [/é uma decisão difícil/gi, 'frase de encher linguiça'],
  ];
  for (const [re, desc] of vagas) {
    const n = (t.match(re) || []).length;
    if (n) avisos.push(`⚠️ ${desc} (${n}x)`);
  }

  const palavras = contarPalavras(t);
  if (palavras < 1300) avisos.push(`⚠️ Curto: ${palavras} palavras (~${minutosDeFala(palavras)} min). Rode de novo pra ficar 8+ min.`);

  return avisos;
}

function contarPalavras(t) {
  return String(t || '').trim().split(/\s+/).filter(Boolean).length;
}
function minutosDeFala(palavras) {
  // leitura rápida ≈ 180 palavras por minuto
  return (palavras / 180).toFixed(1);
}

// ── As duas funções principais ────────────────────────────────────────
async function roteiroNoticias(jogos = []) {
  if (!roteiroIA.temChave()) return { erro: 'Configure GROQ_API_KEY no .env (grátis em console.groq.com)' };

  const { usar, sobra, totalAcumulado } = await noticiasDoVideo(8);
  if (!usar.length) return { erro: 'Sem notícias suficientes agora.' };

  const texto = await gerarEmBlocos(blocosNoticias(usar, jogos));
  if (!texto) return { erro: 'A IA não respondeu. Tenta de novo.' };

  // o que não entrou fica pro próximo vídeo
  acumular(sobra);
  marcarVideoFeito(usar);

  const palavras = contarPalavras(texto);
  return {
    texto, palavras, minutos: minutosDeFala(palavras), revisao: revisar(texto),
    usadas: usar.length, acumuladas: totalAcumulado, sobrando: sobra.length,
    fontes: usar.map(n => ({ titulo: n.titulo, link: n.link })),
  };
}

async function roteiroCuriosidade(temaManual = '', dados = '') {
  if (!roteiroIA.temChave()) return { erro: 'Configure GROQ_API_KEY no .env' };

  let tema = temaManual;
  let dossie = dados;
  let fontes = [];

  // ═══ APURAÇÃO ANTES DE ESCREVER ═══
  // Este é o passo que faltava. Em vez de mandar a IA inventar sobre um
  // tema, buscamos os fatos primeiro (Wikipédia + matérias reais) e
  // entregamos prontos pra ela.
  try {
    if (temaManual) {
      // tema escolhido por você → busca fatos sobre ele
      const d = await pesquisa.montarDossie(temaManual);
      if (d.temFatos) {
        dossie = [dados, d.fatos].filter(Boolean).join('\n\n───────\n\n');
        fontes = d.fontes;
      }
    } else {
      // sem tema → parte do que os portais publicaram de curiosidade HOJE
      const t = await pesquisa.temaComFatos();
      if (t) {
        tema = t.tema;
        dossie = t.fatos;
        fontes = t.fontes;
        console.log(`[ROTEIRO-LONGO] tema veio de matéria real: "${tema}" (${t.total} fontes)`);
      }
    }
  } catch (e) { console.log('[ROTEIRO-LONGO] apuração falhou:', e.message); }

  // se ainda não tem tema, usa o rotativo (temas do presente, verificáveis)
  if (!tema) tema = temaDoDia();

  // contexto extra: notícias do dia
  let contexto = '';
  try {
    const ns = await noticias.buscarNoticias({ apenasNovas: false, minScore: 5 });
    contexto = ns.slice(0, 6).map(n =>
      `• [${n.clubes.join(', ')}] ${n.titulo}${n.resumo ? ` — ${n.resumo.slice(0, 200)}` : ''}`
    ).join('\n');
  } catch { /* segue */ }

  const texto = await gerarEmBlocos(blocosCuriosidade(tema, dossie, contexto));
  if (!texto) return { erro: 'A IA não respondeu. Tenta de novo.' };

  const palavras = contarPalavras(texto);
  return {
    texto, tema, palavras, minutos: minutosDeFala(palavras),
    revisao: revisar(texto), fontes, apurado: Boolean(dossie),
  };
}

// ── Envio pro Discord ─────────────────────────────────────────────────
async function enviar(canal, r, tipo) {
  if (!canal?.isTextBased?.()) return false;

  const cab = tipo === 'noticias'
    ? `📺 **ROTEIRO DO DIA — NOTÍCIAS**\n` +
      `⏱️ ~${r.minutos} min de vídeo · ${r.palavras} palavras\n` +
      `📰 ${r.usadas} notícias usadas` +
      (r.sobrando ? ` · ${r.sobrando} guardadas pro próximo` : '') + '\n' +
      `━━━━━━━━━━━━━━━\n\n`
    : `🔍 **ROTEIRO DO DIA — CURIOSIDADE**\n` +
      `📌 Tema: ${r.tema}\n` +
      `⏱️ ~${r.minutos} min de vídeo · ${r.palavras} palavras\n` +
      (r.apurado
        ? `📚 **Apurado em ${r.fontes?.length || 0} fonte(s)** — links no fim\n`
        : `⚠️ **SEM APURAÇÃO** — não achei fontes pra este tema.\n` +
          `_Confira TUDO antes de gravar, ou passe os dados você:_\n` +
          `_/videocuriosidade tema:... dados:..._\n`) +
      `━━━━━━━━━━━━━━━\n\n`;

  // Avisos da revisão automática vêm ANTES do texto, pra você ver na hora
  const alerta = (r.revisao && r.revisao.length)
    ? `🔍 **REVISÃO AUTOMÁTICA**\n${r.revisao.join('\n')}\n` +
      `_Corrija esses pontos antes de gravar._\n━━━━━━━━━━━━━━━\n\n`
    : `✅ **Revisão automática: nenhum vício detectado.**\n` +
      `_Ainda assim, confira os fatos nas fontes abaixo._\n━━━━━━━━━━━━━━━\n\n`;

  const completo = cab + alerta + r.texto;

  for (let i = 0; i < completo.length; i += 1900) {
    await canal.send(completo.slice(i, i + 1900)).catch(() => {});
    await new Promise(x => setTimeout(x, 500));
  }

  // fontes no fim, pra conferir antes de gravar
  if (r.fontes?.length) {
    const links = '🔗 **FONTES DA APURAÇÃO** (confira e cite no vídeo)\n' +
      r.fontes.map((f, i) =>
        `${i + 1}. ${f.tipo ? `[${f.tipo}] ` : ''}${f.titulo || ''}\n   <${f.link}>`
      ).join('\n');
    for (let i = 0; i < links.length; i += 1900) {
      await canal.send(links.slice(i, i + 1900)).catch(() => {});
    }
  }
  return true;
}

module.exports = {
  roteiroNoticias, roteiroCuriosidade, enviar, revisar,
  temaDoDia, TEMAS_CURIOSIDADE, lerAcumulo, contarPalavras, minutosDeFala,
};
