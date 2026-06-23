// whatsapp.js — Envio de avisos no WhatsApp via Baileys (não-oficial)
// Sessão salva no volume (/data) → loga 1x, redeploys reconectam sozinhos.
const path = require('path');
const DIR  = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;

let sock = null;
let conectado = false;

// Grupos de destino (JIDs separados por vírgula na variável WPP_GRUPOS)
function gruposDestino() {
  return (process.env.WPP_GRUPOS || '').split(',').map(s => s.trim()).filter(Boolean);
}

async function iniciarWhatsApp() {
  let baileys, pino;
  try {
    baileys = require('@whiskeysockets/baileys');
    pino = require('pino');
  } catch (e) {
    console.error('[WPP] Baileys não instalado:', e.message);
    return;
  }
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

  const { state, saveCreds } = await useMultiFileAuthState(path.join(DIR, 'wa_auth'));
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['HubLab Bot', 'Chrome', '1.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  // Login por código de pareamento (não precisa de QR na tela)
  if (!sock.authState.creds.registered && process.env.WPP_NUMERO) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(process.env.WPP_NUMERO.replace(/\D/g, ''));
        console.log('==================================================');
        console.log('📱 CÓDIGO DE PAREAMENTO DO WHATSAPP:', code);
        console.log('No WhatsApp do número: Aparelhos conectados →');
        console.log('Conectar aparelho → Conectar com número → digite o código acima');
        console.log('==================================================');
      } catch (e) { console.error('[WPP] erro pairing:', e.message); }
    }, 3000);
  }

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') {
      conectado = true;
      console.log('✅ WhatsApp conectado!');
      // Lista os grupos pra você pegar os JIDs (copie pra variável WPP_GRUPOS)
      try {
        const grupos = await sock.groupFetchAllParticipating();
        console.log('===== GRUPOS DO WHATSAPP (copie o ID do que quer usar) =====');
        for (const [jid, g] of Object.entries(grupos)) {
          console.log(`${g.subject}  →  ${jid}`);
        }
        console.log('============================================================');
      } catch (e) { console.error('[WPP] erro ao listar grupos:', e.message); }
    } else if (connection === 'close') {
      conectado = false;
      const motivo = lastDisconnect?.error?.output?.statusCode;
      const deslogado = motivo === DisconnectReason.loggedOut;
      console.log('[WPP] conexão fechada. Deslogado:', deslogado);
      if (!deslogado) {
        console.log('[WPP] reconectando em 5s...');
        setTimeout(iniciarWhatsApp, 5000);
      } else {
        console.log('[WPP] sessão encerrada. Precisa parear de novo (apague a pasta wa_auth do volume).');
      }
    }
  });
}

// Envia texto pros grupos configurados (com intervalo aleatório anti-spam)
async function enviar(texto) {
  if (!conectado || !sock) { console.log('[WPP] não conectado, pulando envio.'); return; }
  const grupos = gruposDestino();
  for (const jid of grupos) {
    try {
      await sock.sendMessage(jid, { text: texto });
      // intervalo aleatório entre 2 e 6s pra não parecer robô
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 4000));
    } catch (e) { console.error('[WPP] erro ao enviar pra', jid, e.message); }
  }
}

module.exports = { iniciarWhatsApp, enviar };
