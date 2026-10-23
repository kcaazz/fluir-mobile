'use strict';
const $ = selector => document.querySelector(selector);
const CHUNK = 65536;
let session = null; let images = []; let busy = false; let job = null;
const SESSION_KEY = 'fluir.mobile.session';
const REMEMBER_KEY = 'fluir.mobile.remembered';
const review = window.FluirTextReview.create({ text: $('#body'), onChange: updateSend });
function updateSend() {
  const count = $('#body').value.trim() && review.ready ? review.count : 0;
  $('#send').disabled = busy || !session || !review.ready || (!$('#body').value.trim() && !images.length);
  $('#separate').disabled = busy || !$('#body').value.trim();
  $('#send').firstChild.textContent = busy ? 'Enviando… ' : count ? `Enviar ${count} demanda${count === 1 ? '' : 's'} para o Fluir ` : 'Enviar para o Fluir ';
}
function forgetAccess() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage may be blocked. */ }
  try { localStorage.removeItem(REMEMBER_KEY); } catch { /* Storage may be blocked. */ }
}
function storedAccess(storage, key) {
  try {
    const record = JSON.parse(storage.getItem(key) || 'null');
    if (!record) return null;
    if (typeof record.api !== 'string' || !/^[a-f0-9]{64}$/.test(record.key || '')) throw new Error('Invalid stored session');
    return { api: apiUrl(record.api), key: record.key, remember: key === REMEMBER_KEY || record.remember === true };
  } catch { try { storage.removeItem(key); } catch { /* Storage may be blocked. */ } return null; }
}
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
  updateSend();
  try { await fn(); } catch (err) { error(err); }
  finally { busy = false; document.querySelectorAll('button,input,textarea').forEach(el => { el.disabled = false; }); updateSend(); }
}
async function request(route, method = 'GET', body) {
  let response;
  try { response = await fetch(`${session.api}${route}`, { method, headers: { Authorization: `Bearer ${session.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(30000) }); }
  catch { throw new Error('Sem conexão com a caixa. Seu texto continua nesta tela; tente novamente.'); }
  let result; try { result = await response.json(); } catch { throw new Error('O serviço não respondeu corretamente. Tente novamente.'); }
  if (!response.ok) throw Object.assign(new Error(result.error || 'O serviço recusou o envio.'), { status: response.status });
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
async function login(api, key, remember = false) {
  session = { api: apiUrl(api), key: key.trim() };
  if (!/^[a-f0-9]{64}$/.test(session.key)) { session = null; throw new Error('Cole a chave privada de envio completa.'); }
  try {
    const info = await request('/session');
    if (info.role !== 'send') throw Object.assign(new Error('Use a chave de envio no celular. A chave de recebimento fica no computador.'), { status: 403 });
  } catch (err) { session = null; throw err; }
  // Persistent credentials are saved only after explicit opt-in on this device.
  let remembered = false;
  if (remember) {
    try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(session)); remembered = true; } catch { /* Report unavailable storage without blocking login. */ }
  } else { try { localStorage.removeItem(REMEMBER_KEY); } catch { /* Storage may be blocked. */ } }
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, remember: remembered })); } catch { /* Login can work without browser storage. */ }
  try { localStorage.setItem('fluir.mobile.api', session.api); } catch { /* Address storage is optional. */ }
  $('#remember').checked = remembered;
  $('#key').value = ''; $('#login').hidden = true; $('#workspace').hidden = false; $('#connection').textContent = 'Conectado';
  notice(remember && !remembered ? 'Você entrou, mas este navegador não permitiu lembrar o acesso. Use esta aba ou confira suas configurações de armazenamento.' : remembered ? 'Acesso lembrado neste dispositivo. Cole seu texto e separe as demandas para conferir.' : 'Sua caixa está pronta para receber. Cole seu texto e separe as demandas para conferir.');
  // A list refresh failure must not make a successful login look unsuccessful.
  try { await pending(); } catch (err) { error(err); }
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
$('#login').onsubmit = event => { event.preventDefault(); void run(() => login($('#api').value.trim(), $('#key').value, $('#remember').checked)); };
$('#separate').onclick = () => {
  if (busy) return;
  $('#error').hidden = true;
  try { const count = review.separate(); notice(`${count} demanda${count === 1 ? '' : 's'} identificada${count === 1 ? '' : 's'}. Confira as fichas antes de enviar.`); }
  catch (err) { error(err); }
};
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
    if (!review.ready) throw new Error('Clique em Separar demandas para conferir a mensagem atual antes de enviar.');
    const demandCount = body ? review.count : 0;
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
    $('#submission').reset(); resetImages(); job = null; review.reset();
    notice(demandCount ? `Enviado! ${demandCount} demanda${demandCount === 1 ? '' : 's'} no lote. Abra “Do celular” no Fluir para confirmar e salvar as fichas.` : 'Enviado! Abra “Do celular” no Fluir para ler os prints, separar e revisar as demandas.');
    try { await pending(); } catch { /* A successful send must not be presented as failed if refreshing the list fails. */ }
  });
};
$('#refresh').onclick = () => { void run(pending); };
$('#logout').onclick = () => {
  if (busy) return; session = null; job = null; forgetAccess(); $('#remember').checked = false;
  $('#submission').reset(); resetImages(); review.reset(); $('#pending').replaceChildren(); $('#workspace').hidden = true; $('#login').hidden = false; $('#connection').textContent = 'Acesso privado'; notice('Você saiu. O acesso salvo neste dispositivo foi apagado.');
};
window.addEventListener('beforeunload', event => { if (busy || $('#title').value || $('#body').value || images.length) { event.preventDefault(); event.returnValue = ''; } });
void run(async () => {
  let cached;
  try {
    const remembered = storedAccess(localStorage, REMEMBER_KEY);
    cached = storedAccess(sessionStorage, SESSION_KEY) || remembered;
    // Logging out in another tab must not silently restore persistent access.
    if (cached?.remember && (!remembered || remembered.api !== cached.api || remembered.key !== cached.key)) cached.remember = false;
    $('#api').value = localStorage.getItem('fluir.mobile.api') || '';
  } catch { /* Access to storage itself can be disabled. */ }
  if (cached) {
    $('#api').value = cached.api; $('#remember').checked = cached.remember;
    try { await login(cached.api, cached.key, cached.remember); return; }
    catch (err) { if ([401, 403].includes(err.status)) { forgetAccess(); $('#remember').checked = false; } error(err); }
  }
  try { const config = await (await fetch('config.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) })).json(); if (config.api && !$('#api').value) $('#api').value = apiUrl(config.api); } catch { /* Address can always be entered manually. */ }
});
