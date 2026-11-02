import { assertListId, giftListErrorResponse } from '../_gift-lists.js';
import { errorResponse, handleUnexpectedError, hashToken, isValidEmail, json, normalizeEmail, normalizeText, readJson, supabaseGet, supabasePatch, supabasePost } from '../_shared.js';

const getGift = async (env, giftId) => (await supabaseGet(env, 'gifts', '?select=id,name,price,payment_url,available,list_id&id=eq.' + encodeURIComponent(giftId) + '&limit=1'))[0] || null;
const getClaimByToken = async (env, token) => (await supabaseGet(env, 'gift_claims', '?select=id,gift_id,list_id,status,expires_at&claim_token_hash=eq.' + encodeURIComponent(await hashToken(token)) + '&limit=1'))[0] || null;

const createClaim = async (env, body) => {
  const giftId = normalizeText(body.giftId, 80);
  const guestName = normalizeText(body.name, 120);
  const guestEmail = normalizeEmail(body.email);
  if (!giftId || guestName.length < 2 || !isValidEmail(guestEmail)) return errorResponse('Informe nome e e-mail.', 422);
  const gift = await getGift(env, giftId);
  if (!gift || !gift.available) return errorResponse('Este presente não está disponível.', 404);
  const listId = assertListId(body.listId || gift.list_id);
  const claimToken = crypto.randomUUID();
  const result = await supabasePost(env, 'rpc/create_gift_list_claim', {
    p_gift_id: giftId, p_list_id: listId, p_guest_name: guestName, p_guest_email: guestEmail, p_claim_token_hash: await hashToken(claimToken)
  });
  return json({ ok: true,
    claim: { id: result.claim.id, giftId: result.claim.gift_id, giftName: result.gift.name, listId: result.list.id, listName: result.list.name, listSlug: result.list.slug, status: result.claim.status, expiresAt: result.claim.expires_at, claimToken },
    payment: { paymentUrl: result.gift.payment_url || '', amount: Number(result.gift.price) }
  }, 201);
};

const reportPayment = async (env, body) => {
  const claimToken = normalizeText(body.claimToken, 160);
  const paymentNote = normalizeText(body.paymentNote, 240);
  if (!claimToken) return errorResponse('Reserva de presente inválida.', 422);
  const claim = await getClaimByToken(env, claimToken);
  if (!claim) return errorResponse('Reserva de presente não encontrada.', 404);
  if (['confirmed', 'payment_reported'].includes(claim.status)) return json({ ok: true, status: claim.status });
  if (claim.status !== 'reserved') return errorResponse('Esta reserva não está mais ativa.', 409);
  if (new Date(claim.expires_at).getTime() <= Date.now()) {
    await supabasePatch(env, 'gift_claims', '?id=eq.' + encodeURIComponent(claim.id) + '&status=eq.reserved', { status: 'expired' });
    return errorResponse('O prazo desta reserva terminou.', 409);
  }
  const rows = await supabasePatch(env, 'gift_claims', '?id=eq.' + encodeURIComponent(claim.id) + '&status=eq.reserved&expires_at=gt.' + encodeURIComponent(new Date().toISOString()), {
    status: 'payment_reported', payment_note: paymentNote, payment_reported_at: new Date().toISOString()
  });
  if (!rows.length) return errorResponse('A reserva mudou. Atualize a página antes de continuar.', 409);
  return json({ ok: true, status: 'payment_reported' });
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await readJson(request);
    return body.action === 'paid' ? await reportPayment(env, body) : await createClaim(env, body);
  } catch (error) { return giftListErrorResponse(error) || handleUnexpectedError(error); }
};
