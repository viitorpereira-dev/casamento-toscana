import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost, onRequestPatch, onRequestDelete } from '../functions/api/gallery.js';
import { createAdminSession } from '../functions/_shared.js';

const env = { SUPABASE_URL: 'https://test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key', ADMIN_SESSION_SECRET: 'test-session-secret' };
const travelId = '11111111-1111-4111-8111-111111111111';
const storyId = '22222222-2222-4222-8222-222222222222';
const storyId2 = '33333333-3333-4333-8333-333333333333';
let photos, calls, token;
const json = (value, status = 200) => Response.json(value, { status });
beforeEach(async () => {
  photos = [
    { id: travelId, storage_path: 'travel.jpg', title: 'Viagem', position: 0 },
    { id: storyId, storage_path: 'story/first.jpg', title: 'Capítulo 1', position: 1 },
    { id: storyId2, storage_path: 'story/second.jpg', title: 'Capítulo 2', position: 2 }
  ];
  calls = [];
  token = await createAdminSession(env);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method || 'GET';
    calls.push({ url, method, body: options.body });
    if (url.pathname.includes('/storage/')) return json({});
    if (url.pathname.endsWith('/gallery_state')) return json([{ is_active: true }]);
    if (url.pathname.endsWith('/rpc/reorder_gallery_photos')) return json(null);
    assert.ok(url.pathname.endsWith('/gallery_photos'), `Unexpected endpoint ${url}`);
    let matching = photos.filter((photo) => {
      const filter = url.searchParams.get('storage_path');
      if (filter === 'like.story/*' && !photo.storage_path.startsWith('story/')) return false;
      if (filter === 'not.like.story/*' && photo.storage_path.startsWith('story/')) return false;
      const id = url.searchParams.get('id');
      return !id || id === `eq.${photo.id}`;
    });
    if (method === 'GET') return json(matching);
    if (method === 'PATCH') return json(matching.map((photo) => Object.assign(photo, JSON.parse(options.body))));
    if (method === 'DELETE') { photos = photos.filter((photo) => !matching.includes(photo)); return new Response(null, { status: 204 }); }
    if (method === 'POST') { const photo = JSON.parse(options.body); photos.push(photo); return json([photo]); }
    throw new Error(`Unexpected method ${method}`);
  };
});
const request = (method, album, body, authenticated = true) => new Request(`https://wedding.invalid/api/gallery${album === undefined ? '' : `?album=${album}`}`, {
  method,
  headers: { ...(authenticated ? { Cookie: `admin_session=${token}` } : {}), ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
  ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) })
});
const update = (id) => ({ action: 'update', id, title: 'Editada', subtitle: 'Legenda', framingZoom: 1, framingX: 0, framingY: 0 });

test('legacy gallery URL only returns travel photos', async () => {
  const data = await (await onRequestGet({ request: request('GET'), env })).json();
  assert.deepEqual(data.photos.map((p) => p.id), [travelId]);
  assert.equal(data.active, true);
});
test('story gallery is isolated and keeps encoded storage URLs', async () => {
  const data = await (await onRequestGet({ request: request('GET', 'story'), env })).json();
  assert.deepEqual(data.photos.map((p) => p.id), [storyId, storyId2]);
  assert.match(data.photos[0].public_url, /\/gallery\/story\/first.jpg$/);
  assert.ok(!calls.some((call) => call.url.pathname.endsWith('gallery_state')));
});
test('empty story album remains active without travel demo content', async () => {
  photos = photos.filter((p) => !p.storage_path.startsWith('story/'));
  const data = await (await onRequestGet({ request: request('GET', 'story'), env })).json();
  assert.deepEqual(data, { active: true, photos: [] });
});
test('invalid album is rejected before accessing storage', async () => {
  assert.equal((await onRequestGet({ request: request('GET', 'unknown'), env })).status, 422);
  assert.equal(calls.length, 0);
});
test('all writes require an authenticated administrator', async () => {
  for (const [method, handler] of [['POST', onRequestPost], ['PATCH', onRequestPatch], ['DELETE', onRequestDelete]]) {
    const response = await handler({ request: request(method, 'story', { id: storyId }, false), env });
    assert.equal(response.status, 401);
  }
  assert.equal(calls.length, 0);
});
test('editing an ID from the other album cannot change it', async () => {
  const response = await onRequestPatch({ request: request('PATCH', 'story', update(travelId)), env });
  assert.equal(response.status, 404);
  assert.equal(photos[0].title, 'Viagem');
});
test('editing story metadata and framing preserves travel photo', async () => {
  assert.equal((await onRequestPatch({ request: request('PATCH', 'story', update(storyId)), env })).status, 200);
  assert.equal(photos[1].title, 'Editada');
  assert.equal(photos[0].title, 'Viagem');
});
test('deleting from wrong album never deletes storage or metadata', async () => {
  const response = await onRequestDelete({ request: request('DELETE', 'story', { id: travelId }), env });
  assert.equal(response.status, 404);
  assert.ok(!calls.some((call) => call.method === 'DELETE'));
});
test('deleting a story photo deletes its folder object only', async () => {
  assert.equal((await onRequestDelete({ request: request('DELETE', 'story', { id: storyId }), env })).status, 200);
  assert.deepEqual(photos.map((p) => p.id), [travelId, storyId2]);
  assert.ok(calls.some((call) => call.method === 'DELETE' && call.url.pathname.endsWith('/story/first.jpg')));
});
test('reordering a story album preserves the other album order in atomic RPC', async () => {
  const response = await onRequestPatch({ request: request('PATCH', 'story', { action: 'reorder', ids: [storyId2, storyId] }), env });
  assert.equal(response.status, 200);
  const rpc = calls.find((call) => call.url.pathname.includes('/rpc/'));
  assert.deepEqual(JSON.parse(rpc.body).photo_ids, [travelId, storyId2, storyId]);
});
test('reorder rejects mixed IDs and stale lists without invoking RPC', async () => {
  for (const ids of [[travelId, storyId], [storyId]]) {
    assert.equal((await onRequestPatch({ request: request('PATCH', 'story', { action: 'reorder', ids }), env })).status, 409);
  }
  assert.ok(!calls.some((call) => call.url.pathname.includes('/rpc/')));
});
test('upload goes to story folder without activating travel gallery', async () => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0])], 'photo.png', { type: 'image/png' }));
  form.append('title', 'Nossa foto');
  const response = await onRequestPost({ request: request('POST', 'story', form), env });
  assert.equal(response.status, 201);
  assert.match(photos.at(-1).storage_path, /^story\/.*\.png$/);
  assert.equal(photos.at(-1).position, 3);
  assert.ok(!calls.some((call) => call.url.pathname.endsWith('gallery_state')));
});
