'use strict';

// Shared by the renderer and the import tests. Parsing creates drafts only.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./intake-fields.js') : root.FluirIntakeFields);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FluirIntake = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fieldReader) {
  const fold = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const labelPattern = /^(t[ií]tulo|nome(?: da demanda)?|demanda|ficha|v[ií]deo|briefing|descri[cç][aã]o|objetivo|cliente(?: contratante)?|artista|respons[aá]vel|data de entrada|entrada|data (?:de |da )?entrega|prazo(?: geral| de entrega)?|entrega(?: geral)?|prioridade(?: geral)?|etapa|status|valor(?: unit[aá]rio| individual| total(?: do lote)?| mensal| da demanda| do pacote)?|pre[cç]o|cach[eê]|pago|j[aá] pago|valor pago|sinal|adiantamento|link(?:s)?|refer[eê]ncia(?:s)?)\s*:\s*(.*)$/i;
  const titleKeys = new Set(['titulo', 'nome', 'nome da demanda', 'demanda', 'ficha', 'video']);
  const statusMap = { 'na fila': 'inbox', fila: 'inbox', 'em criacao': 'progress', 'em producao': 'progress', 'em andamento': 'progress', 'em aprovacao': 'review', revisao: 'review', concluida: 'done', concluido: 'done', entregue: 'done', finalizado: 'done' };
  const nameKey = value => fold(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  function knownNames(demands, field) {
    return [...new Set(demands.map(demand => demand[field]).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  function canonicalName(value, names) {
    if (!value || names.includes(value)) return value;
    const matches = names.filter(name => nameKey(name) === nameKey(value));
    return matches.length === 1 ? matches[0] : value;
  }
  function namesInText(text, names) {
    const content = ` ${nameKey(text.replace(/(?:https?:\/\/|www\.)\S+/gi, ' '))} `;
    return names.filter(name => nameKey(name) && content.includes(` ${nameKey(name)} `));
  }
  function completeDraft(draft, demands = [], { inferPairs = true } = {}) {
    const clients = knownNames(demands, 'client');
    const artists = knownNames(demands, 'artist');
    const completed = { ...draft, client: canonicalName(draft.client || '', clients), artist: canonicalName(draft.artist || '', artists) };
    const suggested = [];
    const ambiguous = new Set();
    const content = [draft.title, draft.briefing].filter(Boolean).join('\n');
    // Prefer names actually present in this item's text before considering history.
    for (const [field, names] of [['client', clients], ['artist', artists]]) {
      if (completed[field]) continue;
      const matches = namesInText(content, names);
      if (matches.length === 1) { completed[field] = matches[0]; suggested.push(field); }
      else if (matches.length > 1) ambiguous.add(field);
    }
    // A known pair is only suggested when the missing side is unambiguous.
    for (const [field, other] of inferPairs ? [['artist', 'client'], ['client', 'artist']] : []) {
      if (completed[field] || !completed[other] || ambiguous.has(field)) continue;
      const related = demands.filter(demand => typeof demand[other] === 'string' && nameKey(demand[other]) === nameKey(completed[other]));
      const matches = knownNames(related, field);
      if (matches.length === 1) { completed[field] = matches[0]; suggested.push(field); }
    }
    return { ...completed, suggested };
  }
  function date(value, today) {
    let candidate = value.trim();
    const br = candidate.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/);
    if (br) candidate = `${br[3] ? (br[3].length === 2 ? '20' + br[3] : br[3]) : today.slice(0, 4)}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    const parsed = new Date(candidate + 'T00:00:00.000Z');
    return /^\d{4}-\d{2}-\d{2}$/.test(candidate) && candidate >= '1900-01-01' && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : '';
  }
  function cents(value) {
    const amount = value.replace(/^R\$\s*/i, '').trim();
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(amount)) return null;
    const [integer, decimal = ''] = amount.replace(/\./g, '').split(',');
    const number = Number(integer) * 100 + Number(decimal.padEnd(2, '0'));
    return Number.isSafeInteger(number) && number <= 999_999_999_999 ? number : null;
  }
  function marker(line) {
    return line.match(/^\s*(?:\d{1,3}[.)\-]\s+|[•●▪◦*-]\s+|(?:demanda|ficha|v[ií]deo)\s*#?\d{1,3}\s*[:.\-–—]\s*)(.+)$/i);
  }
  function split(text, mode) {
    const lines = text.split('\n');
    if (mode === 'lines') return lines.filter(line => line.trim()).map(line => marker(line)?.[1] || line.trim());
    if (mode === 'paragraphs') return text.split(/\n\s*\n/).filter(part => part.trim());
    if (mode === 'single') return [text];
    const numbered = lines.filter(line => /^\s*(?:\d{1,3}[.)\-]\s+|(?:demanda|v[ií]deo)\s*#?\d{1,3}\s*[:.\-–—]\s*)/i.test(line)).length >= 2;
    const titled = lines.filter(line => { const m = line.trim().match(labelPattern); return m && titleKeys.has(fold(m[1])); }).length >= 2;
    const bullets = lines.filter(line => /^\s*[•●▪◦*-]\s+/.test(line)).length >= 2;
    if (numbered || titled || bullets) {
      const chunks = []; let current = [];
      for (const line of lines) {
        const starts = numbered ? /^\s*(?:\d{1,3}[.)\-]\s+|(?:demanda|v[ií]deo)\s*#?\d{1,3}\s*[:.\-–—]\s*)/i.test(line)
          : titled ? (() => { const m = line.trim().match(labelPattern); return m && titleKeys.has(fold(m[1])); })()
          : /^\s*[•●▪◦*-]\s+/.test(line);
        if (starts && current.some(part => part.trim())) chunks.push(current.join('\n'));
        if (starts) current = [];
        current.push(line);
      }
      if (current.some(part => part.trim())) chunks.push(current.join('\n'));
      return chunks;
    }
    const parts = text.split(/\n\s*(?:---+|===+)\s*\n/);
    if (parts.length > 1) return parts.filter(part => part.trim());
    return text.split(/\n\s*\n/).filter(part => part.trim());
  }
  const contextKeys = ['client', 'artist', 'entryDate', 'dueDate', 'priority'];
  const generalHeading = /^\s*(?:observa[cç][oõ]es gerais|orienta[cç][oõ]es gerais|instru[cç][oõ]es gerais|contexto geral|para tod[oa]s? (?:[oa]s? )?(?:v[ií]deos|demandas|fichas)|tod[oa]s? (?:[oa]s? )?(?:v[ií]deos|demandas|fichas))\b/i;
  function normalizeDocument(text) {
    const lines = text.split('\n'); const normalized = [];
    const labels = '(?:cliente(?: contratante)?|artista|respons[aá]vel|data de entrada|data (?:de |da )?entrega|prazo(?: geral| de entrega)?|entrega(?: geral)?|prioridade(?: geral)?|valor(?: unit[aá]rio| individual| total(?: do lote)?| mensal| da demanda| do pacote)?|pre[cç]o|cach[eê]|j[aá] pago|valor pago|pago|sinal|adiantamento)';
    const onlyLabel = new RegExp('^' + labels + '\\s*:?$', 'i');
    const beginsLabel = new RegExp('^' + labels + '\\s*[:=–—-]', 'i');
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index];
      const clean = raw.trim().replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '');
      // OCR can put a field label and its value on separate lines.
      if (onlyLabel.test(clean)) {
        let next = index + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next < lines.length && !lines[next].trim().match(labelPattern) && !marker(lines[next]) && !onlyLabel.test(lines[next].trim())) {
          normalized.push(clean.replace(/:$/, '') + ': ' + lines[next].trim()); index = next; continue;
        }
      }
      // A header can put both identities in the same line, with separators or prose.
      if (beginsLabel.test(clean)) {
        const matches = [...clean.matchAll(new RegExp('\\b(' + labels + ')\\s*[:=–—-]\\s*', 'gi'))];
        for (let part = 0; part < matches.length; part++) {
          const value = clean.slice(matches[part].index + matches[part][0].length, matches[part + 1]?.index ?? clean.length).replace(/\s*(?:[|;,/·–—]+|\be)\s*$/gi, '').trim();
          normalized.push(matches[part][1] + ': ' + value);
        }
        continue;
      }
      normalized.push(clean.match(labelPattern) ? clean : raw);
    }
    return normalized.join('\n');
  }
  function readContext(text, knownDemands, today = new Date().toISOString().slice(0, 10)) {
    const raw = parseBlock(text, { entryDate: today }, 'context');
    const recognized = completeDraft({ ...raw, title: '', briefing: text }, knownDemands, { inferPairs: false });
    const fields = Object.fromEntries(contextKeys.filter(key => raw.fields.includes(key) || (['client', 'artist'].includes(key) && recognized[key])).map(key => [key, recognized[key]]));
    let remainder = ` ${nameKey(text)} `;
    for (const key of ['client', 'artist']) if (fields[key]) remainder = ` ${remainder.split(` ${nameKey(fields[key])} `).join(' ').trim()} `;
    remainder = remainder.replace(/\b(?:cliente|contratante|artista|responsavel|para|todos|todas|os|as|videos|demandas|fichas|do|da|de|e|projeto|campanha)\b/g, '').trim();
    const identityOnly = Boolean(fields.client || fields.artist) && !remainder;
    return { fields, note: raw.hasContent && !identityOnly ? raw.briefing : '', isHeader: !raw.hasContent || identityOnly, money: raw.money, warnings: raw.warnings };
  }
  function documentParts(text, mode, knownDemands, today) {
    if (mode === 'single') return [{ kind: 'item', text }];
    const lines = text.split('\n');
    const numbered = /^\s*(?:\d{1,3}[.)\-]\s+|(?:demanda|ficha|v[ií]deo)\s*#?\d{1,3}\s*[:.\-–—]\s*)/i;
    const titled = line => { const match = line.trim().match(labelPattern); return match && titleKeys.has(fold(match[1])); };
    const bullets = /^\s*[•●▪◦*-]\s+/;
    let starts;
    if (mode === 'auto') {
      if (lines.some(line => numbered.test(line))) starts = line => numbered.test(line);
      else if (lines.some(titled)) starts = titled;
      else if (lines.filter(line => bullets.test(line)).length >= 2) starts = line => bullets.test(line);
    }
    if (!starts) return split(text, mode).map(part => ({ kind: readContext(part, knownDemands, today).isHeader ? 'context' : 'item', text: part }));
    const parts = []; let current = []; let itemStarted = false;
    function flush(kind) { if (current.some(line => line.trim())) parts.push({ kind, text: current.join('\n') }); current = []; }
    for (const line of lines) {
      if (starts(line)) {
        const headers = [];
        // A separate client/artist header between numbered groups changes scope.
        if (itemStarted) {
          while (current.length && !current.at(-1).trim()) current.pop();
          while (current.length) {
            const gap = current.findLastIndex(value => !value.trim());
            if (gap < 0) break;
            const tail = current.slice(gap + 1).join('\n');
            const context = readContext(tail, knownDemands, today);
            if (!context.isHeader || !(context.fields.client || context.fields.artist)) break;
            headers.unshift({ kind: 'context', text: tail }); current = current.slice(0, gap);
            while (current.length && !current.at(-1).trim()) current.pop();
          }
        }
        flush(itemStarted ? 'item' : 'context'); parts.push(...headers); itemStarted = true;
      }
      current.push(line);
    }
    // A clearly named general note after the list applies to the document too.
    const generalIndex = current.findIndex((line, index) => index > 0 && generalHeading.test(line));
    if (generalIndex >= 0) {
      const general = current.slice(generalIndex).join('\n'); current = current.slice(0, generalIndex);
      flush(itemStarted ? 'item' : 'context'); parts.push({ kind: 'global', text: general });
    } else flush(itemStarted ? 'item' : 'context');
    return parts;
  }
  function parseBlock(block, defaults, scope = 'item') {
    const draft = { title: '', briefing: '', client: defaults.client || '', artist: defaults.artist || '', entryDate: defaults.entryDate, dueDate: '', priority: defaults.priority || 'normal', status: 'inbox', billingType: 'single', packageName: '', totalCents: 0, paidCents: 0, links: [] };
    const briefing = []; const warnings = []; const fields = new Set(); let hasContent = false;
    for (const [index, raw] of block.trim().split('\n').entries()) {
      const line = index === 0 && marker(raw) ? marker(raw)[1] : raw.trim();
      const match = line.match(labelPattern);
      if (match) {
        const key = fold(match[1]); const value = match[2].trim();
        if (titleKeys.has(key)) { draft.title = value; fields.add('title'); hasContent = true; continue; }
        if (key.startsWith('cliente')) { draft.client = value; fields.add('client'); continue; }
        if (['artista', 'responsavel'].includes(key)) { draft.artist = value; fields.add('artist'); continue; }
        if (['status', 'etapa'].includes(key) && statusMap[fold(value)]) { draft.status = statusMap[fold(value)]; continue; }
        if (/^(?:entrada|data |prazo|entrega|prioridade|valor|preco|cache|pago|ja pago|sinal|adiantamento)/.test(key)) { briefing.push(line); continue; }
        if (['briefing', 'descricao', 'objetivo'].includes(key)) { briefing.push(value); hasContent = true; continue; }
      }
      briefing.push(line);
      if (line && !/^(?:---+|===+)$/.test(line)) hasContent = true;
    }
    const content = briefing.join('\n').trim();
    const recognized = fieldReader.analyze(block, defaults.entryDate, scope);
    Object.assign(draft, recognized.values);
    recognized.fields.forEach(field => fields.add(field));
    warnings.push(...recognized.warnings);
    if (!draft.title && content) draft.title = content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 160);
    draft.briefing = content || draft.title;
    if (draft.briefing.length > 20000) warnings.push('O briefing ultrapassa 20.000 caracteres. Divida ou reduza o texto antes de salvar.');
    return { ...draft, warnings, fields: [...fields], hasContent, money: recognized.money };
  }
  function parse(text, defaults = {}, mode = 'auto', knownDemands = []) {
    if (typeof text !== 'string' || text.length > 100000) throw new Error('Cole até 100.000 caracteres por importação.');
    if (!['auto', 'lines', 'paragraphs', 'single'].includes(mode)) throw new Error('Escolha um modo de separação válido.');
    const clean = normalizeDocument(text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim());
    if (!clean) throw new Error('Cole um texto ou leia um print para começar.');
    const today = defaults.entryDate || new Date().toISOString().slice(0, 10);
    const parts = documentParts(clean, mode, knownDemands, today);
    const drafts = []; let shared = {}; let notes = []; let sharedWarnings = []; let sharedMoney = null; let moneySequence = 0;
    const general = parts.filter(part => part.kind === 'global').map(part => readContext(part.text, knownDemands, today));
    const generalMoney = general.filter(info => info.money).at(-1)?.money;
    const finalMoney = generalMoney ? { ...generalMoney, id: `money-${moneySequence++}` } : null;
    for (const part of parts) {
      if (part.kind === 'global') continue;
      if (part.kind === 'context') {
        const context = readContext(part.text, knownDemands, today);
        if (context.fields.client && shared.client && nameKey(context.fields.client) !== nameKey(shared.client)) { delete shared.artist; notes = []; sharedWarnings = []; sharedMoney = null; }
        shared = { ...shared, ...context.fields };
        if (context.money) sharedMoney = { ...context.money, id: `money-${moneySequence++}` };
        if (context.note) notes.push(context.note);
        sharedWarnings.push(...context.warnings);
        continue;
      }
      const raw = parseBlock(part.text, { entryDate: today });
      const local = completeDraft(raw, knownDemands, { inferPairs: false });
      const context = Object.assign({}, shared, ...general.map(info => info.fields));
      const inherited = [];
      for (const key of contextKeys) {
        if (raw.fields.includes(key) || (['client', 'artist'].includes(key) && local[key])) continue;
        if (key === 'artist' && local.client && context.client && nameKey(local.client) !== nameKey(context.client)) continue;
        if (context[key]) { local[key] = context[key]; inherited.push(key); }
        else if (defaults[key]) local[key] = defaults[key];
      }
      const completed = completeDraft(local, knownDemands);
      completed.warnings = [...new Set([...completed.warnings, ...sharedWarnings, ...general.flatMap(info => info.warnings)])];
      const contextNote = [...notes, ...general.map(info => info.note).filter(Boolean)].join('\n\n');
      if (contextNote) completed.briefing = `${completed.briefing}\n\nContexto geral:\n${contextNote}`;
      const money = raw.money && raw.money.scope !== 'unit' ? { ...raw.money, id: `money-${moneySequence++}` } : finalMoney || sharedMoney;
      if (money?.note && !completed.briefing.includes(money.note)) completed.briefing += `\n\nValores no contexto:\n${money.note}`;
      if (completed.briefing.length > 20000 && !completed.warnings.some(message => message.includes('20.000'))) completed.warnings.push('O briefing com o contexto ultrapassa 20.000 caracteres. Reduza-o antes de salvar.');
      drafts.push({ ...completed, suggested: [...new Set([...local.suggested, ...completed.suggested])], context: Object.fromEntries(inherited.map(key => [key, completed[key]])), sharedMoney: money, moneyExplicit: raw.fields.filter(field => ['totalCents', 'paidCents'].includes(field)), moneyBase: { totalCents: completed.totalCents, paidCents: completed.paidCents } });
    }
    if (!drafts.length) throw new Error('Identifiquei apenas o cabeçalho. Adicione as demandas abaixo dele para separar.');
    if (drafts.length > 100) throw new Error('Separe o conteúdo em lotes de até 100 demandas.');
    for (const money of [...new Map(drafts.filter(draft => draft.sharedMoney).map(draft => [draft.sharedMoney.id, draft.sharedMoney])).values()]) {
      const linked = drafts.filter(draft => draft.sharedMoney?.id === money.id);
      const result = fieldReader.allocate(linked.map(draft => ({ ...draft, explicit: draft.moneyExplicit })), money, ['unit', 'batch'].includes(money.scope) ? money.scope : '');
      if (!result.error) linked.forEach((draft, index) => Object.assign(draft, result.rows[index]));
    }
    return drafts;
  }
  return { parse, cents, knownNames, completeDraft };
});
