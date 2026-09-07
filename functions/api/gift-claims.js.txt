import {
  errorResponse,
  handleUnexpectedError,
  hashToken,
  isValidEmail,
  json,
  normalizeEmail,
  normalizeText,
  readJson,
  supabaseGet,
  supabasePatch,
  supabasePost,
  SupabaseError
} from '../_shared.js';

const ACTIVE_STATUSES = new Set(['reserved', 'payment_reported', 'confirmed']);

const getGift = async (env, giftId) => {
  const rows = await supabaseGet(env, 'gifts', `?select=id,name,price,payment_url,available&id=eq.${encodeURIComponent(giftId)}&limit=1`);
  return rows[0] || null;
};

const getClaimByToken = async (env, token) => {
  const rows = await supabaseGet(env, 'gift_claims', `?select=id,gift_id,guest_name,guest_email,payment_method,status,expires_at,claim_token_hash&claim_token_hash=eq.${encodeURIComponent(await hashToken(token))}&limit=1`);
  return rows[0] || null;
};

const expireClaimIfNeeded = async (env, claim) => {
  if (claim && ['reserved', 'payment_reported'].includes(claim.status) && new Date(claim.expires_at).getTime() <= Date.now()) {
    await supabasePatch(env, 'gift_claims', `?id=eq.${encodeURIComponent(claim.id)}`, {
      status: 'expired',
      updated_at: new Date().toISOString()
    });
    return null;
  }
  return claim;
};

const getActiveClaim = async (env, giftId) => {
  const rows = await supabaseGet(env, 'gift_claims', `?select=id,status,expires_at&gift_id=eq.${encodeURIComponent(giftId)}&status=in.(reserved,payment_reported,confirmed)&order=created_at.desc&limit=1`);
  return expireClaimIfNeeded(env, rows[0] || null);
};

const claimResponse = (claim, gift, claimToken) => ({
  claim: {
    id: claim.id,
    giftId: claim.gift_id,
    giftName: gift.name,
    status: claim.status,
    expiresAt: claim.expires_at,
    claimToken
  },
  payment: {
    paymentUrl: gift.payment_url || '',
    amount: Number(gift.price)
  }
});

const createClaim = async (env, body) => {
  const giftId = normalizeText(body.giftId, 80);
  const guestName = normalizeText(body.name, 120);
  const guestEmail = normalizeEmail(body.email);
  const paymentMethod = 'mercado-pago';

  if (!giftId || guestName.length < 2 || !isValidEmail(guestEmail)) {
    return errorResponse('Informe nome e e-mail.', 422);
  }

  const gift = await getGift(env, giftId);
  if (!gift || !gift.available) return errorResponse('Este presente nao esta disponivel.', 404);
  if (!gift.payment_url) return errorResponse('O link do Mercado Pago ainda nao foi configurado para este presente.', 503);

  const activeClaim = await getActiveClaim(env, giftId);
  if (activeClaim || (activeClaim && ACTIVE_STATUSES.has(activeClaim.status))) {
    return errorResponse('Este presente ja esta reservado.', 409);
  }

  const claimToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = await supabasePost(env, 'gift_claims', {
      gift_id: giftId,
      guest_name: guestName,
      guest_email: guestEmail,
      payment_method: paymentMethod,
      status: 'reserved',
      claim_token_hash: await hashToken(claimToken),
      expires_at: expiresAt
    });
    return json({ ok: true, ...claimResponse(rows[0], gift, claimToken) }, 201);
  } catch (error) {
    if (error instanceof SupabaseError && error.status === 409) return errorResponse('Este presente acabou de ser reservado por outra pessoa.', 409);
    throw error;
  }
};

const reportPayment = async (env, body) => {
  const claimToken = normalizeText(body.claimToken, 160);
  const paymentNote = normalizeText(body.paymentNote, 240);
  if (!claimToken) return errorResponse('Reserva de presente invalida.', 422);

  const claim = await getClaimByToken(env, claimToken);
  if (!claim) return errorResponse('Reserva de presente nao encontrada.', 404);
  if (claim.status === 'confirmed') return json({ ok: true, status: claim.status });
  if (claim.status !== 'reserved' && claim.status !== 'payment_reported') return errorResponse('Esta reserva nao esta mais ativa.', 409);
  if (new Date(claim.expires_at).getTime() <= Date.now()) {
    await supabasePatch(env, 'gift_claims', `?id=eq.${encodeURIComponent(claim.id)}`, { status: 'expired' });
    return errorResponse('O prazo desta reserva terminou.', 409);
  }

  await supabasePatch(env, 'gift_claims', `?id=eq.${encodeURIComponent(claim.id)}`, {
    status: 'payment_reported',
    payment_note: paymentNote,
    payment_reported_at: new Date().toISOString()
  });
  return json({ ok: true, status: 'payment_reported' });
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await readJson(request);
    if (body.action === 'paid') return reportPayment(env, body);
    return createClaim(env, body);
  } catch (error) {
    return handleUnexpectedError(error);
  }
};
