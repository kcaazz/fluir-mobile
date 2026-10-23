'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FluirIntakeFields = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const fold = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const months = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const weekdays = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
  function validDate(value) {
    const parsed = new Date(value + 'T00:00:00.000Z');
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function datePhrase(value, base) {
    const text = fold(value).trim();
    const dates = [];
    const numeric = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.\-]\d{1,2}(?:[/.\-](?:\d{4}|\d{2}))?)\b/g;
    for (const match of text.matchAll(numeric)) {
      let iso = match[0];
      if (!/^\d{4}-/.test(iso)) {
        const [day, month, year] = iso.split(/[/.\-]/);
        iso = `${year ? (year.length === 2 ? '20' + year : year) : base.slice(0, 4)}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      dates.push(validDate(iso) ? iso : null);
    }
    for (const match of text.matchAll(/\b(\d{1,2})\s+(?:de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/g)) {
      const iso = `${match[3] || base.slice(0, 4)}-${String(months.indexOf(match[2]) + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
      dates.push(validDate(iso) ? iso : null);
    }
    if (!dates.length && validDate(base)) {
      let offset;
      if (/\bdepois de amanha\b/.test(text)) offset = 2;
      else if (/\bamanha\b/.test(text)) offset = 1;
      else if (/\bhoje\b/.test(text)) offset = 0;
      else {
        const relative = text.match(/\b(?:em|daqui a)\s+(\d{1,3})\s+dias?(\s+uteis)?\b/);
        if (relative) {
          offset = Number(relative[1]);
          if (relative[2]) {
            const cursor = new Date(base + 'T00:00:00.000Z'); let remaining = offset; offset = 0;
            while (remaining) { cursor.setUTCDate(cursor.getUTCDate() + 1); offset++; if (![0, 6].includes(cursor.getUTCDay())) remaining--; }
          }
        }
        else {
          const weekday = text.match(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b/);
          if (weekday) {
            offset = (weekdays[weekday[1]] - new Date(base + 'T00:00:00.000Z').getUTCDay() + 7) % 7;
            if (offset === 0 && /\bproxim[oa]\b/.test(text)) offset = 7;
          }
        }
      }
      if (offset !== undefined) { const parsed = new Date(base + 'T00:00:00.000Z'); parsed.setUTCDate(parsed.getUTCDate() + offset); dates.push(parsed.toISOString().slice(0, 10)); }
    }
    return { found: dates.length > 0, value: dates.length && !dates.includes(null) && new Set(dates).size === 1 ? dates[0] : '', conflict: dates.length > 1 && new Set(dates).size > 1 };
  }
  function sourceCents(value) {
    let text = value.replace(/R\$/gi, '').replace(/\breais\b/gi, '').replace(/\s/g, '').trim().replace(/[.;:!?]+$/, '');
    if (/^\d+\.\d{1,2}$/.test(text)) text = text.replace('.', ',');
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) return null;
    const [integer, decimal = ''] = text.replace(/\./g, '').split(',');
    const cents = Number(integer) * 100 + Number(decimal.padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents <= 999_999_999_999 ? cents : null;
  }
  function analyze(text, base, scope = 'item') {
    const values = {}; const fields = new Set(); const blocked = new Set(); const warnings = [];
    const dateCandidates = { entryDate: [], dueDate: [] }; const priorities = []; const amounts = { totalCents: [], paidCents: [] }; const moneyLines = []; const scopes = new Set();
    for (const original of text.split(/[\n;|]/)) {
      const line = fold(original).replace(/(?:https?:\/\/|www\.)\S+/g, '').trim();
      if (!line) continue;
      const entry = line.match(/\b(?:data de entrada|entrada)\s*:\s*(.*)/);
      const delivery = line.match(/\b(?:data (?:de |da )?entrega|prazo(?: geral| de entrega)?|entreg(?:a(?:s| geral)?|ar|ues?)|finalizar|concluir|preciso (?:d[ei]sso )?para)\s*(?::|=|[–—-])?\s*(.*)/);
      const until = line.match(/\b(?:ate|para o dia|para dia)\s+(.+)/);
      if (entry && !/r\$|reais|^\s*\d+(?:[.,]\d{1,2})?\s*$/.test(entry[1])) {
        const parsed = datePhrase(entry[1], base);
        if (parsed.value) dateCandidates.entryDate.push(parsed.value);
        else { blocked.add('entryDate'); warnings.push(`Revise a data de entrada: ${original.trim()}`); }
      }
      const due = delivery?.[1] ?? until?.[1];
      if (due !== undefined) {
        const parsed = datePhrase(due.split(/r\$|\b(?:prioridade|valor|pago|preco|cache)\b/)[0], base);
        if (parsed.value) dateCandidates.dueDate.push(parsed.value);
        else if (parsed.found || /^(?:\s*[:=]?\s*)?\d|\b(?:amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(due) || /^\s*(?:data .*entrega|prazo|entrega)\s*:/.test(line)) { blocked.add('dueDate'); warnings.push(`Revise o prazo de entrega: ${original.trim()}`); }
      }
      const neutral = /\b(?:nao (?:e|esta|eh) (?:nada )?urgente|sem urgencia|nao (?:tem|ha) urgencia)\b/g;
      let notUrgent = false; const priorityCount = priorities.length;
      const priorityText = line.replace(neutral, () => { notUrgent = true; return ''; });
      if (/\b(?:urgente|urgentissimo|asap|para ontem|o mais rapido possivel)\b/.test(priorityText)) priorities.push('urgent');
      if (/\b(?:prioridade(?: geral)?\s*[:=–—-]?\s*alta|alta prioridade)\b/.test(priorityText)) priorities.push('high');
      if (/\b(?:prioridade(?: geral)?\s*[:=–—-]?\s*(?:normal|media)|(?:normal|media) prioridade)\b/.test(priorityText)) priorities.push('normal');
      if (/\b(?:sem pressa|pode esperar|baixa prioridade|prioridade(?: geral)?\s*[:=–—-]?\s*baixa)\b/.test(priorityText)) priorities.push('low');
      if (notUrgent && priorities.length === priorityCount) priorities.push('normal');
      // Campaign/ad budgets and remaining balances are not the service price.
      if (/\b(?:verba|orcamento (?:de |para )?(?:midia|anuncio|trafego)|investimento (?:de |em )?(?:midia|anuncio|trafego))\b/.test(line)) continue;
      const currency = /(?:R\$\s*-?\s*\d[\d.\u00a0 ]*(?:,\d{1,2})?|\b-?\d[\d.\u00a0 ]*(?:,\d{1,2})?\s+reais\b)/gi;
      let found = [...original.matchAll(currency)];
      if (!found.length) {
        const labelled = /\b(?:valor(?:\s+(?:unitario|individual|por video|total(?: do lote)?|mensal|da demanda|do pacote))?|cache|preco|custa|cobrar|pago|pagou|ja pago|valor pago|sinal|adiantamento|entrada)\s*(?::|=|[–—-]|de|em)?\s*(-?\d[\d.\u00a0 ]*(?:,\d{1,2})?)/gi;
        found = [...line.matchAll(labelled)].map(match => ({ 0: match[1].trim(), index: match.index + match[0].lastIndexOf(match[1]) }));
      }
      if (!found.length && /^\s*(?:valor|preco|cache|pago|valor pago)\s*:/.test(line)) warnings.push(`Revise o valor: ${original.trim()}`);
      for (const match of found) {
        const before = fold(original.slice(0, match.index));
        const after = fold(original.slice(match.index + match[0].length));
        if (/\b(?:saldo|restante|falta pagar)\s*[:=]?\s*$/.test(before)) continue;
        const paid = /\b(?:pago|pagou|sinal|adiantamento|entrada|recebido)\s*(?:[:=–—-]|de|em)?\s*$/.test(before) || /^\s*(?:ja\s+)?pag[oa]s?\b/.test(after);
        if (/^\s*(?:a|ate|ou|[–—-])\s*(?:r\$\s*)?\d/.test(after)) { blocked.add(paid ? 'paidCents' : 'totalCents'); warnings.push('Foi encontrada uma faixa de valores. Defina o valor combinado na revisão.'); continue; }
        const parsed = sourceCents(match[0]);
        if (parsed === null) { warnings.push(`Revise o valor: ${original.trim()}`); blocked.add(paid ? 'paidCents' : 'totalCents'); continue; }
        amounts[paid ? 'paidCents' : 'totalCents'].push(parsed); moneyLines.push(original.trim());
        if (/\b(?:mensal|mensalidade|pacote|por mes)\b/.test(line)) scopes.add('monthly');
        else if (/\b(?:total (?:do|deste|de todo o) lote|total (?:dos|destes) (?:videos|itens|servicos)|pelos \d+ videos|por todos (?:os )?videos)\b/.test(line) || (scope === 'context' && /\bvalor total\b/.test(line))) scopes.add('batch');
        else if (/\b(?:por (?:video|demanda|ficha|unidade)|cada (?:video|demanda|ficha)|unitario|individual)\b/.test(line)) scopes.add('unit');
      }
    }
    for (const field of ['entryDate', 'dueDate']) {
      const candidates = [...new Set(dateCandidates[field])];
      if (candidates.length === 1 && !blocked.has(field)) { values[field] = candidates[0]; fields.add(field); }
      else if (candidates.length > 1) { blocked.add(field); warnings.push(`Há mais de uma data de ${field === 'dueDate' ? 'entrega' : 'entrada'}. Escolha a correta na revisão.`); }
    }
    const ranks = [...new Set(priorities)];
    if (ranks.length === 1) { values.priority = ranks[0]; fields.add('priority'); }
    else if (ranks.length > 1) { blocked.add('priority'); warnings.push('Há indicações diferentes de prioridade. Escolha a correta na revisão.'); }
    const money = { scope: scopes.size === 1 ? [...scopes][0] : scopes.size > 1 ? 'ambiguous' : scope === 'context' ? 'ambiguous' : 'unit', note: [...new Set(moneyLines)].join('\n') };
    for (const field of ['totalCents', 'paidCents']) {
      const candidates = [...new Set(amounts[field])];
      if (candidates.length === 1 && !blocked.has(field)) money[field] = candidates[0];
      else if (candidates.length > 1) { blocked.add(field); warnings.push(`Há mais de um ${field === 'paidCents' ? 'valor pago' : 'valor de serviço'}. Escolha o correto na revisão.`); }
    }
    if (scope === 'item' && money.scope === 'unit') for (const field of ['totalCents', 'paidCents']) if (money[field] !== undefined) { values[field] = money[field]; fields.add(field); }
    for (const field of blocked) fields.add(field);
    return { values, fields: [...fields], warnings: [...new Set(warnings)], money: ['totalCents', 'paidCents'].some(field => money[field] !== undefined) ? money : null };
  }
  function allocate(items, money, choice) {
    const rows = items.map(item => ({ totalCents: item.totalCents || 0, paidCents: item.paidCents || 0 }));
    if (['ignore', 'package'].includes(choice)) return { rows };
    if (!['unit', 'batch'].includes(choice)) return { rows, error: 'Escolha se o valor do cabeçalho é por demanda ou total do lote.' };
    for (const field of ['totalCents', 'paidCents']) {
      if (money[field] === undefined) continue;
      const missing = items.map((item, index) => item.explicit?.includes(field) ? -1 : index).filter(index => index >= 0);
      if (choice === 'unit') { for (const index of missing) rows[index][field] = money[field]; continue; }
      const fixed = items.reduce((sum, item) => sum + (item.explicit?.includes(field) ? item[field] : 0), 0);
      const rest = money[field] - fixed;
      if (!Number.isSafeInteger(rest) || rest < 0 || (!missing.length && rest !== 0)) return { rows, error: `O ${field === 'paidCents' ? 'pagamento' : 'valor'} total do lote não confere com os valores específicos das fichas. Revise os valores ou a forma de aplicar.` };
      missing.forEach((index, order) => { rows[index][field] = Math.floor(rest / missing.length) + (order < rest % missing.length ? 1 : 0); });
    }
    return { rows };
  }
  return { analyze, datePhrase, sourceCents, allocate };
});
