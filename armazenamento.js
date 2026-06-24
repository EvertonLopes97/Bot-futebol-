// armazenamento.js — Camada de persistência unificada
// Usa Supabase se configurado; senão, volume /data; senão, arquivo local.
// Garante que ranking/níveis/palpites nunca se percam.
const fs = require('fs');
const path = require('path');

const DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;

// Diagnóstico no boot: mostra ONDE está salvando
function diagnostico() {
  const usandoVolume = !!process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const usandoSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
  console.log('💾 ARMAZENAMENTO:');
  console.log('   Volume /data:', usandoVolume ? `SIM (${DIR})` : 'NÃO — dados podem se perder no redeploy!');
  console.log('   Supabase:', usandoSupabase ? 'SIM (backup na nuvem)' : 'não configurado');
  // testa se consegue escrever
  try {
    const teste = path.join(DIR, '.teste_escrita');
    fs.writeFileSync(teste, 'ok');
    fs.unlinkSync(teste);
    console.log('   Escrita no disco: OK ✅');
  } catch (e) {
    console.error('   Escrita no disco: FALHOU ❌', e.message);
  }
}

// ── Supabase (opcional) ──
let supabase = null;
async function initSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return;
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    console.log('✅ Supabase conectado');
  } catch (e) { console.error('[SUPABASE] erro:', e.message); }
}

// Salva um "documento" (chave → objeto JSON) no disco E no supabase
async function salvar(chave, dados) {
  // 1. disco (volume)
  try {
    fs.writeFileSync(path.join(DIR, `${chave}.json`), JSON.stringify(dados, null, 2));
  } catch (e) { console.error(`[ARMAZ] disco ${chave}:`, e.message); }
  // 2. supabase (backup nuvem)
  if (supabase) {
    try {
      await supabase.from('hublab_dados').upsert({ chave, dados, atualizado_em: new Date().toISOString() });
    } catch (e) { console.error(`[SUPABASE] salvar ${chave}:`, e.message); }
  }
}

// Carrega: tenta supabase primeiro (fonte da verdade na nuvem), senão disco
async function carregar(chave, padrao) {
  if (supabase) {
    try {
      const { data } = await supabase.from('hublab_dados').select('dados').eq('chave', chave).single();
      if (data && data.dados) {
        // sincroniza no disco também
        fs.writeFileSync(path.join(DIR, `${chave}.json`), JSON.stringify(data.dados, null, 2));
        return data.dados;
      }
    } catch (e) { /* cai pro disco */ }
  }
  try {
    const p = path.join(DIR, `${chave}.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { console.error(`[ARMAZ] carregar ${chave}:`, e.message); }
  return padrao;
}

module.exports = { diagnostico, initSupabase, salvar, carregar, DIR };
