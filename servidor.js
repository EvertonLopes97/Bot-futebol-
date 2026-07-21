// servidor.js — API HTTP do bot, pro site consumir (jogos, placares, odds, ranking)
// O bot vira backend: o site faz fetch nesses endpoints e mostra tudo ao vivo.
const http = require('http');

// Estado compartilhado (o index.js atualiza isso)
const estado = {
  jogosHoje: [],
  aoVivo: [],
  ultimaDica: null,
  multiplas: [],
  ranking: [],
  rankingXP: [],
  bolaoExato: null,
  membros: 0,
  atualizadoEm: null,
};

function setEstado(chave, valor) {
  estado[chave] = valor;
  estado.atualizadoEm = new Date().toISOString();
}

// Handler do webhook do cargo Sócio. O index.js registra a função que dá/remove o cargo.
let onWebhook = null;
function registrarWebhook(fn) { onWebhook = fn; }
const WEBHOOK_SECRET = process.env.BOT_WEBHOOK_SECRET || '';

function iniciarServidor(porta) {
  const server = http.createServer((req, res) => {
    // CORS: permite o site acessar
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hublab-secret');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = req.url.split('?')[0];

    // ── Webhook do cargo Sócio (POST, vindo do site após pagamento) ──
    if (url === '/webhook' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', async () => {
        try {
          if (WEBHOOK_SECRET && req.headers['x-hublab-secret'] !== WEBHOOK_SECRET) {
            res.writeHead(401); res.end(JSON.stringify({ erro: 'não autorizado' })); return;
          }
          const dados = JSON.parse(body || '{}');
          if (onWebhook) await onWebhook(dados); // { usuarioId, acao }
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ erro: e.message }));
        }
      });
      return;
    }

    // Rotas da API
    if (url === '/' || url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'online', bot: 'Hub Lab C.O', atualizadoEm: estado.atualizadoEm }));
    } else if (url === '/api/jogos') {
      res.writeHead(200);
      res.end(JSON.stringify({ jogos: estado.jogosHoje, atualizadoEm: estado.atualizadoEm }));
    } else if (url === '/api/aovivo') {
      res.writeHead(200);
      res.end(JSON.stringify({ aoVivo: estado.aoVivo, atualizadoEm: estado.atualizadoEm }));
    } else if (url === '/api/dica') {
      res.writeHead(200);
      res.end(JSON.stringify({ dica: estado.ultimaDica, multiplas: estado.multiplas, atualizadoEm: estado.atualizadoEm }));
    } else if (url === '/api/membros') {
      res.writeHead(200);
      res.end(JSON.stringify({ membros: estado.membros }));
    } else if (url === '/api/bolao-exato') {
      res.writeHead(200);
      res.end(JSON.stringify({ bolao: estado.bolaoExato, atualizadoEm: estado.atualizadoEm }));
    } else if (url === '/api/ranking') {
      res.writeHead(200);
      res.end(JSON.stringify({ ranking: estado.ranking, rankingXP: estado.rankingXP, atualizadoEm: estado.atualizadoEm }));
    } else if (url === '/api/tudo') {
      // endpoint único com tudo (mais eficiente pro site)
      res.writeHead(200);
      res.end(JSON.stringify(estado));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ erro: 'rota não encontrada' }));
    }
  });

  const portaFinal = porta || process.env.PORT || 3000;
  server.listen(portaFinal, '0.0.0.0', () => console.log(`🌐 API HTTP do bot rodando na porta ${portaFinal} (0.0.0.0)`));
  return server;
}

module.exports = { iniciarServidor, setEstado, estado, registrarWebhook };
