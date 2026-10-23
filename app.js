'use strict';
const $ = selector => document.querySelector(selector);
const CHUNK = 65536;
let session = null; let images = []; let busy = false; let job = null;
function apiUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname) || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') throw new Error('Use o endereço principal da sua caixa: https://fluir.sua-conta.workers.dev.');
  return url.origin;
}
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
function notice(message) { $('#notice').textContent = message; $('#notice').hidden = !message; }
function error(err) { $('#error').textContent = err.message || 'Não foi possível concluir. Tente novamente.'; $('#error').hidden = false; }
async function run(fn) {
  if (busy) return; busy = true; $('#error').hidden = true;
  document.querySelectorAll('button,input,textarea').forEach(el => { el.disabled = true; });
  try { await fn(); } catch (err) { error(err); }
  finally { busy = false; document.querySelectorAll('button,input,textarea').forEach(el => { el.disabled = false; }); }
}
async function request(route, method = 'GET', body) {
  let response;
  try { response = await fetch(`${session.api}${route}`, { method, headers: { Authorization: `Bearer ${session.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(30000) }); }
  catch { throw new Error('Sem conexão com a caixa. Seu texto continua nesta tela; tente novamente.'); }
  let result; try { result = await response.json(); } catch { throw new Error('O serviço não respondeu corretamente. Tente novamente.'); }
  if (!response.ok) throw new Error(result.error || 'O serviço recusou o envio.');
  return result;
}
async function pending() {
  const { items } = await request('/submissions');
  if (!Array.isArray(items)) throw new Error('Lista de envios inválida.');
  $('#pending').replaceChildren();
  if (!items.length) { const p = document.createElement('p'); p.className = 'help'; p.textContent = 'Nenhum envio aguardando. Sua próxima ideia entra por aqui.'; $('#pending').append(p); }
  for (const item of items) {
    const div = document.createElement('div'); div.className = 'pending-item';
    const title = document.createElement('strong'); title.textContent = item.title;
    const date = document.createElement('small'); date.textContent = `${new Date(item.createdAt).toLocaleString('pt-BR')} · ${item.imageCount} print(s)`;
    div.append(title, date); $('#pending').append(div);
  }
}
async function login(api, key) {
  session = { api: apiUrl(api), key: key.trim() };
  if (!/^[a-f0-9]{64}$/.test(session.key)) { session = null; throw new Error('Cole a chave privada de envio completa.'); }
  try {
    const info = await request('/session');
    if (info.role !== 'send') throw new Error('Use a chave de envio no celular. A chave de recebimento fica no computador.');
  } catch (err) { session = null; throw err; }
  // Session storage holds this tab's session. Only the non-secret address is remembered across sessions.
  try { sessionStorage.setItem('fluir.mobile.session', JSON.stringify(session)); localStorage.setItem('fluir.mobile.api', session.api); } catch { /* Private browsing can disable storage. */ }
  $('#key').value = ''; $('#login').hidden = true; $('#workspace').hidden = false; $('#connection').textContent = 'Conectado';
  notice('Sua caixa está pronta para receber.'); await pending();
}
function resetImages() { images.forEach(img => URL.revokeObjectURL(img.url)); images = []; renderImages(); }
function renderImages() {
  $('#previews').replaceChildren();
  images.forEach((img, index) => {
    const div = document.createElement('div'); div.className = 'preview';
    const preview = document.createElement('img'); preview.src = img.url; preview.alt = `Conferir print: ${img.name}`;
    const a = document.createElement('a'); a.href = img.url; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', preview.alt); a.append(preview);
    const span = document.createElement('span'); span.textContent = `${img.name} · ${Math.ceil(img.bytes.length / 1024)} KB`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remover'; remove.onclick = () => { if (busy) return; URL.revokeObjectURL(img.url); images.splice(index, 1); renderImages(); };
    div.append(a, span, remove); $('#previews').append(div);
  });
}
async function prepareImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 15 * 1024 * 1024) throw new Error('Escolha prints PNG, JPG ou WEBP de até 15 MB.');
  let blob = file;
  if (file.size > 1048576) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      if (bitmap.width * bitmap.height > 48000000) throw new Error('O print tem resolução muito alta. Recorte a parte do briefing e envie novamente.');
      let edge = Math.min(3000, Math.max(bitmap.width, bitmap.height));
      for (let attempt = 0; attempt < 7; attempt++) {
        const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88)); canvas.width = 1; canvas.height = 1;
        if (blob && blob.size <= 1048576) break; edge *= .8;
      }
    } finally { bitmap.close(); }
  }
  if (!blob || blob.size > 1048576) throw new Error('Não foi possível otimizar este print. Recorte a área do briefing.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { name: file.name.slice(0, 120) || 'Print', type: blob.type, size: bytes.length, sha256: await hash(bytes), bytes, url: URL.createObjectURL(blob) };
}
function base64(bytes) { let result = ''; for (const b of bytes) result += String.fromCharCode(b); return btoa(result); }
$('#login').onsubmit = event => { event.preventDefault(); void run(() => login($('#api').value.trim(), $('#key').value)); };
$('#images').onchange = event => {
  const files = [...event.target.files];
  void run(async () => {
    if (images.length + files.length > 4) throw new Error('Envie até 4 prints por mensagem.');
    notice('Preparando os prints…');
    for (const file of files) { images.push(await prepareImage(file)); renderImages(); }
    $('#images').value = ''; notice('Confira a legibilidade dos prints antes de enviar.');
  });
};
$('#submission').onsubmit = event => {
  event.preventDefault();
  void run(async () => {
    const title = $('#title').value.trim(); const body = $('#body').value.trim();
    if (!title || (!body && !images.length)) throw new Error('Dê um nome ao envio e adicione texto ou um print.');
    const payload = { title, body, images: images.map(({ name, type, size, sha256 }) => ({ name, type, size, sha256 })) };
    const fingerprint = JSON.stringify(payload);
    if (!job || job.fingerprint !== fingerprint) job = { id: crypto.randomUUID(), fingerprint };
    notice('Enviando sua ideia…');
    const created = await request('/submissions', 'POST', { id: job.id, ...payload });
    if (!created.ready) {
      let uploaded = 0; const total = images.reduce((n, img) => n + Math.ceil(img.size / CHUNK), 0);
      for (let i = 0; i < images.length; i++) for (let c = 0; c < Math.ceil(images[i].size / CHUNK); c++) {
        await request(`/submissions/${job.id}/images/${i}/chunks/${c}`, 'PUT', { data: base64(images[i].bytes.slice(c * CHUNK, (c + 1) * CHUNK)) });
        notice(`Enviando prints · ${++uploaded} de ${total} partes…`);
      }
      await request(`/submissions/${job.id}/complete`, 'POST', {});
    }
    $('#submission').reset(); resetImages(); job = null;
    notice('Enviado! Abra “Do celular” no Fluir para separar e revisar as demandas.');
    try { await pending(); } catch { /* A successful send must not be presented as failed if refreshing the list fails. */ }
  });
};
$('#refresh').onclick = () => { void run(pending); };
$('#logout').onclick = () => {
  if (busy) return; session = null; job = null; try { sessionStorage.removeItem('fluir.mobile.session'); } catch { /* disabled storage */ }
  $('#submission').reset(); resetImages(); $('#pending').replaceChildren(); $('#workspace').hidden = true; $('#login').hidden = false; $('#connection').textContent = 'Acesso privado'; notice('Você saiu desta aba.');
};
window.addEventListener('beforeunload', event => { if (busy || $('#title').value || $('#body').value || images.length) { event.preventDefault(); event.returnValue = ''; } });
void run(async () => {
  let cached; try { cached = JSON.parse(sessionStorage.getItem('fluir.mobile.session') || 'null'); $('#api').value = localStorage.getItem('fluir.mobile.api') || ''; } catch { /* optional storage */ }
  if (cached) { await login(cached.api, cached.key); return; }
  try { const config = await (await fetch('config.json', { cache: 'no-store' })).json(); if (config.api) $('#api').value = apiUrl(config.api); } catch { /* Address can always be entered manually. */ }
});
