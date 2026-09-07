const SESSION_MAX_AGE = 8 * 60 * 60;

export class SupabaseError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.details = details;
  }
}

export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  }
});

export const errorResponse = (message, status = 400, details) => json({ error: message, ...(details ? { details } : {}) }, status);

export const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    throw new Error('Invalid JSON body');
  }
};

export const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
export const normalizeText = (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength);
export const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const supabaseRequest = async (env, path, options = {}) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase is not configured');
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new SupabaseError('Supabase request failed', response.status, body);
  }
  return body;
};

export const supabaseGet = (env, table, query = '') => supabaseRequest(env, `${table}${query}`, {
  method: 'GET',
  headers: { Accept: 'application/json' }
});

export const supabasePost = (env, table, payload, query = '', preferences = 'return=representation') => supabaseRequest(env, `${table}${query}`, {
  method: 'POST',
  headers: { Prefer: preferences },
  body: JSON.stringify(payload)
});

export const supabasePatch = (env, table, query, payload, preferences = 'return=representation') => supabaseRequest(env, `${table}${query}`, {
  method: 'PATCH',
  headers: { Prefer: preferences },
  body: JSON.stringify(payload)
});

export const supabaseDelete = (env, table, query, preferences = 'return=minimal') => supabaseRequest(env, `${table}${query}`, {
  method: 'DELETE',
  headers: { Prefer: preferences }
});

const toBase64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const hmac = async (secret, value) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
};

const digest = async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

const safeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
};

export const hashToken = async (value) => toBase64Url(await digest(value));

export const createAdminSession = async (env) => {
  if (!env.ADMIN_SESSION_SECRET) throw new Error('Admin session secret is not configured');
  const payload = `${Date.now() + SESSION_MAX_AGE * 1000}.${crypto.randomUUID()}`;
  const encodedPayload = toBase64Url(new TextEncoder().encode(payload));
  const signature = toBase64Url(await hmac(env.ADMIN_SESSION_SECRET, encodedPayload));
  return `${encodedPayload}.${signature}`;
};

export const verifyAdminSession = async (env, token) => {
  if (!env.ADMIN_SESSION_SECRET || !token) return false;
  try {
    const [encodedPayload, encodedSignature] = token.split('.');
    if (!encodedPayload || !encodedSignature) return false;
    const expectedSignature = await hmac(env.ADMIN_SESSION_SECRET, encodedPayload);
    if (!safeEqual(expectedSignature, fromBase64Url(encodedSignature))) return false;
    const payload = new TextDecoder().decode(fromBase64Url(encodedPayload));
    const [expiresAt] = payload.split('.');
    return Number(expiresAt) > Date.now();
  } catch {
    return false;
  }
};

const parseCookies = (request) => Object.fromEntries((request.headers.get('Cookie') || '').split(';').map((part) => {
  const [name, ...valueParts] = part.trim().split('=');
  return [name, valueParts.join('=')];
}).filter(([name]) => name));

export const requireAdmin = async (request, env) => verifyAdminSession(env, parseCookies(request).admin_session);

export const adminCookie = (session) => `admin_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
export const clearAdminCookie = 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

export const siteOrigin = (request, env) => (env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, '');

export const sendEmail = async (env, { to, subject, html, text, idempotencyKey }) => {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { sent: false, reason: 'not-configured' };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'User-Agent': 'casamento-toscana/1.0',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html, text })
    });

    if (!response.ok) {
      console.error('Email provider rejected message', response.status, await response.text());
      return { sent: false, reason: 'provider-rejected' };
    }
    return { sent: true };
  } catch (sendError) {
    console.error('Email provider request failed', sendError);
    return { sent: false, reason: 'provider-unavailable' };
  }
};

export const handleUnexpectedError = (error) => {
  console.error(error);
  if (error instanceof SupabaseError && error.status === 409) return errorResponse('Registro em conflito', 409);
  return errorResponse('Nao foi possivel concluir esta operacao agora.', 500);
};
