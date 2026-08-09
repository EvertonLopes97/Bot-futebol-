// =====================================================================
// engajamento.js — O post do dia que faz a galera conversar
//
// A IDEIA (sua): uma vez por dia o bot joga um assunto no chat pra gerar
// discussão. Não é aviso, não é anúncio — é provocação com pergunta.
//
// O SEGREDO: variar o formato. Se for sempre igual, vira ruído e a galera
// ignora. Aqui tem 6 tipos que se alternam, e o bot nunca repete o mesmo
// dois dias seguidos.
//
// Exemplo do que ele gera:
//   "Rapaziada, o Corinthians caiu na Copa do Brasil e o técnico culpou
//    o primeiro jogo. O Vitória meteu goleada e ninguém esperava.
//    Qual eliminação te surpreendeu mais?"
// =====================================================================

const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const noticias = require('./noticias.js');
const roteiroIA = require('./roteiro-ia.js');

const DIR = process.env.DATA_DIR || __dirname;
const DB = path.join(DIR, 'engajamento.json');

// ── Os 6 formatos que se alternam ─────────────────────────────────────
const FORMATOS = [
  {
    id: 'noticia',
    nome: 'Resenha da notícia',
    instrucao: `Pegue as 2-3 notícias mais quentes e monte um post curto de
resenha, terminando com uma PERGUNTA aberta que dê vontade de responder.
Fale como torcedor falando com torcedor, não como jornalista.
Exemplo do tom: "Rapaziada, o Corinthians caiu e o técnico culpou o primeiro
jogo. O Vitória meteu goleada e ninguém esperava. Qual eliminação te
surpreendeu mais?"`,
  },
  {
    id: 'polemica',
    nome: 'Pergunta polêmica',
    instrucao: `Crie UMA pergunta polêmica sobre o futebol brasileiro que
divida opinião. Nada de pergunta com resposta óbvia. Tem que ser o tipo de
coisa que gera dois lados brigando (de brincadeira) nos comentários.
Exemplo: "Qual time tem a maior torcida que menos ganha coisa?"`,
  },
  {
    id: 'ranking',
    nome: 'Monta o ranking',
    instrucao: `Proponha um TOP 3 pra galera montar. Dê o tema e o seu top 3
como provocação, pedindo pro pessoal discordar.
Exemplo: "Meu top 3 de camisa mais bonita do Brasileirão: 1) ... 2) ... 3) ...
Fala o seu que eu sei que vocês vão discordar."`,
  },
  {
    id: 'seousasse',
    nome: 'E se...',
    instrucao: `Crie um cenário hipotético de futebol e peça a opinião.
Exemplo: "Se pudesse trazer UM jogador aposentado pro seu time hoje, quem
seria?" ou "Se o Brasileirão tivesse playoff, quem seria campeão?"`,
  },
  {
    id: 'memoria',
    nome: 'Memória afetiva',
    instrucao: `Puxe uma lembrança de futebol que todo torcedor tem.
Exemplo: "Qual foi o gol que te fez pular do sofá e acordar a casa toda?"
Perguntas de memória geram respostas longas e emotivas — ótimas pro chat.`,
  },
  {
    id: 'agradece',
    nome: 'Agradecimento + chamada',
    instrucao: `Agradeça quem participou (da live, dos palpites, dos jogos)
de forma calorosa e curta, e emende com uma pergunta sobre o que a galera
quer ver a seguir. Não seja formal — fale como amigo.`,
  },
];

// ── Memória de qual formato usou ──────────────────────────────────────
function carregar() {
  try { return JSON.parse(fs.readFileSync(DB, 'utf8')); }
  catch { return { historico: [], ultimo: null }; }
}
function salvar(d) {
  try { d.historico = d.historico.slice(-30); fs.writeFileSync(DB, JSON.stringify(d, null, 2)); }
  catch (e) { console.error('[ENGAJAMENTO] salvar:', e.message); }
}

// Escolhe um formato diferente do último usado
function escolherFormato(forcado) {
  if (forcado) {
    const f = FORMATOS.find(x => x.id === forcado);
    if (f) return f;
  }
  const d = carregar();
  const disponiveis = FORMATOS.filter(f => f.id !== d.ultimo);
  return disponiveis[Math.floor(Math.random() * disponiveis.length)];
}

// ── Geração do post ───────────────────────────────────────────────────
async function gerarPost({ formato: forcado = null, contexto = '' } = {}) {
  const formato = escolherFormato(forcado);

  // Notícia e agradecimento precisam do material do dia
  let manchetes = '';
  if (formato.id === 'noticia' || formato.id === 'polemica') {
    const lista = await noticias.buscarNoticias({ apenasNovas: false, minScore: 5 });
    if (lista.length) {
      manchetes = '\nNOTÍCIAS DE HOJE (use só estas, não invente):\n' +
        lista.slice(0, 6).map((n, i) => `${i + 1}. ${n.titulo}`).join('\n');
    }
  }

  if (!roteiroIA.temChave()) {
    return { erro: 'Precisa da GROQ_API_KEY no .env pra gerar o post. Grátis em console.groq.com' };
  }

  const mensagens = [
    { role: 'system', content:
`Você escreve posts para o chat do Discord de uma comunidade brasileira de
futebol chamada Hub Lab. O público é torcedor comum, de todos os times.

REGRAS:
- Português do Brasil, informal, como quem fala no grupo do zap
- CURTO: no máximo 4 linhas. Post longo ninguém lê no Discord.
- SEMPRE termine com uma pergunta direta pro pessoal responder
- Nunca invente estatística, placar, ano ou nome. Se não tiver o dado,
  fale de forma genérica.
- Sem clubismo: provoque todos os lados com bom humor
- Não use hashtag (é Discord, não Instagram)
- Comece chamando a galera de um jeito natural (rapaziada, galera, e aí pessoal...)` },
    { role: 'user', content:
`Escreva o post de hoje no formato "${formato.nome}".

${formato.instrucao}
${manchetes}
${contexto ? `\nCONTEXTO EXTRA: ${contexto}` : ''}

Responda APENAS com o texto do post, sem título, sem explicação, sem aspas.` },
  ];

  const texto = await roteiroIA.chamarGroq(mensagens, { maxTokens: 400 });
  if (!texto) return { erro: 'A IA não respondeu. Tenta de novo.' };

  // registra o formato usado
  const d = carregar();
  d.ultimo = formato.id;
  d.historico.push({ formato: formato.id, em: Date.now() });
  salvar(d);

  return { texto: texto.trim(), formato: formato.nome, formatoId: formato.id };
}

// ── Envio ─────────────────────────────────────────────────────────────
async function postarDoDia(client, canalId, opcoes = {}) {
  if (!canalId) { console.log('[ENGAJAMENTO] canal não configurado'); return null; }
  const ch = await client.channels.fetch(canalId).catch(() => null);
  if (!ch?.isTextBased()) { console.log('[ENGAJAMENTO] canal inválido'); return null; }

  const r = await gerarPost(opcoes);
  if (r.erro) { console.log('[ENGAJAMENTO]', r.erro); return null; }

  // Post simples, sem embed: parece mensagem de gente, não de robô.
  // Embed dá cara de anúncio e a galera responde menos.
  await ch.send(r.texto).catch(e => console.log('[ENGAJAMENTO] envio:', e.message));
  console.log(`[ENGAJAMENTO] post do dia enviado (${r.formato})`);
  return r;
}

module.exports = { gerarPost, postarDoDia, FORMATOS };
