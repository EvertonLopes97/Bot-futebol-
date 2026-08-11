// =====================================================================
// pesquisa.js — Busca FATOS antes de escrever curiosidade
//
// O PROBLEMA QUE RESOLVE:
//   A IA não sabe história do futebol brasileiro. Quando pedimos
//   "curiosidade histórica" sem dar fatos, ela INVENTA (chegou a criar
//   uma origem falsa pro clássico Atlético x Cruzeiro).
//
// A SOLUÇÃO:
//   Buscar os fatos ANTES, em fontes reais, e entregar prontos pra IA.
//   Ela só escreve o roteiro em cima do que foi apurado.
//
// DUAS FONTES:
//   1. Wikipedia (pt) — fatos históricos: fundação, títulos, contexto
//   2. Feeds de notícia — matérias de curiosidade/retrospectiva
//
// ⚠️ DIREITO AUTORAL:
//   Usamos as fontes pra APURAR, não pra copiar. A IA escreve texto
//   original a partir dos fatos, e o roteiro vem com os links pra você
//   citar a fonte no vídeo. Isso é jornalismo normal.
//   O que NÃO fazemos: copiar matéria ou adaptar roteiro de outro canal
//   (isso é derivado e dá strike).
// =====================================================================

const noticias = require('./noticias.js');
const times = require('./times.js');

const WIKI = 'https://pt.wikipedia.org/api/rest_v1';
const UA = { 'User-Agent': 'HubLabBot/1.0 (https://hublab.agency)' };

// ── Wikipedia: fatos verificáveis ─────────────────────────────────────
async function wiki(termo) {
  try {
    const r = await fetch(`${WIKI}/page/summary/${encodeURIComponent(termo)}`, {
      headers: UA, signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.type === 'disambiguation' || !j.extract) return null;
    return {
      titulo: j.title,
      resumo: j.extract,
      link: j.content_urls?.desktop?.page || `https://pt.wikipedia.org/wiki/${encodeURIComponent(termo)}`,
    };
  } catch { return null; }
}

// Busca o clube na Wikipedia (fundação, história, títulos)
async function fatosDoClube(nomeClube) {
  // tenta o nome oficial primeiro, depois o comum
  const tentativas = [
    nomeClube,
    `${nomeClube} (clube de futebol)`,
    `Clube ${nomeClube}`,
  ];
  for (const t of tentativas) {
    const r = await wiki(t);
    if (r) return r;
    await new Promise(x => setTimeout(x, 400));
  }
  return null;
}

// ── Feeds: matérias de curiosidade e retrospectiva ────────────────────
// Termos que indicam matéria histórica/curiosidade (não notícia do dia)
const TERMOS_CURIOSIDADE = /h[áa] \d+ anos|relembr|retrospect|hist[óo]ri|anivers[áa]rio|nostalgi|antigament|curiosidad|voc[êe] sabia|a origem|como era|d[ée]cada de|em \d{4}|maior(es)? de todos|lend[áa]ri/i;

async function materiasDeCuriosidade(limite = 10) {
  const todas = await noticias.buscarNoticias({ apenasNovas: false, minScore: 0 });
  return todas
    .filter(n => TERMOS_CURIOSIDADE.test(`${n.titulo} ${n.resumo || ''}`))
    .slice(0, limite);
}

// ── Monta o dossiê de fatos pra IA ────────────────────────────────────
// Detecta quais clubes o tema cita e busca fatos de cada um.
async function montarDossie(tema) {
  const fatos = [];
  const fontes = [];

  // 1. Quais clubes o tema menciona?
  const clubesNoTema = [];
  for (const c of times.CLUBES) {
    for (const v of c.variantes) {
      if (new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(tema)) {
        clubesNoTema.push(c.nome); break;
      }
    }
  }

  // 2. Fatos da Wikipedia sobre esses clubes (até 3, pra não demorar)
  for (const nome of clubesNoTema.slice(0, 3)) {
    const w = await fatosDoClube(nome);
    if (w) {
      fatos.push(`SOBRE O ${nome.toUpperCase()} (Wikipédia):\n${w.resumo}`);
      fontes.push({ tipo: 'Wikipédia', titulo: w.titulo, link: w.link });
    }
    await new Promise(x => setTimeout(x, 600));
  }

  // 3. Matérias de curiosidade publicadas nos portais
  const mats = await materiasDeCuriosidade(6);
  for (const m of mats) {
    fatos.push(`MATÉRIA (${m.fonte}): ${m.titulo}\n${m.resumo || ''}`);
    fontes.push({ tipo: m.fonte, titulo: m.titulo, link: m.link });
  }

  return {
    fatos: fatos.join('\n\n───────\n\n'),
    fontes,
    temFatos: fatos.length > 0,
    clubesEncontrados: clubesNoTema,
  };
}

// ── Sugestão de tema a partir do que EXISTE de matéria hoje ───────────
// Em vez de inventar tema e torcer pra ter fato, olhamos o que os
// portais publicaram de curiosidade e montamos o tema em cima disso.
async function temaComFatos() {
  const mats = await materiasDeCuriosidade(10);
  if (!mats.length) return null;

  const principal = mats[0];
  return {
    tema: principal.titulo,
    fatos: mats.map(m => `MATÉRIA (${m.fonte}): ${m.titulo}\n${m.resumo || ''}`).join('\n\n───────\n\n'),
    fontes: mats.map(m => ({ tipo: m.fonte, titulo: m.titulo, link: m.link })),
    total: mats.length,
  };
}

module.exports = { wiki, fatosDoClube, materiasDeCuriosidade, montarDossie, temaComFatos };
