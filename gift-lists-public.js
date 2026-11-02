export const createGiftListSelector = ({ select, description, notice, onCatalog, onLoading = () => {}, beforeChange, fetchCatalog = (path) => fetch(path), location = window.location, history = window.history }) => {
  let current = null;
  let sequence = 0;
  let requestedSlug = new URL(location.href).searchParams.get('lista') || '';
  const renderOptions = (lists, selected) => {
    const values = lists.map((list) => ({ value:list.slug, label:list.name }));
    if (!selected) values.unshift({value:'',label:lists.length ? 'Escolha uma lista disponível' : 'Nenhuma lista publicada'});
    select.replaceChildren(...values.map((value) => { const option=select.ownerDocument.createElement('option'); option.value=value.value; option.textContent=value.label; return option; }));
    select.value = selected?.slug || '';
    select.disabled = lists.length === 0;
  };
  const load = async (slug = requestedSlug) => {
    requestedSlug = slug;
    const requestId = ++sequence;
    select.disabled = true;
    notice.textContent = 'Carregando lista...';
    notice.dataset.tone = '';
    onLoading();
    try {
      const response = await fetchCatalog('/api/gifts' + (slug ? '?list=' + encodeURIComponent(slug) : ''));
      const data = await response.json();
      if (requestId !== sequence) return;
      current = response.ok ? data.selectedList || null : null;
      renderOptions(Array.isArray(data.lists) ? data.lists : [], current);
      description.textContent = current?.description || '';
      notice.textContent = response.ok ? (current ? '' : 'As listas de presentes serão publicadas em breve.') : data.error || 'Não foi possível carregar esta lista.';
      notice.dataset.tone = response.ok ? '' : 'error';
      if (current) {
        requestedSlug = current.slug;
        const url = new URL(location.href); url.searchParams.set('lista',current.slug);
        history.replaceState(null,'',url.pathname + url.search + url.hash);
      }
      onCatalog({ list:current, gifts:response.ok && Array.isArray(data.gifts) ? data.gifts : [], requestedSlug, error:!response.ok });
    } catch {
      if (requestId !== sequence) return;
      current = null;
      renderOptions([],null);
      description.textContent = '';
      notice.textContent = 'Não foi possível carregar os presentes. Tente novamente.';
      notice.dataset.tone = 'error';
      onCatalog({list:null,gifts:[],requestedSlug,error:true});
    }
  };
  select.addEventListener('change', async () => {
    const next = select.value;
    if (!next || next === current?.slug) return;
    if (beforeChange && !beforeChange(next)) { select.value = current?.slug || ''; return; }
    await load(next);
  });
  return { load, get currentList() { return current; }, get requestedSlug() { return requestedSlug; } };
};
