import test from 'node:test';
import assert from 'node:assert/strict';
import { createGiftListSelector } from '../gift-lists-public.js';
import { giftListLink } from '../gift-lists.js';

const wedding = {id:'wedding',slug:'casamento',name:'Casamento',description:'Nossa festa'};
const tea = {id:'tea',slug:'cha-de-cozinha',name:'Chá de cozinha',description:'Nossa cozinha'};
const setup = (fetchCatalog, search = '', beforeChange) => {
  const select = {value:'',events:{},ownerDocument:{createElement:() => ({})},replaceChildren(...children){this.children=children;},addEventListener(name,fn){this.events[name]=fn;}};
  const description={},notice={dataset:{}},changes=[],urls=[];
  const selector = createGiftListSelector({select,description,notice,fetchCatalog,beforeChange,onCatalog:(value) => changes.push(value),location:{href:'https://wedding.invalid/'+search+'#presentes'},history:{replaceState:(_a,_b,url) => urls.push(url)}});
  return {select,description,notice,changes,urls,selector};
};
test('direct links choose their list and switching replaces the entire catalog', async () => {
  const paths=[];
  const state=setup(async(path) => {paths.push(path); const list=path.includes('cha-de-cozinha')?tea:wedding;return Response.json({lists:[wedding,tea],selectedList:list,gifts:[{id:list.id}]});},'?lista=cha-de-cozinha');
  await state.selector.load(); assert.equal(state.select.value,tea.slug); assert.equal(state.description.textContent,tea.description);
  state.select.value=wedding.slug; await state.select.events.change();
  assert.deepEqual(paths,['/api/gifts?list=cha-de-cozinha','/api/gifts?list=casamento']);
  assert.deepEqual(state.changes.at(-1).gifts,[{id:wedding.id}]); assert.equal(state.urls.at(-1),'/?lista=casamento#presentes');
});
test('declining a list change keeps the current selection and cart context', async () => {
  let requests=0; const state=setup(async()=>{requests++;return Response.json({lists:[wedding,tea],selectedList:wedding,gifts:[]});},'',()=>false);
  await state.selector.load(); state.select.value=tea.slug; await state.select.events.change();
  assert.equal(requests,1); assert.equal(state.select.value,wedding.slug); assert.equal(state.selector.currentList.id,wedding.id);
});
test('an unavailable direct link shows published alternatives without a fallback catalog', async () => {
  const state=setup(async()=>Response.json({lists:[wedding],selectedList:null,gifts:[],error:'Esta lista não está disponível.'},{status:404}),'?lista=oculta');
  await state.selector.load(); assert.equal(state.selector.currentList,null); assert.equal(state.select.disabled,false); assert.equal(state.select.value,'');
  assert.equal(state.notice.dataset.tone,'error'); assert.deepEqual(state.changes[0].gifts,[]); assert.equal(state.urls.length,0);
});
test('a late response from another list cannot overwrite the selected list', async () => {
  let completeFirst; const state=setup((path)=>path.includes('casamento')?new Promise((resolve)=>{completeFirst=resolve;}):Promise.resolve(Response.json({lists:[wedding,tea],selectedList:tea,gifts:[]})));
  const first=state.selector.load(wedding.slug); await state.selector.load(tea.slug);
  completeFirst(Response.json({lists:[wedding,tea],selectedList:wedding,gifts:[{id:'old'}]})); await first;
  assert.equal(state.selector.currentList.id,tea.id); assert.equal(state.changes.length,1);
});
test('network errors clear stale catalog and permit a retry', async () => {
  let fail=true; const state=setup(async()=>{if(fail)throw Error('offline'); return Response.json({lists:[wedding],selectedList:wedding,gifts:[]});});
  await state.selector.load(); assert.equal(state.notice.dataset.tone,'error'); assert.deepEqual(state.changes[0].gifts,[]);
  fail=false; await state.selector.load(); assert.equal(state.selector.currentList.id,wedding.id);
});
test('share links point to the public page and stay stable when a list is renamed', () => {
  assert.equal(giftListLink({...tea,name:'Novo nome'},'https://wedding.invalid/admin.html'), 'https://wedding.invalid/?lista=cha-de-cozinha#presentes');
});
