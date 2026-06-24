// whatsapp.js — Envio de avisos no WhatsApp via Baileys (não-oficial)
// Sessão salva no volume (/data) → loga 1x, redeploys reconectam sozinhos.
const path = require('path');
const fs = require('fs');
const DIR  = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const AUTH_DIR = path.join(DIR, 'wa_auth');

let sock = null;
let conectado = false;
let tentativasPairing = 0;

function gruposDestino() {
  return (process.env.WPP_GRUPOS || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Limpa a sessão (use quando travar)
function limparSessao() {
  try {
    if (fs.existsSync(AUTH_DIR)) { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); console.log('[WPP] sessão antiga apagada'); }
  } catch (e) { console.error('[WPP] erro ao limpar:', e.message); }
}

async function iniciarWhatsApp(forcarReset = false) {
  let baileys, pino;
  try {
    baileys = require('@whiskeysockets/baileys');
    pino = require('pino');
  } catch (e) {
    console.error('[WPP] Baileys não instalado:', e.message);
    return;
  }
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;

  // Se forçado, limpa antes de começar
  if (forcarReset) limparSessao();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  const precisaParear = !state.creds.registered;

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: Browsers ? Browsers.ubuntu('Chrome') : ['HubLab Bot', 'Chrome', '1.0'],
    // importante para pairing code funcionar
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  // Pairing code: só pede se ainda não registrado, e ESPERA a conexão ficar pronta
  if (precisaParear && process.env.WPP_NUMERO) {
    const numero = process.env.WPP_NUMERO.replace(/\D/g, '');
    // espera 4s pro socket abrir o canal antes de pedir o código
    setTimeout(async () => {
      try {
        if (sock.authState.creds.registered) return;
        const code = await sock.requestPairingCode(numero);
        const formatado = code.match(/.{1,4}/g)?.join('-') || code;
        console.log('==================================================');
        console.log('📱 CÓDIGO DE PAREAMENTO DO WHATSAPP:', formatado);
        console.log('   Número:', numero);
        console.log('   No WhatsApp desse número:');
        console.log('   Aparelhos conectados → Conectar aparelho →');
        console.log('   "Conectar com número de telefone" → digite o código');
        console.log('   ⏱️ Você tem ~60 segundos. Se expirar, faça redeploy.');
        console.log('==================================================');
      } catch (e) {
        console.error('[WPP] erro ao gerar código:', e.message);
        console.log('[WPP] Tente: rm -rf /data/wa_auth no Console e faça redeploy.');
      }
    }, 4000);
  }

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') {
      conectado = true;
      tentativasPairing = 0;
      console.log('✅ WhatsApp conectado!');
      try {
        const grupos = await sock.groupFetchAllParticipating();
        console.log('===== GRUPOS DO WHATSAPP (copie o ID p/ WPP_GRUPOS) =====');
        for (const [jid, g] of Object.entries(grupos)) console.log(`   ${g.subject}  →  ${jid}`);
        console.log('========================================================');
      } catch (e) { console.error('[WPP] erro ao listar grupos:', e.message); }
    } else if (connection === 'close') {
      conectado = false;
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const deslogado = codigo === DisconnectReason.loggedOut;
      console.log('[WPP] conexão fechada. Código:', codigo, '| Deslogado:', deslogado);
      if (deslogado || codigo === 401 || codigo === 403) {
        // sessão inválida: limpa e recomeça do zero pra gerar novo código
        console.log('[WPP] sessão inválida — limpando e reiniciando para novo pareamento...');
        limparSessao();
        setTimeout(() => iniciarWhatsApp(false), 3000);
      } else {
        // queda temporária: reconecta mantendo a sessão
        console.log('[WPP] reconectando em 5s...');
        setTimeout(() => iniciarWhatsApp(false), 5000);
      }
    }
  });
}

async function enviar(texto) {
  if (!conectado || !sock) { console.log('[WPP] não conectado, pulando envio.'); return; }
  const grupos = gruposDestino();
  for (const jid of grupos) {
    try {
      await sock.sendMessage(jid, { text: texto });
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 4000));
    } catch (e) { console.error('[WPP] erro ao enviar pra', jid, e.message); }
  }
}

module.exports = { iniciarWhatsApp, enviar, limparSessao };
