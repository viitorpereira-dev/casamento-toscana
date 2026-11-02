import { normalizeGiftCategory } from '../../gift-categories.js';
import { claimHoldsGift, resolvePublicGiftList } from '../../gift-lists.js';
import { loadGiftLists } from '../_gift-lists.js';
import { handleUnexpectedError, json, supabaseGetAll } from '../_shared.js';

export const onRequestGet = async ({ request, env }) => {
  try {
    const lists = await loadGiftLists(env, true);
    const requested = new URL(request?.url || 'https://wedding.invalid/api/gifts').searchParams.get('list');
    const selectedList = resolvePublicGiftList(lists, requested);
    if (!selectedList) {
      const unavailable = Boolean(requested);
      return json({ lists, selectedList: null, gifts: [], ...(unavailable ? { error: 'Esta lista não está disponível.' } : {}) }, unavailable ? 404 : 200);
    }
    const [gifts, claims] = await Promise.all([
      supabaseGetAll(env, 'gifts', '?select=id,name,category,description,price,image_url,badge,featured,payment_url,available,list_id&available=eq.true&list_id=eq.' + selectedList.id + '&order=featured.asc,id.asc'),
      supabaseGetAll(env, 'gift_claims', '?select=gift_id,status,expires_at,list_id&list_id=eq.' + selectedList.id + '&status=in.(reserved,payment_reported,confirmed)')
    ]);
    const claimsByGift = new Map(claims.filter((claim) => claimHoldsGift(claim)).map((claim) => [claim.gift_id, claim]));
    return json({ lists, selectedList, gifts: gifts.map((gift) => {
      const claim = claimsByGift.get(gift.id);
      return {
        id: gift.id, listId: gift.list_id, name: gift.name, category: normalizeGiftCategory(gift.category),
        description: gift.description, price: Number(gift.price), imageUrl: gift.image_url, badge: gift.badge,
        featured: gift.featured, paymentUrl: gift.payment_url, status: claim?.status || 'available', expiresAt: claim?.expires_at || null
      };
    }) });
  } catch (error) { return handleUnexpectedError(error); }
};
