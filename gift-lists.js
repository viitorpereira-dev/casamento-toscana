export const GIFT_LIST_STATUSES = Object.freeze({ draft: 'Oculta', published: 'Publicada', archived: 'Arquivada' });

export const claimHoldsGift = (claim, now = Date.now()) => claim.status === 'payment_reported' || claim.status === 'confirmed' || (claim.status === 'reserved' && new Date(claim.expires_at).getTime() > now);

export const resolvePublicGiftList = (lists, requested) => requested
  ? lists.find((list) => list.slug === requested || list.id === requested) || null
  : lists.find((list) => list.slug === 'casamento') || lists[0] || null;

export const giftListLink = (list, baseUrl) => {
  const url = new URL('/', baseUrl);
  url.searchParams.set('lista', list.slug);
  url.hash = 'presentes';
  return url.href;
};
