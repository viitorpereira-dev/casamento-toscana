import test from 'node:test';
import assert from 'node:assert/strict';
import { GIFT_CATEGORIES, createGiftCategoryFilters, getGiftCategoryFilters, giftCategoryLabel, normalizeGiftCategory } from '../gift-categories.js';

class Element {
  constructor(document) {
    this.ownerDocument = document;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.events = {};
    this.value = '';
  }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { this.events[name] = listener; }
  contains(element) { return !!element && (element === this || this.children.some((child) => child.contains(element))); }
  closest() { return this.dataset.filter ? this : null; }
  querySelectorAll() { return this.children.filter((child) => child.dataset.filter); }
  querySelector(selector) { return this.children.find((child) => selector.includes('"' + child.dataset.filter + '"')); }
  focus() { this.ownerDocument.activeElement = this; }
  dispatch(name, event = {}) { this.events[name]?.(event); }
}

const setup = () => {
  const document = { activeElement: null, createElement() { return new Element(this); } };
  const buttons = new Element(document);
  const select = new Element(document);
  const changes = [];
  const filters = createGiftCategoryFilters({ buttonContainer: buttons, select, onChange: (value) => changes.push(value) });
  return { buttons, select, changes, filters };
};

test('legacy and unknown categories remain reachable with readable labels', () => {
  assert.equal(normalizeGiftCategory(' ELETRODOMESTICOS '), 'eletrodomesticos');
  assert.equal(normalizeGiftCategory('quarto'), 'cama-banho');
  assert.equal(normalizeGiftCategory('sala'), 'decoracao');
  assert.equal(normalizeGiftCategory('categoria-antiga'), 'outros');
  assert.equal(giftCategoryLabel('lua-de-mel'), 'Lua de mel');
  assert.equal(giftCategoryLabel(null), 'Outros');
  assert.equal(new Set(GIFT_CATEGORIES.map((category) => category.id)).size, GIFT_CATEGORIES.length);
});

test('filters show only categories present in the supplied catalog, in category order', () => {
  const filters = getGiftCategoryFilters([
    { category: 'moveis' }, { category: 'eletrodomesticos' }, { category: 'quarto' },
    { category: 'eletrodomesticos' }, { category: 'future-category' }
  ]);
  assert.deepEqual(filters.map(({ id, count }) => ({ id, count })), [
    { id: 'todos', count: 5 }, { id: 'eletrodomesticos', count: 2 },
    { id: 'moveis', count: 1 }, { id: 'cama-banho', count: 1 }, { id: 'outros', count: 1 }
  ]);
});

test('desktop buttons and mobile selection keep the same active filter', () => {
  const { buttons, select, changes, filters } = setup();
  filters.render([{ category: 'cozinha' }, { category: 'lavanderia' }]);
  const laundry = buttons.children.find((button) => button.dataset.filter === 'lavanderia');
  buttons.dispatch('click', { target: laundry });
  assert.equal(filters.value, 'lavanderia');
  assert.equal(select.value, 'lavanderia');
  assert.equal(laundry.attributes['aria-pressed'], 'true');
  assert.equal(laundry.attributes['aria-label'], 'Lavanderia: 1 presente');
  select.value = 'cozinha';
  select.dispatch('change');
  assert.equal(filters.value, 'cozinha');
  assert.equal(laundry.attributes['aria-pressed'], 'false');
  assert.deepEqual(changes, ['lavanderia', 'cozinha']);
});

test('catalog refresh preserves an existing selection and resets categories that disappear', () => {
  const { buttons, select, filters } = setup();
  filters.render([{ category: 'lavanderia' }]);
  select.value = 'lavanderia';
  select.dispatch('change');
  filters.render([{ category: 'lavanderia' }, { category: 'lavanderia' }, { category: 'mesa' }]);
  assert.equal(filters.value, 'lavanderia');
  assert.equal(select.children.find((option) => option.value === 'lavanderia').textContent, 'Lavanderia (2)');
  filters.render([{ category: 'mesa' }]);
  assert.equal(filters.value, 'todos');
  assert.equal(select.value, 'todos');
  assert.equal(buttons.children.some((button) => button.dataset.filter === 'lavanderia'), false);
});

test('an empty catalog has a safe all-items option without empty category buttons', () => {
  const { buttons, select, filters } = setup();
  filters.render([]);
  assert.equal(filters.value, 'todos');
  assert.equal(buttons.children.length, 1);
  assert.equal(select.children[0].textContent, 'Todos (0)');
});
