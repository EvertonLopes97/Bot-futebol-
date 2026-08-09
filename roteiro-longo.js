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

NUNCA INVENTE: estatística, placar, ano, valor, declaração ou nome que
não esteja nas informações dadas. Se precisar de um dado que não tem,
fale de forma genérica ("um valor alto", "faz um tempo").

Não escreva marcações de tempo, nem "(pausa)", nem instruções de câmera.
Só o texto pra falar.`;

// ── Roteiro de NOTÍCIAS (em 3 blocos pra dar tamanho) ─────────────────
function blocosNoticias(lista, jogos = []) {
  const manchetes = lista.map((n, i) =>
    `${i + 1}. [${n.clubes.join(', ')}] ${n.titulo}`).join('\n');
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
const TEMAS_CURIOSIDADE = [
  'Os maiores vices do futebol brasileiro e as histórias por trás',
  'Jogadores que ninguém lembra que passaram por grandes clubes',
  'As maiores viradas da história do Brasileirão',
  'Times que já foram gigantes e hoje estão na segunda divisão',
  'As contratações mais caras que deram errado no futebol brasileiro',
  'Clássicos que nasceram de rivalidades inesperadas',
  'Os apelidos dos clubes brasileiros e de onde vieram',
  'Jogadores que jogaram nos dois lados de um clássico',
  'As camisas mais icônicas do futebol brasileiro',
  'Recordes do Brasileirão que dificilmente serão quebrados',
  'Técnicos que mudaram a história de um clube',
  'As eliminações mais dolorosas da Libertadores para times brasileiros',
];

function temaDoDia() {
  // roda o tema pelo dia do ano, então não repete por 12 dias
  const dia = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return TEMAS_CURIOSIDADE[dia % TEMAS_CURIOSIDADE.length];
}

function blocosCuriosidade(tema, dados = '') {
  const base = `TEMA: ${tema}
${dados ? `\nDADOS CONFIRMADOS (use só estes):\n${dados}` : ''}

⚠️ Só cite fato, nome, ano ou número se tiver CERTEZA. Na dúvida, fale de
forma genérica ou escreva [CONFERIR: o quê] pro apresentador checar.`;

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
Cada um contado como história, com sua opinião ao fim.

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
    texto, palavras, minutos: minutosDeFala(palavras),
    usadas: usar.length, acumuladas: totalAcumulado, sobrando: sobra.length,
    fontes: usar.map(n => ({ titulo: n.titulo, link: n.link })),
  };
}

async function roteiroCuriosidade(temaManual = '', dados = '') {
  if (!roteiroIA.temChave()) return { erro: 'Configure GROQ_API_KEY no .env' };

  const tema = temaManual || temaDoDia();
  const texto = await gerarEmBlocos(blocosCuriosidade(tema, dados));
  if (!texto) return { erro: 'A IA não respondeu. Tenta de novo.' };

  const palavras = contarPalavras(texto);
  return { texto, tema, palavras, minutos: minutosDeFala(palavras) };
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
      `━━━━━━━━━━━━━━━\n\n`;

  const completo = cab + r.texto;

  for (let i = 0; i < completo.length; i += 1900) {
    await canal.send(completo.slice(i, i + 1900)).catch(() => {});
    await new Promise(x => setTimeout(x, 500));
  }

  // fontes no fim, pra conferir antes de gravar
  if (tipo === 'noticias' && r.fontes?.length) {
    const links = '🔗 **FONTES** (confira antes de gravar)\n' +
      r.fontes.map((f, i) => `${i + 1}. <${f.link}>`).join('\n');
    for (let i = 0; i < links.length; i += 1900) {
      await canal.send(links.slice(i, i + 1900)).catch(() => {});
    }
  }
  return true;
}

module.exports = {
  roteiroNoticias, roteiroCuriosidade, enviar,
  temaDoDia, TEMAS_CURIOSIDADE, lerAcumulo, contarPalavras, minutosDeFala,
};
