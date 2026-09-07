import {
  adminCookie,
  clearAdminCookie,
  createAdminSession,
  errorResponse,
  handleUnexpectedError,
  json,
  normalizeText,
  readJson,
  requireAdmin
} from '../../_shared.js';

const digest = async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

const secretsMatch = async (provided, expected) => {
  if (!provided || !expected) return false;
  const left = await digest(provided);
  const right = await digest(expected);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
};

export const onRequestGet = async ({ request, env }) => json({ authenticated: await requireAdmin(request, env) });

export const onRequestPost = async ({ request, env }) => {
  try {
    const body = await readJson(request);
    const code = normalizeText(body.code, 200);
    if (!env.ADMIN_ACCESS_CODE) return errorResponse('O acesso administrativo ainda nao foi configurado.', 503);
    if (!(await secretsMatch(code, env.ADMIN_ACCESS_CODE))) return errorResponse('Codigo administrativo invalido.', 401);

    const session = await createAdminSession(env);
    return json({ ok: true }, 200, { 'Set-Cookie': adminCookie(session) });
  } catch (error) {
    return handleUnexpectedError(error);
  }
};

export const onRequestDelete = async () => json({ ok: true }, 200, { 'Set-Cookie': clearAdminCookie });
