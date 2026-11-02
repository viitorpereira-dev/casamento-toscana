import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as catalog } from '../functions/api/gifts.js';
import { onRequestGet as dashboard, onRequestPost as admin } from '../functions/api/admin/data.js';
import { onRequestPost as claim } from '../functions/api/gift-claims.js';
import { createAdminSession } from '../functions/_shared.js';

const env = { SUPABASE_URL:'https://test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY:'test-key', ADMIN_SESSION_SECRET:'test-secret' };
const wedding = {id:'10000000-0000-0000-0000-000000000001',slug:'casamento',name:'Casamento',status:'published',position:0};
const tea = {id:'20000000-0000-0000-0000-000000000002',slug:'cha-de-cozinha',name:'Chá de cozinha',status:'draft',position:1};
let lists, gifts, claims, calls, token, rpcError;
beforeEach(async () => {
  lists = [{...wedding},{...tea}];
  gifts = [{id:'gift-a',list_id:wedding.id,name:'Presente',price:123.45,available:true,payment_url:'https://example.invalid/pay',category:'cozinha',featured:1}];
  claims = []; calls = []; rpcError = null; token = await createAdminSession(env);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input), table = url.pathname.split('/').at(-1), method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({url,table,method,body});
    const matches = (row) => [...url.searchParams].every(([key,value]) => !value.startsWith('eq.') || String(row[key]) === value.slice(3));
    if (table === 'move_gifts_to_list' || table === 'reorder_gift_lists' || table === 'create_gift_list_claim') {
      if (rpcError) return Response.json({message:rpcError,code:'P0001'}, {status:400});
      if (table === 'move_gifts_to_list') return Response.json(body.p_gift_ids.length);
      if (table === 'reorder_gift_lists') return Response.json(null);
      const list = lists.find((list) => list.id === body.p_list_id);
      return Response.json({claim:{id:'claim-a',gift_id:'gift-a',status:'reserved',expires_at:'2099-01-01'},gift:gifts[0],list});
    }
    const source = table === 'gift_lists' ? lists : table === 'gifts' ? gifts : table === 'gift_claims' ? claims : [];
    if (method === 'GET') return Response.json(source.filter(matches));
    if (method === 'POST') return Response.json([{id:'new-list-id',...body}]);
    if (method === 'PATCH') return Response.json(source.filter(matches).map((row) => ({...row,...body})));
    return new Response(null,{status:204});
  };
});
const post = (handler, body, authenticated = false) => handler({env, request:new Request('https://wedding.invalid/api', {method:'POST',headers:{'Content-Type':'application/json',...(authenticated ? {Cookie:'admin_session='+token} : {})},body:JSON.stringify(body)})});
const getCatalog = (list = '') => catalog({env,request:new Request('https://wedding.invalid/api/gifts'+(list ? '?list='+list : ''))});

test('public catalog defaults to wedding and scopes gifts and claims to it', async () => {
  const data = await (await getCatalog()).json();
  assert.deepEqual(data.lists.map((list) => list.slug),['casamento']);
  assert.equal(data.selectedList.id,wedding.id);
  assert.equal(data.gifts[0].listId,wedding.id);
  for (const call of calls.filter((call) => ['gifts','gift_claims'].includes(call.table))) assert.equal(call.url.searchParams.get('list_id'),'eq.'+wedding.id);
  assert.equal(calls.find((call) => call.table === 'gifts').url.searchParams.get('available'),'eq.true');
});
test('hidden and unknown direct links do not fall back or expose products', async () => {
  for (const slug of ['cha-de-cozinha','missing']) {
    const response = await getCatalog(slug), data = await response.json();
    assert.equal(response.status,404); assert.equal(data.selectedList,null); assert.deepEqual(data.gifts,[]);
  }
  assert.equal(calls.some((call) => call.table === 'gifts'),false);
});
test('an empty published list is selectable without borrowing wedding gifts', async () => {
  lists[1].status = 'published';
  const data = await (await getCatalog(tea.slug)).json();
  assert.equal(data.selectedList.id,tea.id); assert.equal(data.lists.length,2); assert.deepEqual(data.gifts,[]);
});
test('reported payments stay held after expiry while overdue reservations release', async () => {
  claims = [{gift_id:'gift-a',list_id:wedding.id,status:'payment_reported',expires_at:'2000-01-01'}];
  assert.equal((await (await getCatalog()).json()).gifts[0].status,'payment_reported');
  claims[0].status = 'reserved';
  assert.equal((await (await getCatalog()).json()).gifts[0].status,'available');
});
test('all new list actions require admin auth before database access', async () => {
  for (const action of ['upsert-gift-list','delete-gift-list','reorder-gift-lists','move-gifts']) assert.equal((await post(admin,{action})).status,401);
  assert.equal(calls.length,0);
});
test('new lists use draft visibility and renaming never modifies their slug', async () => {
  assert.equal((await post(admin,{action:'upsert-gift-list',name:'Chá de cozinha'},true)).status,201);
  const created = calls.at(-1).body;
  assert.equal(created.status,'draft'); assert.match(created.slug,/^cha-de-cozinha-[a-f0-9]{8}$/);
  await post(admin,{action:'upsert-gift-list',listId:wedding.id,name:'Nossa festa',status:'published'},true);
  assert.equal(calls.at(-1).body.name,'Nossa festa'); assert.equal('slug' in calls.at(-1).body,false);
});
test('bulk moves invoke one atomic RPC with the original source', async () => {
  const body = {action:'move-gifts',sourceListId:wedding.id,targetListId:tea.id,giftIds:['gift-a','gift-b']};
  const response = await post(admin,body,true);
  assert.equal(response.status,200); assert.equal((await response.json()).moved,2);
  assert.deepEqual(calls.at(-1).body,{p_gift_ids:body.giftIds,p_source_list_id:wedding.id,p_target_list_id:tea.id});
  assert.equal(calls.length,1);
});
test('invalid bulk selections do not mutate the database and active claims give a clear conflict', async () => {
  const body = {action:'move-gifts',sourceListId:wedding.id,targetListId:tea.id,giftIds:['gift-a','gift-a']};
  assert.equal((await post(admin,body,true)).status,422); assert.equal(calls.length,0);
  rpcError = 'GIFT_MOVE_BLOCKED'; body.giftIds = ['gift-a'];
  const response = await post(admin,body,true);
  assert.equal(response.status,409); assert.match((await response.json()).error,/reserva ativa/);
});
test('dashboard associates historical claims with their origin list and blocks reported gifts', async () => {
  gifts[0].list_id = tea.id;
  claims = [{id:'claim-a',gift_id:'gift-a',list_id:wedding.id,status:'payment_reported',expires_at:'2000-01-01'}];
  const data = await (await dashboard({env,request:new Request('https://wedding.invalid/api/admin/data',{headers:{Cookie:'admin_session='+token}})})).json();
  assert.equal(data.claims[0].list_name,'Casamento'); assert.equal(data.gifts[0].move_blocked,true);
  assert.equal(data.lists[0].history_count,1); assert.equal(data.lists[1].gift_count,1);
});
test('claim creation passes list identity to database and returns origin context', async () => {
  const response = await post(claim,{giftId:'gift-a',listId:wedding.id,name:'Teste',email:'test@example.invalid'});
  const data = await response.json(); assert.equal(response.status,201);
  assert.equal(data.claim.listId,wedding.id); assert.equal(data.claim.listSlug,wedding.slug); assert.equal(data.payment.amount,123.45);
  assert.equal(calls.at(-1).body.p_list_id,wedding.id);
  assert.notEqual(calls.at(-1).body.p_claim_token_hash,data.claim.claimToken);
});
test('stale or hidden list claim creation returns database conflict safely', async () => {
  rpcError = 'GIFT_LIST_MISMATCH';
  assert.equal((await post(claim,{giftId:'gift-a',listId:tea.id,name:'Teste',email:'test@example.invalid'})).status,409);
  rpcError = 'LIST_UNAVAILABLE';
  assert.equal((await post(claim,{giftId:'gift-a',listId:tea.id,name:'Teste',email:'test@example.invalid'})).status,404);
});
test('reporting an already reported payment after expiry is idempotent', async () => {
  claims = [{id:'claim-a',list_id:wedding.id,claim_token_hash:'ignored',status:'payment_reported',expires_at:'2000-01-01'}];
  // Match the hash lookup without retaining a plain claim token in the mock.
  const {hashToken} = await import('../functions/_shared.js'); claims[0].claim_token_hash = await hashToken('test-token');
  const response = await post(claim,{action:'paid',claimToken:'test-token'});
  assert.equal(response.status,200); assert.equal((await response.json()).status,'payment_reported');
  assert.equal(calls.some((call) => call.method === 'PATCH'),false);
});
