import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/admin/data.js';
import { onRequestGet } from '../functions/api/gifts.js';
import { createAdminSession } from '../functions/_shared.js';

const env = { SUPABASE_URL: 'https://test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key', ADMIN_SESSION_SECRET: 'test-session-secret' };
let token, calls;
beforeEach(async () => {
  token = await createAdminSession(env);
  calls = [];
  globalThis.fetch = async (input, options = {}) => {
    calls.push({ input, options });
    if (options.method === 'POST') return Response.json([JSON.parse(options.body)]);
    if (new URL(input).pathname.endsWith('/gift_lists')) return Response.json([{id:'00000000-0000-0000-0000-000000000001',slug:'casamento',name:'Casamento',status:'published',position:0}]);
    if (new URL(input).pathname.endsWith('/gifts') && new URL(input).searchParams.has('id')) return Response.json([]);
    if (new URL(input).pathname.endsWith('/gift_claims')) return Response.json([]);
    return Response.json([
      { id: 'wardrobe', name: 'Guarda-roupa', category: 'moveis', price: 100, available: true },
      { id: 'linen', name: 'Linho', category: 'quarto', price: 100, available: true },
      { id: 'old', name: 'Antigo', category: 'legacy-custom', price: 100, available: true }
    ]);
  };
});
const save = (body) => onRequestPost({ env, request: new Request('https://wedding.invalid/api/admin/data', {
  method: 'POST', headers: { Cookie: 'admin_session=' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'upsert-gift', id: 'new-gift', name: 'Presente', price: 250, ...body })
}) });

test('a draft can be saved in a new category without a payment URL', async () => {
  const response = await save({ category: 'lua-de-mel', available: false, paymentUrl: '' });
  assert.equal(response.status, 200);
  const { gift } = await response.json();
  assert.equal(gift.category, 'lua-de-mel');
  assert.equal(gift.available, false);
  assert.equal(gift.payment_url, '');
  assert.equal(gift.price, 250);
});

test('an available gift still requires a payment destination', async () => {
  const response = await save({ category: 'lavanderia', available: true, paymentUrl: '' });
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /link do Mercado Pago/);
  assert.equal(calls.length, 0);
});

test('saving an available gift keeps its payment URL and canonical category', async () => {
  const response = await save({ category: 'eletrodomesticos', available: true, paymentUrl: 'https://example.invalid/pay' });
  assert.equal(response.status, 200);
  const { gift } = await response.json();
  assert.equal(gift.category, 'eletrodomesticos');
  assert.equal(gift.payment_url, 'https://example.invalid/pay');
  assert.equal(gift.available, true);
});

test('the guest API preserves new categories and normalizes old or unknown values', async () => {
  const response = await onRequestGet({ env });
  assert.equal(response.status, 200);
  const { gifts } = await response.json();
  assert.deepEqual(gifts.map((gift) => gift.category), ['moveis', 'cama-banho', 'outros']);
  assert.ok(calls.some((call) => new URL(call.input).searchParams.get('available') === 'eq.true'));
});
