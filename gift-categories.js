export const GIFT_CATEGORIES = Object.freeze([
  { id: 'cozinha', label: 'Utensílios de cozinha' },
  { id: 'eletrodomesticos', label: 'Eletrodomésticos' },
  { id: 'mesa', label: 'Mesa posta' },
  { id: 'moveis', label: 'Móveis' },
  { id: 'cama-banho', label: 'Cama e banho' },
  { id: 'decoracao', label: 'Decoração' },
  { id: 'eletronicos', label: 'Eletrônicos' },
  { id: 'lavanderia', label: 'Lavanderia' },
  { id: 'lua-de-mel', label: 'Lua de mel' },
  { id: 'contribuicoes', label: 'Contribuições' },
  { id: 'brincadeiras', label: 'Brincadeiras' },
  { id: 'outros', label: 'Outros' }
].map(Object.freeze));

const categoriesById = new Map(GIFT_CATEGORIES.map((category) => [category.id, category]));
const legacyCategories = new Map([['quarto', 'cama-banho'], ['sala', 'decoracao']]);

export const normalizeGiftCategory = (value) => {
  const id = String(value ?? '').trim().toLowerCase();
  return categoriesById.has(id) ? id : legacyCategories.get(id) || 'outros';
};

export const giftCategoryLabel = (value) => categoriesById.get(normalizeGiftCategory(value)).label;

export const getGiftCategoryFilters = (gifts = []) => {
  const counts = new Map();
  for (const gift of gifts) {
    const id = normalizeGiftCategory(gift.category);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [
    { id: 'todos', label: 'Todos', count: gifts.length },
    ...GIFT_CATEGORIES.filter((category) => counts.has(category.id))
      .map((category) => ({ ...category, count: counts.get(category.id) }))
  ];
};

export const createGiftCategoryFilters = ({ buttonContainer, select, onChange, controlsId = 'gift-list' }) => {
  let selected = 'todos';
  let filters = [];
  const document = (buttonContainer || select).ownerDocument;

  const syncSelection = () => {
    buttonContainer?.querySelectorAll('[data-filter]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.filter === selected));
    });
    if (select) select.value = selected;
  };

  const choose = (value) => {
    if (!filters.some((filter) => filter.id === value) || value === selected) return;
    selected = value;
    syncSelection();
    onChange(selected);
  };

  buttonContainer?.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-filter]');
    if (button && buttonContainer.contains(button)) choose(button.dataset.filter);
  });
  select?.addEventListener('change', () => choose(select.value));

  return {
    get value() { return selected; },
    render(gifts) {
      filters = getGiftCategoryFilters(gifts);
      if (!filters.some((filter) => filter.id === selected)) selected = 'todos';
      const focusedCategory = buttonContainer?.contains(document.activeElement)
        ? document.activeElement.dataset.filter : null;
      if (buttonContainer) {
        buttonContainer.replaceChildren(...filters.map((filter) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'gift-filter';
          button.dataset.filter = filter.id;
          button.textContent = filter.label + ' (' + filter.count + ')';
          button.setAttribute('aria-controls', controlsId);
          button.setAttribute('aria-label', filter.label + ': ' + filter.count + (filter.count === 1 ? ' presente' : ' presentes'));
          return button;
        }));
      }
      if (select) {
        select.replaceChildren(...filters.map((filter) => {
          const option = document.createElement('option');
          option.value = filter.id;
          option.textContent = filter.label + ' (' + filter.count + ')';
          return option;
        }));
      }
      syncSelection();
      if (focusedCategory) {
        buttonContainer.querySelector('[data-filter="' + focusedCategory + '"]')?.focus();
      }
    }
  };
};
