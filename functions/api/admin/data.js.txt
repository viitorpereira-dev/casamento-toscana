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
  return {
    id,
    name,
    category: normalizeText(body.category, 40) || 'outros',
    description: normalizeText(body.description, 500),
    price: Math.max(0, Number(body.price) || 0),
    image_url: normalizeText(body.imageUrl, 1000),
    badge: normalizeText(body.badge, 60),
    featured: Math.max(0, Math.floor(Number(body.featured) || 99)),
    payment_url: normalizeText(body.paymentUrl, 1000),
    pix_key: normalizeText(body.pixKey, 200),
    pix_payload: normalizeText(body.pixPayload, 1000),
    available: body.available !== false
  };
};

const getDashboardData = async (env) => {
  const [rsvps, claims, gifts, settings] = await Promise.all([
    supabaseGet(env, 'rsvps', '?select=id,name,email,attendance,companion_count,companions,dietary_preferences,dietary_other,reopened,consent_at,created_at,updated_at&order=updated_at.desc'),
    supabaseGet(env, 'gift_claims', '?select=id,gift_id,guest_name,guest_email,payment_method,status,payment_note,reserved_at,expires_at,payment_reported_at,confirmed_at,created_at,updated_at&order=created_at.desc'),
    supabaseGet(env, 'gifts', '?select=id,name,category,description,price,image_url,badge,featured,payment_url,pix_key,pix_payload,available&order=featured.asc'),
    supabaseGet(env, 'settings', '?select=key,value')
  ]);
  const giftsById = new Map(gifts.map((gift) => [gift.id, gift]));
  const globalReopenSetting = settings.find((setting) => setting.key === 'rsvp_global_reopen');

  return {
    rsvps,
    claims: claims.map((claim) => ({ ...claim, gift_name: giftsById.get(claim.gift_id)?.name || claim.gift_id })),
    gifts,
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
  const rows = await supabasePost(env, 'gifts', payload, '?on_conflict=id', 'resolution=merge-duplicates,return=representation');
  return json({ ok: true, gift: rows[0] });
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
    return handleUnexpectedError(error);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    await requireSession(request, env);
    const body = await readJson(request);
    switch (body.action) {
      case 'update-rsvp': return updateRsvp(env, body);
      case 'update-claim': return updateClaim(env, body);
      case 'delete-rsvp': return deleteRsvp(env, body);
      case 'delete-all-rsvps':
        await supabaseDelete(env, 'rsvps', '?id=not.is.null');
        return json({ ok: true });
      case 'upsert-gift': return upsertGift(env, body);
      case 'delete-gift': return deleteGift(env, body);
      case 'set-global-reopen': return updateSettings(env, body);
      default: return errorResponse('Acao administrativa desconhecida.', 400);
    }
  } catch (error) {
    if (error instanceof Response) return errorResponse('Acesso administrativo necessario.', 401);
    if (error instanceof Error && error.message.startsWith('Informe')) return errorResponse(error.message, 422);
    if (error instanceof Error && error.message.startsWith('O identificador')) return errorResponse(error.message, 422);
    return handleUnexpectedError(error);
  }
};
