// =====================================================================
// noticias.js — Radar de notícias + gerador de pauta pro canal
//
// O QUE FAZ:
//   1. Lê feeds RSS públicos dos grandes portais esportivos
//   2. Filtra só o que fala dos clubes da Série A (usa times.js)
//   3. Pontua por "temperatura" (o que tem cara de viral)
//   4. Posta no canal PÚBLICO: manchete + link (a galera clica e lê na fonte)
//   5. Posta no canal PRIVADO (fundadores): a PAUTA do vídeo/live do dia
//
// ⚠️ SOBRE DIREITOS AUTORAIS — leia antes de mexer:
//   O bot NUNCA copia o texto das matérias. Ele mostra a MANCHETE (que é
//   fato) e o LINK pra fonte original. A "pauta" que ele gera são TÓPICOS
//   pra VOCÊ falar com suas palavras — não é texto pronto pra ler.
//   Isso não é limitação técnica: copiar matéria de portal é violação de
//   direito autoral e dá strike no YouTube. O valor do seu canal é a SUA
//   opinião sobre a notícia, não a notícia copiada.
// =====================================================================

const { EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const times = require('./times.js');

const DIR = process.env.DATA_DIR || __dirname;
const DB = path.join(DIR, 'noticias-vistas.json');

// ── Fontes (RSS público dos portais) ──────────────────────────────────
// Testados em campo: nem todo portal libera RSS pra robô.
// O ge.globo devolve 403 (bloqueia bot) — deixei comentado; se um dia
// liberar, é só descomentar. O bot ignora feed que falha e segue com os
// outros, então adicionar fonte nova é seguro.
const FEEDS = [
  { nome: 'Gazeta',   url: 'https://www.gazetaesportiva.com/feed/' },        // ~50 itens
  { nome: 'Placar',   url: 'https://placar.com.br/feed' },                   // ~20 itens
  { nome: 'Trivela',  url: 'https://trivela.com.br/feed/' },                 // ~20 itens
  { nome: 'Terra',    url: 'https://www.terra.com.br/esportes/rss.xml' },    // ~10 itens
  // Testados e BLOQUEADOS (403/404) — não adianta reativar sem proxy:
  // ge.globo (403) · Folha (403) · UOL (403) · CNN (404) · Superesportes (404)
];

// ── Termos que indicam notícia "quente" (gera clique e discussão) ─────
// Peso maior = mais viral. É isso que ordena a lista.
const TERMOS_QUENTES = [
  { re: /demiss|demitid|caiu|pediu demissão/i,        peso: 10, tag: '🔥 BOMBA' },
  { re: /contrata|acerta|fecha com|assina|reforço/i,  peso: 9,  tag: '✍️ MERCADO' },
  { re: /lesão|lesionad|machucad|desfalque|cirurgia/i,peso: 7,  tag: '🏥 DESFALQUE' },
  { re: /polêmic|revolta|criticou|alfineta|treta/i,   peso: 9,  tag: '😤 POLÊMICA' },
  { re: /vaza|bastidor|exclusiv|revela/i,             peso: 8,  tag: '👀 BASTIDOR' },
  { re: /rebaixa|z4|zona de rebaixamento/i,           peso: 8,  tag: '⚠️ Z4' },
  { re: /título|campeã|líder|liderança/i,             peso: 7,  tag: '🏆 TÍTULO' },
  { re: /arbitr|var|pênalti|roubo|erro de arbitragem/i, peso: 8, tag: '🟨 ARBITRAGEM' },
  { re: /torcida|protesto|xingou|cobrança/i,          peso: 6,  tag: '📣 TORCIDA' },
  { re: /valor|milhõe|salário|dívida/i,               peso: 6,  tag: '💰 GRANA' },
];

// ── Memória de já-vistas (não repetir notícia) ────────────────────────
function carregar() {
  try {
    if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify({ vistas: [] }));
    return JSON.parse(fs.readFileSync(DB, 'utf8'));
  } catch { return { vistas: [] }; }
}
function salvar(d) {
  try {
    // guarda só as últimas 500 pra não crescer sem fim
    d.vistas = d.vistas.slice(-500);
    fs.writeFileSync(DB, JSON.stringify(d));
  } catch (e) { console.error('[NOTICIAS] erro ao salvar:', e.message); }
}

// ── Leitor de RSS (sem dependência externa) ───────────────────────────
function limparTexto(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    // entidades numéricas: &#8220; &#8217; etc. (aspas curvas, travessões)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRSS(xml, fonte) {
  const itens = [];
  const blocos = xml.split(/<item[\s>]/i).slice(1);
  for (const b of blocos) {
    const pega = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? limparTexto(m[1]) : '';
    };
    const titulo = pega('title');
    const link = pega('link') || (b.match(/<link[^>]*>([^<]+)/i)?.[1] || '').trim();
    // O RESUMO é essencial: sem ele a IA só tem a manchete e acaba
    // inventando contexto (foi o que gerou "218 milhões" sem nome de
    // jogador). Aqui pegamos o resumo que o próprio portal publica.
    const resumo = pega('description') || pega('content:encoded') || pega('summary') || '';
    const data = pega('pubDate');
    if (titulo && link) itens.push({ titulo, link, data, fonte, resumo: resumo.slice(0, 600) });
  }
  return itens;
}

async function buscarFeed(feed) {
  try {
    const r = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HubLabBot/1.0)' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) { console.log(`[NOTICIAS] ${feed.nome}: HTTP ${r.status}`); return []; }
    const xml = await r.text();
    return parseRSS(xml, feed.nome);
  } catch (e) {
    console.log(`[NOTICIAS] ${feed.nome} falhou: ${e.message}`);
    return [];
  }
}

// ── Análise: de qual clube fala e quão quente é ───────────────────────
function clubesCitados(texto) {
  const achados = [];
  for (const c of times.CLUBES) {
    for (const v of c.variantes) {
      // \b pra não casar "Remo" dentro de "remoção"
      const re = new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(texto)) { achados.push(c.nome); break; }
    }
  }
  return [...new Set(achados)];
}

function temperatura(titulo) {
  let score = 0;
  const tags = [];
  for (const t of TERMOS_QUENTES) {
    if (t.re.test(titulo)) { score += t.peso; tags.push(t.tag); }
  }
  return { score, tags: [...new Set(tags)] };
}

// Notícia é "nossa" se cita clube da Série A. Score final soma a fama do clube.
function analisar(item) {
  // procura clube no título E no resumo — mais preciso
  const clubes = clubesCitados(`${item.titulo} ${item.resumo || ''}`);
  if (!clubes.length) return null;

  const t = temperatura(item.titulo);
  const fama = Math.max(...clubes.map(c => times.popularidade(c)));
  return {
    ...item,
    clubes,
    tags: t.tags,
    score: t.score + fama, // quente + time grande = topo da lista
  };
}

// ── Busca principal ───────────────────────────────────────────────────
async function buscarNoticias({ apenasNovas = true, minScore = 0 } = {}) {
  const d = carregar();
  const vistas = new Set(d.vistas);

  const todas = [];
  for (const f of FEEDS) {
    const itens = await buscarFeed(f);
    todas.push(...itens);
    await new Promise(r => setTimeout(r, 800)); // gentileza com os servidores
  }

  const analisadas = todas
    .map(analisar)
    .filter(Boolean)
    .filter(n => n.score >= minScore)
    .filter(n => !apenasNovas || !vistas.has(n.link));

  // dedup por título parecido (portais repetem a mesma notícia)
  const unicas = [];
  const chaves = new Set();
  for (const n of analisadas.sort((a, b) => b.score - a.score)) {
    const chave = n.titulo.toLowerCase().slice(0, 45);
    if (chaves.has(chave)) continue;
    chaves.add(chave);
    unicas.push(n);
  }

  return unicas;
}

function marcarComoVistas(noticias) {
  const d = carregar();
  d.vistas.push(...noticias.map(n => n.link));
  salvar(d);
}

// ── Gerador de PAUTA (pro canal privado) ──────────────────────────────
// Não escreve o vídeo por você — dá a estrutura e os ganchos. O valor do
// seu canal é a SUA opinião; o bot só organiza o que falar.
function montarPauta(noticias) {
  const top = noticias.slice(0, 5);
  if (!top.length) return null;

  const linhas = top.map((n, i) => {
    const tags = n.tags.length ? ` ${n.tags.join(' ')}` : '';
    return `**${i + 1}. ${n.titulo}**${tags}\n` +
           `   └ ${n.clubes.join(', ')} · ${n.fonte}\n` +
           `   └ 🔗 ${n.link}`;
  }).join('\n\n');

  const principal = top[0];

  const roteiro =
    `**🎬 ESTRUTURA DO VÍDEO DE HOJE**\n\n` +
    `**Gancho (0-5s):** comece pela mais quente — "${principal.titulo.slice(0, 70)}..."\n` +
    `**Desenvolvimento:** passe pelas 3 primeiras, dando SUA leitura de cada uma\n` +
    `**Opinião forte (o que diferencia):** escolha UMA e crave uma posição. ` +
    `Discordância nos comentários = alcance.\n` +
    `**Chamada:** "o que você acha? comenta aí — e a resenha completa é no nosso Discord"\n\n` +
    `⚠️ *Fale com SUAS palavras. Não leia a matéria — a opinião é o produto.*`;

  return { linhas, roteiro, principal };
}

// ── Envio pro Discord ─────────────────────────────────────────────────
async function postarNoticias(client, { canalPublico, canalPrivado, quantidade = 5 } = {}) {
  const noticias = await buscarNoticias({ apenasNovas: true, minScore: 5 });
  if (!noticias.length) {
    console.log('[NOTICIAS] nada novo relevante agora.');
    return { enviadas: 0 };
  }

  const top = noticias.slice(0, quantidade);

  // ---- Canal PÚBLICO: manchete + link (a galera lê na fonte) ----
  if (canalPublico) {
    const ch = await client.channels.fetch(canalPublico).catch(() => null);

    // FÓRUM: cada notícia vira um POST com discussão própria.
    // (num fórum não dá pra mandar mensagem solta — tem que criar thread)
    if (ch?.type === ChannelType.GuildForum) {
      for (const n of top) {
        const tag = n.tags.length ? `${n.tags[0]} ` : '';
        // título do post: limite de 100 caracteres no Discord
        const titulo = `${tag}${n.titulo}`.slice(0, 100);
        const corpo =
          `${n.clubes.map(c => `\`${c}\``).join(' ')}\n\n` +
          `📰 [Ler a matéria completa no ${n.fonte}](${n.link})\n\n` +
          `**E aí, o que você acha disso?** 👇`;

        await ch.threads.create({
          name: titulo,
          message: { content: corpo },
          reason: 'Giro de notícias do Hub Lab',
        }).catch(e => console.log('[NOTICIAS] post no fórum:', e.message));

        await new Promise(r => setTimeout(r, 1200)); // evita rate limit
      }
      console.log(`[NOTICIAS] ${top.length} posts criados no fórum.`);
    }

    // CANAL DE TEXTO normal: uma mensagem só com todas as notícias
    else if (ch?.isTextBased()) {
      const desc = top.map((n, i) => {
        const tags = n.tags.length ? ` ${n.tags[0]}` : '';
        return `**${i + 1}.${tags} ${n.titulo}**\n` +
               `${n.clubes.map(c => `\`${c}\``).join(' ')} · [ler no ${n.fonte}](${n.link})`;
      }).join('\n\n');

      await ch.send({ embeds: [new EmbedBuilder()
        .setColor(0xC6F432)
        .setTitle('📰 Giro do Hub Lab')
        .setDescription(desc)
        .setFooter({ text: 'Comenta aí o que achou · resenha completa na call' })
        .setTimestamp()] }).catch(e => console.log('[NOTICIAS] público:', e.message));
    }

    else {
      console.log('[NOTICIAS] canal público inválido ou sem permissão.');
    }
  }

  // ---- Canal PRIVADO: a pauta do dia (só vocês dois) ----
  if (canalPrivado) {
    const ch = await client.channels.fetch(canalPrivado).catch(() => null);
    if (ch?.isTextBased()) {
      const pauta = montarPauta(noticias);
      if (pauta) {
        await ch.send({ embeds: [new EmbedBuilder()
          .setColor(0xFFCF00)
          .setTitle('🎯 PAUTA DO DIA — uso interno')
          .setDescription(pauta.linhas)
          .setTimestamp()] }).catch(() => {});
        await ch.send(pauta.roteiro).catch(() => {});
      }
    }
  }

  marcarComoVistas(top);
  console.log(`[NOTICIAS] ${top.length} enviadas (de ${noticias.length} relevantes).`);
  return { enviadas: top.length, noticias: top };
}

module.exports = {
  buscarNoticias, postarNoticias, montarPauta,
  analisar, temperatura, clubesCitados, parseRSS, FEEDS,
};
