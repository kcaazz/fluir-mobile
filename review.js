'use strict';
// Preview uses the same parser as Fluir 1.4. The original message is sent intact,
// preserving ambiguous values and context for the final review on Windows.
window.FluirTextReview = {
  create({ text, onChange }) {
    const $ = selector => document.querySelector(selector);
    let source = null; let count = 0;
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
    const date = value => value ? value.split('-').reverse().join('/') : 'Completar no Fluir';
    const priority = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
    function element(tag, className, content) { const el = document.createElement(tag); if (className) el.className = className; if (content !== undefined) el.textContent = content; return el; }
    function update() {
      const changed = source !== null && source !== text.value;
      $('#review-stale').hidden = !changed;
      $('#review-summary').textContent = changed ? 'Atualize a separação antes de enviar.' : source !== null ? `${count} demanda${count === 1 ? '' : 's'} identificada${count === 1 ? '' : 's'}.` : text.value.trim() ? 'Clique em Separar demandas para conferir.' : 'Cole a mensagem para começar.';
      onChange?.();
    }
    function separate() {
      // No historic client data is uploaded from Windows to the site.
      const drafts = window.FluirIntake.parse(text.value, { entryDate: today() }, 'auto', []);
      const fragment = document.createDocumentFragment();
      drafts.forEach((draft, index) => {
        const card = element('article', 'review-card');
        card.append(element('span', 'review-number', `DEMANDA ${String(index + 1).padStart(2, '0')}`), element('h4', '', draft.title));
        const details = element('dl', 'review-meta');
        for (const [label, value] of [['Cliente', draft.client || 'Completar no Fluir'], ['Artista', draft.artist || 'Completar no Fluir'], ['Entrada', date(draft.entryDate)], ['Entrega', date(draft.dueDate)], ['Prioridade', priority[draft.priority] || 'Normal']]) {
          const row = element('div'); row.append(element('dt', '', label), element('dd', '', value)); details.append(row);
        }
        card.append(details);
        if (draft.sharedMoney) {
          const shared = draft.sharedMoney;
          const values = [['totalCents', 'Valor'], ['paidCents', 'Já pago']].filter(([key]) => shared[key] !== undefined).map(([key, label]) => `${label}: ${money(shared[key])}`).join(' · ');
          const scope = { unit: 'Valor por demanda.', batch: 'Total do lote.', monthly: 'Pacote mensal: vincule ao contrato no Fluir.', ambiguous: 'Defina no Fluir se o valor é por demanda ou total do lote.' }[shared.scope];
          card.append(element('p', 'review-money', `${values} · ${scope || 'Confira a aplicação do valor no Fluir.'}`));
          if (['unit', 'batch'].includes(shared.scope)) card.append(element('p', 'help', `Nesta ficha: ${money(draft.totalCents)} · já pago: ${money(draft.paidCents)}`));
        } else if (draft.totalCents || draft.paidCents) card.append(element('p', 'review-money', `Valor desta demanda: ${money(draft.totalCents)} · já pago: ${money(draft.paidCents)}`));
        if (draft.context && Object.keys(draft.context).length) card.append(element('p', 'review-context', 'Contexto do texto aplicado a esta ficha. Informações específicas têm preferência.'));
        for (const warning of draft.warnings || []) card.append(element('p', 'review-warning', warning));
        const briefing = element('details', 'review-briefing'); briefing.open = true;
        briefing.append(element('summary', '', 'Briefing e referências'), element('div', 'review-body', draft.briefing));
        card.append(briefing); fragment.append(card);
      });
      $('#review-items').replaceChildren(fragment); $('#text-review').hidden = false;
      source = text.value; count = drafts.length; update();
      return count;
    }
    text.addEventListener('input', update);
    return {
      separate,
      get count() { return count; },
      get ready() { return !text.value.trim() || (source !== null && source === text.value); },
      reset() { source = null; count = 0; $('#review-items').replaceChildren(); $('#text-review').hidden = true; update(); }
    };
  }
};
