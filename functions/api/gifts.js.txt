import {
  handleUnexpectedError,
  json,
  supabaseGet
} from '../_shared.js';

const ACTIVE_STATUSES = new Set(['reserved', 'payment_reported', 'confirmed']);

export const onRequestGet = async ({ env }) => {
  try {
    const [gifts, claims] = await Promise.all([
      supabaseGet(env, 'gifts', '?select=id,name,category,description,price,image_url,badge,featured,payment_url,available&available=eq.true&order=featured.asc'),
      supabaseGet(env, 'gift_claims', '?select=gift_id,status,expires_at&status=in.(reserved,payment_reported,confirmed)')
    ]);
    const now = Date.now();
    const activeClaims = claims.filter((claim) => ACTIVE_STATUSES.has(claim.status) && (claim.status === 'confirmed' || new Date(claim.expires_at).getTime() > now));
    const claimsByGift = new Map(activeClaims.map((claim) => [claim.gift_id, claim]));

    return json({
      gifts: gifts.map((gift) => {
        const claim = claimsByGift.get(gift.id);
        return {
          id: gift.id,
          name: gift.name,
          category: gift.category,
          description: gift.description,
          price: Number(gift.price),
          imageUrl: gift.image_url,
          badge: gift.badge,
          featured: gift.featured,
          paymentUrl: gift.payment_url,
          status: claim ? claim.status : 'available',
          expiresAt: claim?.expires_at || null
        };
      })
    });
  } catch (error) {
    return handleUnexpectedError(error);
  }
};
