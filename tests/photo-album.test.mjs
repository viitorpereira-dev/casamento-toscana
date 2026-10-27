import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// A small DOM adapter exercises the actual inline carousel with two independent albums.
class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.style = {};
    this.attributes = {}; this.events = {}; this.hidden = false; this.scrollLeft = 0;
    this.clientWidth = 400; this.clientHeight = 320; this.offsetLeft = 0;
    this.classList = { toggle() {} };
  }
  append(...children) { children.forEach((child) => { child.parentElement = this; child.offsetLeft = this.children.length * 416; this.children.push(child); }); }
  appendChild(child) { this.append(child); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
  dispatch(type, extras = {}) { this.events[type]?.forEach((handler) => handler({ preventDefault() {}, ...extras })); }
  querySelectorAll(selector) {
    const match = selector === 'img' ? (child) => child.tag === 'img' : (child) => child.className?.split(' ').includes(selector.slice(1));
    return this.children.flatMap((child) => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  scrollTo({ left }) { this.scrollLeft = left; }
}
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const controller = html.slice(html.indexOf('    const initializePhotoAlbum ='), html.indexOf("    initializePhotoAlbum({ carouselId:"));
const photo = (title) => ({ title, subtitle: 'Legenda', public_url: `https://images.invalid/${title}.jpg` });
const setup = async (storyPhotos) => {
  const elements = {};
  const albums = ['travel', 'story'];
  for (const album of albums) {
    const root = new Element();
    for (const suffix of ['carousel', 'prev', 'next', 'dots', 'count', 'empty']) elements[`${album}-${suffix}`] = new Element();
    const controls = new Element(); controls.className = 'gallery-carousel-controls';
    root.append(elements[`${album}-carousel`], controls);
    const dots = elements[`${album}-dots`]; controls.append(dots);
  }
  const opened = [];
  const Observer = class { observe() {} unobserve() {} };
  const context = vm.createContext({
    document: { getElementById: (id) => elements[id], createElement: (tag) => new Element(tag) },
    IntersectionObserver: Observer, ResizeObserver: Observer,
    window: { clearTimeout() {}, setTimeout() {}, matchMedia: () => ({ matches: true }) },
    fetch: async (url) => ({ ok: true, json: async () => ({ active: true, photos: url.endsWith('story') ? storyPhotos : [photo('Viagem 1'), photo('Viagem 2')] }) }),
    openGalleryLightbox: (item) => opened.push(item.dataset.title)
  });
  vm.runInContext(controller + `
    for (const album of ['travel','story']) initializePhotoAlbum({
      carouselId: album+'-carousel', previousId: album+'-prev', nextId: album+'-next',
      dotsId: album+'-dots', countId: album+'-count', endpoint: '/api/gallery?album='+album,
      emptyId: album+'-empty'
    });`, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { elements, opened };
};

test('new album uses its own photos, counter, arrows and lightbox source', async () => {
  const { elements: e, opened } = await setup([photo('Casal 1'), photo('Casal 2'), photo('Casal 3')]);
  assert.equal(e['story-count'].textContent, '01 / 03');
  e['story-next'].dispatch('click');
  assert.equal(e['story-count'].textContent, '02 / 03');
  assert.equal(e['story-carousel'].scrollLeft, 416);
  assert.equal(e['travel-count'].textContent, '01 / 02');
  e['story-carousel'].children[1].dispatch('click');
  assert.deepEqual(opened, ['Casal 2']);
  e['travel-next'].dispatch('click');
  assert.equal(e['travel-count'].textContent, '02 / 02');
  assert.equal(e['story-count'].textContent, '02 / 03');
});
test('dots, keyboard navigation and wrapping work per album', async () => {
  const { elements: e } = await setup([photo('Casal 1'), photo('Casal 2'), photo('Casal 3')]);
  e['story-dots'].children[2].dispatch('click');
  assert.equal(e['story-count'].textContent, '03 / 03');
  e['story-carousel'].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(e['story-count'].textContent, '01 / 03');
  e['story-prev'].dispatch('click');
  assert.equal(e['story-count'].textContent, '03 / 03');
  assert.equal(e['story-dots'].children[2].attributes['aria-selected'], 'true');
});
test('empty album shows the empty state and hides navigation', async () => {
  const { elements: e } = await setup([]);
  assert.equal(e['story-empty'].hidden, false);
  assert.equal(e['story-carousel'].hidden, true);
  assert.equal(e['story-count'].textContent, '00 / 00');
  assert.equal(e['story-carousel'].parentElement.querySelector('.gallery-carousel-controls').hidden, true);
  assert.equal(e['travel-count'].textContent, '01 / 02');
});
test('single photo remains clickable with navigation hidden', async () => {
  const { elements: e, opened } = await setup([photo('Casal')]);
  assert.equal(e['story-empty'].hidden, true);
  assert.equal(e['story-carousel'].parentElement.querySelector('.gallery-carousel-controls').hidden, true);
  e['story-carousel'].children[0].dispatch('click');
  assert.deepEqual(opened, ['Casal']);
});
