import { GIFT_LIST_STATUSES, giftListLink } from './gift-lists.js';
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

export const createGiftListsAdmin = ({ document, request, getData, refresh, onScopeChange }) => {
  const find = (id) => document.getElementById(id);
  const form = find('list-form');
  const scope = find('gift-list-scope');
  const productList = find('gift-list-id');
  const target = find('gift-move-target');
  const cards = find('gift-lists');
  const notice = find('gift-lists-notice');
  const bulkNotice = find('gift-bulk-notice');
  const selected = new Set();
  let currentId = '';
  const lists = () => getData().lists || [];
  const gifts = () => (getData().gifts || []).filter((gift) => gift.list_id === currentId);
  const say = (element, text, tone = '') => { element.textContent = text; element.dataset.tone = tone; };
  const options = (select, values, value) => {
    select.replaceChildren(...values.map((item) => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; return option; }));
    select.value = values.some((item) => item.id === value) ? value : values[0]?.id || '';
    select.disabled = values.length === 0;
  };
  const reset = (list = {}) => {
    find('list-id').value = list.id || '';
    find('list-name').value = list.name || '';
    find('list-description').value = list.description || '';
    find('list-status').value = list.status || 'draft';
    find('list-position').value = list.position ?? Math.max(-1, ...lists().map((item) => item.position)) + 1;
  };
  const setGiftFormList = (gift = {}) => {
    const values = lists().filter((list) => list.status !== 'archived' || list.id === gift.list_id);
    options(productList, values, gift.list_id || currentId);
    productList.disabled = Boolean(gift.move_blocked) || !values.length;
    find('gift-list-lock-note').hidden = !gift.move_blocked;
  };
  const renderSelection = () => {
    const valid = new Set(gifts().filter((gift) => !gift.move_blocked).map((gift) => gift.id));
    for (const id of selected) if (!valid.has(id)) selected.delete(id);
    const boxes = [...find('gift-list').querySelectorAll('.gift-select:not(:disabled)')];
    for (const box of boxes) box.checked = selected.has(box.dataset.id);
    find('gift-selection-count').textContent = selected.size + (selected.size === 1 ? ' selecionado' : ' selecionados');
    find('gift-move-selected').disabled = !selected.size || !target.value;
    find('gift-bulk-select-all').checked = boxes.length > 0 && boxes.every((box) => selected.has(box.dataset.id));
    find('gift-bulk-select-all').indeterminate = boxes.some((box) => selected.has(box.dataset.id)) && !find('gift-bulk-select-all').checked;
    find('gift-bulk-select-all').disabled = boxes.length === 0;
  };
  scope.addEventListener('change', () => { currentId = scope.value; selected.clear(); options(target, lists().filter((list) => list.id !== currentId && list.status !== 'archived'), target.value); say(bulkNotice, ''); onScopeChange(); });
  target.addEventListener('change', renderSelection);
  find('gift-list').addEventListener('change', (event) => {
    if (!event.target.matches('.gift-select')) return;
    if (event.target.checked) selected.add(event.target.dataset.id); else selected.delete(event.target.dataset.id);
    renderSelection();
  });
  find('gift-bulk-select-all').addEventListener('change', (event) => {
    for (const box of find('gift-list').querySelectorAll('.gift-select:not(:disabled)')) {
      if (event.target.checked) selected.add(box.dataset.id); else selected.delete(box.dataset.id);
    }
    renderSelection();
  });
  find('gift-move-selected').addEventListener('click', async () => {
    if (!selected.size || !target.value) return;
    const destination = lists().find((list) => list.id === target.value);
    if (!window.confirm('Mover ' + selected.size + ' presente(s) para “' + destination.name + '”?')) return;
    find('gift-move-selected').disabled = true;
    say(bulkNotice, 'Movendo presentes...');
    try {
      const data = await request('/api/admin/data', { method: 'POST', body: JSON.stringify({ action:'move-gifts', sourceListId:currentId, targetListId:target.value, giftIds:[...selected] }) });
      selected.clear();
      await refresh();
      say(bulkNotice, data.moved + ' presente(s) movido(s) para ' + destination.name + '.', 'success');
    } catch (error) { say(bulkNotice, error.message, 'error'); }
    finally { renderSelection(); }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    say(notice, 'Salvando lista...');
    try {
      const result = await request('/api/admin/data', { method:'POST', body:JSON.stringify({ action:'upsert-gift-list', listId:find('list-id').value, name:find('list-name').value, description:find('list-description').value, status:find('list-status').value, position:find('list-position').value }) });
      currentId = result.list.id;
      selected.clear();
      await refresh();
      reset();
      onScopeChange();
      say(notice, 'Lista salva.', 'success');
    } catch (error) { say(notice, error.message, 'error'); }
    finally { button.disabled = false; }
  });
  find('list-reset').addEventListener('click', () => { reset(); say(notice, ''); find('list-name').focus(); });
  cards.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-list-action]');
    if (!button) return;
    const list = lists().find((item) => item.id === button.dataset.id);
    if (!list) return;
    const action = button.dataset.listAction;
    if (action === 'edit') { reset(list); find('list-name').focus(); return; }
    if (action === 'copy') {
      const link = giftListLink(list, window.location.href);
      const field = find('gift-lists-share'); field.hidden = false; field.value = link;
      try { await navigator.clipboard.writeText(link); say(notice, 'Link da lista copiado.', 'success'); }
      catch { field.focus(); field.select(); say(notice, 'Copie o link selecionado.'); }
      return;
    }
    if (action === 'delete' && !window.confirm('Excluir a lista vazia “' + list.name + '”?')) return;
    if (action === 'archive' && !window.confirm('Arquivar “' + list.name + '”? Produtos e pagamentos serão preservados.')) return;
    button.disabled = true;
    say(notice, 'Atualizando lista...');
    try {
      let payload;
      if (action === 'up' || action === 'down') {
        const ordered = [...lists()]; const index = ordered.findIndex((item) => item.id === list.id);
        const other = index + (action === 'up' ? -1 : 1);
        if (!ordered[other]) return;
        [ordered[index],ordered[other]] = [ordered[other],ordered[index]];
        payload = { action:'reorder-gift-lists', listIds:ordered.map((item) => item.id) };
      } else if (action === 'delete') payload = { action:'delete-gift-list', listId:list.id };
      else payload = { action:'upsert-gift-list', listId:list.id, name:list.name, description:list.description, position:list.position, status:action === 'archive' ? 'archived' : list.status === 'published' ? 'draft' : 'published' };
      await request('/api/admin/data', { method:'POST', body:JSON.stringify(payload) });
      await refresh();
      say(notice, 'Lista atualizada.', 'success');
    } catch (error) { say(notice, error.message, 'error'); }
    finally { button.disabled = false; }
  });
  return {
    get currentListId() { return currentId; },
    get gifts() { return gifts(); },
    setGiftFormList,
    renderSelection,
    selectionMarkup(gift) {
      return '<label class="gift-row__selection" title="' + (gift.move_blocked ? 'Presente com reserva ou pagamento: movimentação bloqueada' : 'Selecionar para mover') + '"><input class="gift-select" type="checkbox" data-id="' + escapeHtml(gift.id) + '" aria-label="Selecionar ' + escapeHtml(gift.name) + '" ' + (gift.move_blocked ? 'disabled' : '') + '></label>';
    },
    render() {
      if (!lists().some((list) => list.id === currentId)) currentId = lists().find((list) => list.slug === 'casamento')?.id || lists()[0]?.id || '';
      options(scope, lists().map((list) => ({id:list.id,name:list.name + ' · ' + GIFT_LIST_STATUSES[list.status]})),currentId);
      options(target, lists().filter((list) => list.id !== currentId && list.status !== 'archived'), target.value);
      const editing = getData().gifts?.find((gift) => gift.id === find('gift-form').dataset.editingId);
      setGiftFormList(editing || {});
      cards.innerHTML = lists().map((list,index) => '<article class="list-admin-row"><div><h3>' + escapeHtml(list.name) + '</h3><p>' + GIFT_LIST_STATUSES[list.status] + ' · ' + list.gift_count + ' produtos · ' + list.available_count + ' disponíveis</p>' + (list.description ? '<p>' + escapeHtml(list.description) + '</p>' : '') + '</div><div class="button-row">' +
        '<button class="button button--small button--quiet" type="button" data-list-action="edit" data-id="' + list.id + '">Editar</button>' +
        '<button class="button button--small button--quiet" type="button" data-list-action="copy" data-id="' + list.id + '" ' + (list.status !== 'published' ? 'disabled title="Publique a lista para compartilhar"' : '') + '>Copiar link</button>' +
        '<button class="button button--small button--quiet" type="button" data-list-action="publish" data-id="' + list.id + '">' + (list.status === 'published' ? 'Ocultar' : 'Publicar') + '</button>' +
        '<button class="button button--small button--quiet" type="button" data-list-action="archive" data-id="' + list.id + '" ' + (list.status === 'archived' ? 'disabled' : '') + '>Arquivar</button>' +
        '<button class="button button--small button--quiet" type="button" aria-label="Mover ' + escapeHtml(list.name) + ' para cima" data-list-action="up" data-id="' + list.id + '" ' + (!index ? 'disabled' : '') + '>↑</button>' +
        '<button class="button button--small button--quiet" type="button" aria-label="Mover ' + escapeHtml(list.name) + ' para baixo" data-list-action="down" data-id="' + list.id + '" ' + (index === lists().length-1 ? 'disabled' : '') + '>↓</button>' +
        '<button class="button button--small button--danger" type="button" data-list-action="delete" data-id="' + list.id + '" ' + (list.gift_count || list.history_count ? 'disabled title="Arquive listas com produtos ou histórico"' : '') + '>Excluir</button></div></article>').join('') || '<p class="muted">Crie sua primeira lista de presentes.</p>';
    }
  };
};
