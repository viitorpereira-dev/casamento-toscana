import { errorResponse, SupabaseError, supabaseGetAll } from './_shared.js';

export class GiftListError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

export const assertListId = (value) => {
  const id = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new GiftListError('Selecione uma lista de presentes válida.');
  return id;
};

export const loadGiftLists = (env, publishedOnly = false) => supabaseGetAll(env, 'gift_lists', '?select=id,slug,name,description,status,position,created_at,updated_at' + (publishedOnly ? '&status=eq.published' : '') + '&order=position.asc,created_at.asc,id.asc');

export const giftListErrorResponse = (error) => {
  if (error instanceof GiftListError) return errorResponse(error.message, error.status);
  if (!(error instanceof SupabaseError)) return null;
  const messages = {
    LIST_UNAVAILABLE: ['Esta lista não está disponível para esta operação.', 404],
    LIST_LINK_IMMUTABLE: ['O link da lista é permanente. Altere apenas o nome.', 409],
    GIFT_MOVE_BLOCKED: ['Um dos presentes tem reserva ativa ou pagamento informado/confirmado e não pode mudar de lista.', 409],
    GIFT_LIST_MISMATCH: ['O presente mudou de lista. Atualize a página antes de continuar.', 409],
    CLAIM_ORIGIN_IMMUTABLE: ['A lista de origem da reserva não pode ser alterada.', 409],
    GIFT_UNAVAILABLE: ['Este presente não está disponível.', 404],
    GIFT_PAYMENT_MISSING: ['O pagamento deste presente ainda não foi configurado.', 503],
    GIFT_ALREADY_CLAIMED: ['Este presente já está reservado.', 409],
    PAYMENT_REVIEW_REQUIRED: ['Pagamentos informados não expiram automaticamente. Confira o recebimento antes de confirmar ou cancelar.', 409],
    INVALID_GIFT_SELECTION: ['Selecione entre 1 e 500 presentes, sem repetir itens.', 422],
    GIFT_SELECTION_CHANGED: ['A seleção mudou de lista ou foi excluída. Atualize os cadastros.', 409],
    LIST_SELECTION_CHANGED: ['As listas mudaram. Atualize o painel antes de reordenar.', 409]
  };
  const match = messages[error.details?.message];
  if (match) return errorResponse(...match);
  if (['23503', '23001'].includes(error.details?.code)) return errorResponse('Este cadastro tem produtos ou histórico de reservas. Arquive a lista para preservar os dados.', 409);
  if (['40P01', '40001'].includes(error.details?.code)) return errorResponse('Os cadastros mudaram durante esta ação. Atualize e tente novamente.', 409);
  if (error.details?.code === '23505' || error.status === 409) return errorResponse('O cadastro mudou ou já existe. Atualize a página.', 409);
  return null;
};
