import {
  errorResponse,
  handleUnexpectedError,
  hashToken,
  isValidEmail,
  json,
  normalizeEmail,
  normalizeText,
  readJson,
  siteOrigin,
  supabaseGet,
  supabasePatch,
  supabasePost,
  sendEmail
} from '../_shared.js';

const RSVP_DEADLINE = new Date('2027-03-31T23:59:59-03:00');
const ALLOWED_DIETARY = new Set(['vegetariano', 'vegano', 'alergia', 'sem-restricoes', 'outro']);

const getGlobalReopen = async (env) => {
  const rows = await supabaseGet(env, 'settings', '?select=value&key=eq.rsvp_global_reopen&limit=1');
  return rows[0]?.value === true;
};

const getRsvpBy = async (env, query) => {
  const rows = await supabaseGet(env, 'rsvps', `?select=id,name,email,attendance,companion_count,companions,dietary_preferences,dietary_other,reopened,edit_token_hash,updated_at&${query}&limit=1`);
  return rows[0] || null;
};

const publicRsvp = (rsvp) => ({
  id: rsvp.id,
  name: rsvp.name,
  email: rsvp.email,
  attendance: rsvp.attendance,
  companionCount: rsvp.companion_count,
  companions: rsvp.companions || [],
  dietaryPreferences: rsvp.dietary_preferences || [],
  dietaryOther: rsvp.dietary_other || '',
  reopened: rsvp.reopened,
  updatedAt: rsvp.updated_at
});

const validatePayload = (body) => {
  const name = normalizeText(body.name, 120);
  const email = normalizeEmail(body.email);
  const attendance = body.attendance === 'sim' || body.attendance === 'nao' ? body.attendance : '';
  const companions = Array.isArray(body.companions)
    ? body.companions.map((companion) => normalizeText(companion, 80)).filter(Boolean).slice(0, 4)
    : [];
  const dietaryPreferences = Array.isArray(body.dietaryPreferences)
    ? [...new Set(body.dietaryPreferences.filter((item) => ALLOWED_DIETARY.has(item)))]
    : [];
  const dietaryOther = normalizeText(body.dietaryOther, 240);

  if (name.length < 2) throw new Error('Informe seu nome.');
  if (!isValidEmail(email)) throw new Error('Informe um e-mail valido.');
  if (!attendance) throw new Error('Informe se voce vai participar.');
  if (companions.length > 4) throw new Error('O limite de acompanhantes e 4.');
  if (!body.consent) throw new Error('Autorize o uso dos dados para enviar a confirmacao.');

  return {
    name,
    email,
    attendance,
    companions,
    companion_count: companions.length,
    dietary_preferences: dietaryPreferences,
    dietary_other: dietaryOther,
    consent_at: new Date().toISOString()
  };
};

export const onRequestGet = async ({ request, env }) => {
  try {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return errorResponse('Link de edicao invalido.', 400);
    const rsvp = await getRsvpBy(env, `edit_token_hash=eq.${encodeURIComponent(await hashToken(token))}`);
    if (!rsvp) return errorResponse('Este link de edicao nao foi encontrado.', 404);
    return json({ rsvp: publicRsvp(rsvp) });
  } catch (error) {
    return handleUnexpectedError(error);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await readJson(request);
    const payload = validatePayload(body);
    const editToken = normalizeText(body.editToken, 160);
    const token = editToken || crypto.randomUUID();
    const tokenHash = await hashToken(token);
    const existingByToken = editToken
      ? await getRsvpBy(env, `edit_token_hash=eq.${encodeURIComponent(await hashToken(editToken))}`)
      : null;
    const existingByEmail = existingByToken ? null : await getRsvpBy(env, `email=eq.${encodeURIComponent(payload.email)}`);
    const existing = existingByToken || existingByEmail;
    const globalReopen = await getGlobalReopen(env);

    if (new Date() > RSVP_DEADLINE && (!existing || (!existing.reopened && !globalReopen))) {
      return errorResponse('O prazo para confirmar presenca terminou.', 403);
    }

    const savedPayload = { ...payload, edit_token_hash: tokenHash };
    const savedRows = existing
      ? await supabasePatch(env, 'rsvps', `?id=eq.${encodeURIComponent(existing.id)}`, savedPayload)
      : await supabasePost(env, 'rsvps', savedPayload);
    const saved = savedRows[0];
    const editUrl = `${siteOrigin(request, env)}/?rsvp_token=${encodeURIComponent(token)}#rsvp`;

    const emailResult = await sendEmail(env, {
      to: payload.email,
      subject: 'Confirmacao recebida - Gabriela e Vitor',
      idempotencyKey: `rsvp-${saved.id}-${saved.updated_at}`,
      text: `Oi, ${payload.name}! Recebemos sua confirmacao para o casamento de Gabriela e Vitor. Se precisar corrigir sua resposta, use este link: ${editUrl}`,
      html: `<p>Oi, ${payload.name}!</p><p>Recebemos sua confirmacao para o casamento de Gabriela e Vitor.</p><p><a href="${editUrl}">Editar minha resposta</a></p><p>Com carinho,<br>G &amp; V</p>`
    });

    return json({ ok: true, rsvp: publicRsvp(saved), editUrl, emailSent: emailResult.sent });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Informe')) return errorResponse(error.message, 422);
    if (error instanceof Error && error.message.startsWith('Autorize')) return errorResponse(error.message, 422);
    return handleUnexpectedError(error);
  }
};
