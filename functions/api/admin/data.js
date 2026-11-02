import { albumForPhoto } from '../../_albums.js';
import { normalizeGiftCategory } from '../../../gift-categories.js';
import { claimHoldsGift, resolvePublicGiftList } from '../../../gift-lists.js';
import { assertListId, GiftListError, giftListErrorResponse, loadGiftLists } from '../../_gift-lists.js';
import {
  errorResponse,
  handleUnexpectedError,
  json,
  normalizeEmail,
  normalizeText,
  readJson,
  requireAdmin,
  supabaseDelete,
  supabaseGet,
  supabaseGetAll,
  supabasePatch,
  supabasePost
} from '../../_shared.js';

const ALLOWED_CLAIM_STATUSES = new Set(['reserved', 'payment_reported', 'confirmed', 'expired', 'cancelled']);
const GIFT_ID_PATTERN = /^[a-z0-9-]{2,80}$/;

const requireSession = async (request, env) => {
  if (!(await requireAdmin(request, env))) throw new Response('Unauthorized', { status: 401 });
};

const giftPayload = (body) => {
  const id = normalizeText(body.id, 80).toLowerCase();
  const name = normalizeText(body.name, 140);
  if (!GIFT_ID_PATTERN.test(id)) throw new Error('O identificador do presente deve usar letras minusculas, numeros e hifens.');
  if (!name) throw new Error('Informe o nome do presente.');
  const paymentUrl = normalizeText(body.paymentUrl, 1000);
  if (body.available !== false && !paymentUrl) throw new Error('Informe o link do Mercado Pago para disponibilizar este presente.');
  return {
    id,
    name,
    category: normalizeGiftCategory(normalizeText(body.category, 40)),
    description: normalizeText(body.description, 500),
    price: Math.max(0, Number(body.price) || 0),
    image_url: normalizeText(body.imageUrl, 1000),
    badge: normalizeText(body.badge, 60),
    featured: Math.max(0, Math.floor(Number(body.featured) || 99)),
    payment_url: paymentUrl,
    available: body.available !== false
  };
};

const getDashboardData = async (env) => {
  const [rsvps, claims, gifts, settings, gallery, lists] = await Promise.all([
    supabaseGet(env, 'rsvps', '?select=id,name,email,attendance,companion_count,companions,dietary_preferences,dietary_other,reopened,consent_at,created_at,updated_at&order=updated_at.desc'),
    supabaseGetAll(env, 'gift_claims', '?select=id,gift_id,list_id,guest_name,guest_email,payment_method,status,payment_note,reserved_at,expires_at,payment_reported_at,confirmed_at,created_at,updated_at&order=created_at.desc'),
    supabaseGetAll(env, 'gifts', '?select=id,name,list_id,category,description,price,image_url,badge,featured,payment_url,available&order=featured.asc'),
    supabaseGet(env, 'settings', '?select=key,value'),
    supabaseGetAll(env, 'gallery_photos', '?select=id,storage_path,title,subtitle,position,framing_zoom,framing_x,framing_y,created_at&order=position.asc,created_at.asc,id.asc'),
    loadGiftLists(env)
  ]);
  const giftsById = new Map(gifts.map((gift) => [gift.id, gift]));
  const listsById = new Map(lists.map((list) => [list.id, list]));
  const blockedGiftIds = new Set(claims.filter((claim) => claimHoldsGift(claim)).map((claim) => claim.gift_id));
  const globalReopenSetting = settings.find((setting) => setting.key === 'rsvp_global_reopen');

  return {
    rsvps,
    claims: claims.map((claim) => ({ ...claim, gift_name: giftsById.get(claim.gift_id)?.name || claim.gift_id, list_name: listsById.get(claim.list_id)?.name || '' })),
    gifts: gifts.map((gift) => ({ ...gift, move_blocked: blockedGiftIds.has(gift.id) })),
    lists: lists.map((list) => ({ ...list, gift_count: gifts.filter((gift) => gift.list_id === list.id).length, available_count: gifts.filter((gift) => gift.list_id === list.id && gift.available).length, history_count: claims.filter((claim) => claim.list_id === list.id).length })),
    gallery: gallery.map((photo) => ({
      ...photo,
      album: albumForPhoto(photo),
      public_url: `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/gallery/${photo.storage_path.split('/').map(encodeURIComponent).join('/')}`
    })),
    settings: {
      rsvpGlobalReopen: globalReopenSetting?.value === true
    }
  };
};

const updateRsvp = async (env, body) => {
  const id = normalizeText(body.id, 80);
  if (!id) return errorResponse('RSVP invalido.', 422);
  await supabasePatch(env, 'rsvps', `?id=eq.${encodeURIComponent(id)}`, { reopened: body.reopened === true });
  return json({ ok: true });
};

const updateClaim = async (env, body) => {
  const id = normalizeText(body.id, 80);
  const status = normalizeText(body.status, 40);
  if (!id || !ALLOWED_CLAIM_STATUSES.has(status)) return errorResponse('Status de presente invalido.', 422);
  const update = { status };
  if (status === 'confirmed') update.confirmed_at = new Date().toISOString();
  if (status !== 'confirmed') update.confirmed_at = null;
  await supabasePatch(env, 'gift_claims', `?id=eq.${encodeURIComponent(id)}`, update);
  return json({ ok: true });
};

const deleteRsvp = async (env, body) => {
  const id = normalizeText(body.id, 80);
  if (!id) return errorResponse('RSVP invalido.', 422);
  await supabaseDelete(env, 'rsvps', `?id=eq.${encodeURIComponent(id)}`);
  return json({ ok: true });
};

const upsertGift = async (env, body) => {
  const payload = giftPayload(body);
  const existing = (await supabaseGet(env, 'gifts', '?select=id,list_id&id=eq.' + encodeURIComponent(payload.id) + '&limit=1'))[0];
  if (existing && body.isNew === true) throw new GiftListError('Já existe um presente com este identificador. Edite o cadastro existente.', 409);
  const lists = await loadGiftLists(env);
  const listId = body.listId ? assertListId(body.listId) : existing?.list_id;
  const list = listId ? lists.find((item) => item.id === listId) : resolvePublicGiftList(lists.filter((item) => item.status !== 'archived'));
  if (!list || (list.status === 'archived' && existing?.list_id !== list.id)) throw new GiftListError('Selecione uma lista ativa para este presente.', 404);
  payload.list_id = list.id;
  const rows = await supabasePost(env, 'gifts', payload, '?on_conflict=id', 'resolution=merge-duplicates,return=representation');
  return json({ ok: true, gift: rows[0] });
};

const upsertGiftList = async (env, body) => {
  const name = normalizeText(body.name, 100);
  const status = normalizeText(body.status, 20) || 'draft';
  if (!name) throw new GiftListError('Informe o nome da lista.');
  if (!['draft', 'published', 'archived'].includes(status)) throw new GiftListError('Escolha uma situação válida para a lista.');
  const order = Number(body.position);
  const payload = { name, description: normalizeText(body.description, 500), status, position: Number.isFinite(order) ? Math.max(0, Math.floor(order)) : 99 };
  if (body.listId) {
    const rows = await supabasePatch(env, 'gift_lists', '?id=eq.' + assertListId(body.listId), payload);
    if (!rows.length) throw new GiftListError('Lista não encontrada.', 404);
    return json({ ok: true, list: rows[0] });
  }
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'lista';
  const rows = await supabasePost(env, 'gift_lists', { ...payload, slug: slug + '-' + crypto.randomUUID().slice(0, 8) });
  return json({ ok: true, list: rows[0] }, 201);
};

const moveGifts = async (env, body) => {
  const source = assertListId(body.sourceListId);
  const target = assertListId(body.targetListId);
  const ids = body.giftIds;
  if (source === target) throw new GiftListError('Escolha outra lista de destino.');
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || ids.some((id) => typeof id !== 'string' || !GIFT_ID_PATTERN.test(id)) || new Set(ids).size !== ids.length) throw new GiftListError('Selecione entre 1 e 500 presentes, sem repetir itens.');
  const moved = await supabasePost(env, 'rpc/move_gifts_to_list', { p_gift_ids: ids, p_source_list_id: source, p_target_list_id: target });
  return json({ ok: true, moved: Number(moved) });
};

const reorderGiftLists = async (env, body) => {
  if (!Array.isArray(body.listIds) || !body.listIds.length || body.listIds.length > 500) throw new GiftListError('Informe a ordem das listas.');
  await supabasePost(env, 'rpc/reorder_gift_lists', { p_list_ids: body.listIds.map(assertListId) });
  return json({ ok: true });
};

const deleteGiftList = async (env, body) => {
  await supabaseDelete(env, 'gift_lists', '?id=eq.' + assertListId(body.listId));
  return json({ ok: true });
};

const deleteGift = async (env, body) => {
  const id = normalizeText(body.id, 80);
  if (!id) return errorResponse('Presente invalido.', 422);
  await supabaseDelete(env, 'gifts', `?id=eq.${encodeURIComponent(id)}`);
  return json({ ok: true });
};

const updateSettings = async (env, body) => {
  const rows = await supabasePost(env, 'settings', {
    key: 'rsvp_global_reopen',
    value: body.value === true
  }, '?on_conflict=key', 'resolution=merge-duplicates,return=representation');
  return json({ ok: true, setting: rows[0] });
};

export const onRequestGet = async ({ request, env }) => {
  try {
    await requireSession(request, env);
    return json(await getDashboardData(env));
  } catch (error) {
    if (error instanceof Response) return errorResponse('Acesso administrativo necessario.', 401);
    const listError = giftListErrorResponse(error);
    if (listError) return listError;
    return handleUnexpectedError(error);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    await requireSession(request, env);
    const body = await readJson(request);
    switch (body.action) {
      case 'update-rsvp': return await updateRsvp(env, body);
      case 'update-claim': return await updateClaim(env, body);
      case 'delete-rsvp': return await deleteRsvp(env, body);
      case 'delete-all-rsvps':
        await supabaseDelete(env, 'rsvps', '?id=not.is.null');
        return json({ ok: true });
      case 'upsert-gift': return await upsertGift(env, body);
      case 'upsert-gift-list': return await upsertGiftList(env, body);
      case 'move-gifts': return await moveGifts(env, body);
      case 'reorder-gift-lists': return await reorderGiftLists(env, body);
      case 'delete-gift-list': return await deleteGiftList(env, body);
      case 'delete-gift': return await deleteGift(env, body);
      case 'set-global-reopen': return await updateSettings(env, body);
      default: return errorResponse('Acao administrativa desconhecida.', 400);
    }
  } catch (error) {
    if (error instanceof Response) return errorResponse('Acesso administrativo necessario.', 401);
    const listError = giftListErrorResponse(error);
    if (listError) return listError;
    if (error instanceof Error && error.message.startsWith('Informe')) return errorResponse(error.message, 422);
    if (error instanceof Error && error.message.startsWith('O identificador')) return errorResponse(error.message, 422);
    return handleUnexpectedError(error);
  }
};


