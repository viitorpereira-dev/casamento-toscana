import { albumFilter, albumForPhoto, requestAlbum } from '../_albums.js';
import {
  errorResponse,
  handleUnexpectedError,
  json,
  normalizeText,
  readJson,
  requireAdmin,
  supabaseDelete,
  supabaseGet,
  supabaseGetAll,
  supabasePatch,
  supabasePost
} from '../_shared.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ['image/jpeg', { extension: 'jpg', signature: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }],
  ['image/png', { extension: 'png', signature: (bytes) => bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte) }],
  ['image/webp', { extension: 'webp', signature: (bytes) => bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP' }],
  ['image/avif', { extension: 'avif', signature: (bytes) => bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp' && /^(avif|avis)$/.test(new TextDecoder().decode(bytes.slice(8, 12))) }]
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireSession = async (request, env) => {
  if (!(await requireAdmin(request, env))) throw new Response('Unauthorized', { status: 401 });
};

const galleryRows = (env, album) => supabaseGetAll(env, 'gallery_photos', '?select=id,storage_path,title,subtitle,position,framing_zoom,framing_x,framing_y,created_at&order=position.asc,created_at.asc,id.asc' + (album ? albumFilter(album) : ''));

const storageRequest = async (env, path, options = {}) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase is not configured');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/${path}`, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) {
    let message = body;
    try { message = JSON.parse(body).message || JSON.parse(body).error || body; } catch {}
    const error = new Error('Storage request failed');
    error.status = response.status;
    error.details = message;
    throw error;
  }
  if (!body) return null;
  try { return JSON.parse(body); } catch { return body; }
};

const storageObjectPath = (path) => `object/gallery/${path.split('/').map(encodeURIComponent).join('/')}`;

const validateImage = async (file) => {
  const descriptor = IMAGE_TYPES.get(file.type);
  if (!descriptor) throw new Error('Formato nao permitido. Use JPEG, PNG, WebP ou AVIF.');
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('Cada imagem deve ter no maximo 10 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!descriptor.signature(bytes)) throw new Error('O conteudo do arquivo nao corresponde ao formato informado.');
  return { bytes, extension: descriptor.extension };
};

const publishPhoto = async (request, env, album) => {
  const form = await request.formData();
  const file = form.get('file');
  const title = normalizeText(form.get('title'), 140);
  const subtitle = normalizeText(form.get('subtitle'), 240);
  if (!(file instanceof File)) return errorResponse('Selecione uma imagem para publicar.', 422);
  if (!title) return errorResponse('Informe o titulo da imagem.', 422);
  let validated;
  try {
    validated = await validateImage(file);
  } catch (error) {
    return errorResponse(error.message, 422);
  }

  const id = crypto.randomUUID();
  const path = `${album === 'story' ? 'story/' : ''}${id}.${validated.extension}`;
  try {
    // Allocate positions across both albums to preserve existing database constraints.
    const existingPhotos = await galleryRows(env);
    const position = existingPhotos.reduce((maximum, photo) => Math.max(maximum, Number(photo.position) || 0), -1) + 1;
    await storageRequest(env, storageObjectPath(path), {
      method: 'POST',
      headers: { 'Content-Type': file.type, 'x-upsert': 'false' },
      body: validated.bytes
    });
    let rows;
    try {
      rows = await supabasePost(env, 'gallery_photos', {
        id,
        storage_path: path,
        title,
        subtitle: subtitle || null,
        position
      }, '?select=id,storage_path,title,subtitle,position,created_at');
      if (album === 'travel') {
        await supabasePost(env, 'gallery_state', { id: 1, is_active: true }, '?on_conflict=id', 'resolution=merge-duplicates,return=minimal');
      }
    } catch (error) {
      await supabaseDelete(env, 'gallery_photos', `?id=eq.${encodeURIComponent(id)}`).catch(() => {});
      await storageRequest(env, storageObjectPath(path), { method: 'DELETE' }).catch(() => {});
      throw error;
    }
    return json({ ok: true, photo: rows[0] }, 201);
  } catch (error) {
    if (error.status && error.name !== 'SupabaseError') return errorResponse('Nao foi possivel publicar a imagem no armazenamento.', 502, String(error.details || ''));
    return handleUnexpectedError(error);
  }
};

const updatePhoto = async (env, body, album) => {
  const id = normalizeText(body.id, 36);
  const title = normalizeText(body.title, 140);
  const subtitle = normalizeText(body.subtitle, 240);
  if (!UUID_PATTERN.test(id)) return errorResponse('Imagem invalida.', 422);
  if (!title) return errorResponse('Informe o titulo da imagem.', 422);
  const framingZoom = Number(body.framingZoom);
  const framingX = Number(body.framingX);
  const framingY = Number(body.framingY);
  if (!Number.isFinite(framingZoom) || framingZoom < 0.01 || framingZoom > 3
      || !Number.isFinite(framingX) || framingX < -1 || framingX > 1
      || !Number.isFinite(framingY) || framingY < -1 || framingY > 1) {
    return errorResponse('O enquadramento da imagem e invalido.', 422);
  }
  const rows = await supabasePatch(env, 'gallery_photos', `?id=eq.${encodeURIComponent(id)}&select=id,storage_path,title,subtitle,position,framing_zoom,framing_x,framing_y,created_at${albumFilter(album)}`, {
    title,
    subtitle: subtitle || null,
    framing_zoom: framingZoom,
    framing_x: framingX,
    framing_y: framingY
  });
  if (!rows.length) return errorResponse('Imagem nao encontrada.', 404);
  return json({ ok: true, photo: rows[0] });
};

const reorderPhotos = async (env, body, album) => {
  if (!Array.isArray(body.ids) || body.ids.some((id) => !UUID_PATTERN.test(String(id))) || new Set(body.ids).size !== body.ids.length) {
    return errorResponse('A ordem enviada e invalida.', 422);
  }
  const photos = await galleryRows(env);
  const selected = photos.filter((photo) => albumForPhoto(photo) === album);
  const selectedIds = new Set(selected.map((photo) => photo.id));
  if (body.ids.length !== selected.length || body.ids.some((id) => !selectedIds.has(id))) {
    return errorResponse('As fotos do album mudaram. Atualize a pagina e tente novamente.', 409);
  }
  // The existing RPC receives the full gallery; keep the other album's order intact.
  const otherIds = photos.filter((photo) => albumForPhoto(photo) !== album).map((photo) => photo.id);
  const ids = album === 'story' ? [...otherIds, ...body.ids] : [...body.ids, ...otherIds];
  await supabaseRequestRpc(env, 'reorder_gallery_photos', { photo_ids: ids });
  return json({ ok: true });
};

const supabaseRequestRpc = async (env, name, payload) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase is not configured');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('Nao foi possivel salvar a ordem da galeria.');
};

const deletePhoto = async (env, body, album) => {
  const id = normalizeText(body.id, 36);
  if (!UUID_PATTERN.test(id)) return errorResponse('Imagem invalida.', 422);
  const matches = await supabaseGet(env, 'gallery_photos', `?id=eq.${encodeURIComponent(id)}&select=id,storage_path${albumFilter(album)}`);
  if (!matches.length) return errorResponse('Imagem nao encontrada.', 404);
  await storageRequest(env, storageObjectPath(matches[0].storage_path), { method: 'DELETE' }).catch((error) => {
    if (error.status !== 404) throw error;
  });
  await supabaseDelete(env, 'gallery_photos', `?id=eq.${encodeURIComponent(id)}${albumFilter(album)}`);
  return json({ ok: true });
};

export const onRequestGet = async ({ request, env }) => {
  try {
    const album = requestAlbum(request);
    const [state, photos] = await Promise.all([
      album === 'travel' ? supabaseGet(env, 'gallery_state', '?select=is_active&id=eq.1') : [],
      galleryRows(env, album)
    ]);
    const publicBase = `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/gallery/`;
    return json({
      active: album === 'story' || state[0]?.is_active === true,
      photos: photos.map((photo) => ({
        ...photo,
        public_url: `${publicBase}${photo.storage_path.split('/').map(encodeURIComponent).join('/')}`
      }))
    });
  } catch (error) {
    if (error instanceof Response) return errorResponse('Album invalido.', error.status);
    return handleUnexpectedError(error);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    await requireSession(request, env);
    return await publishPhoto(request, env, requestAlbum(request));
  } catch (error) {
    if (error instanceof Response) return errorResponse(error.status === 401 ? 'Acesso administrativo necessario.' : 'Album invalido.', error.status);
    return handleUnexpectedError(error);
  }
};

export const onRequestPatch = async ({ request, env }) => {
  try {
    await requireSession(request, env);
    const album = requestAlbum(request);
    const body = await readJson(request);
    if (body.action === 'update') return await updatePhoto(env, body, album);
    if (body.action === 'reorder') return await reorderPhotos(env, body, album);
    return errorResponse('Acao de galeria desconhecida.', 400);
  } catch (error) {
    if (error instanceof Response) return errorResponse(error.status === 401 ? 'Acesso administrativo necessario.' : 'Album invalido.', error.status);
    return handleUnexpectedError(error);
  }
};

export const onRequestDelete = async ({ request, env }) => {
  try {
    await requireSession(request, env);
    return await deletePhoto(env, await readJson(request), requestAlbum(request));
  } catch (error) {
    if (error instanceof Response) return errorResponse(error.status === 401 ? 'Acesso administrativo necessario.' : 'Album invalido.', error.status);
    return handleUnexpectedError(error);
  }
};

