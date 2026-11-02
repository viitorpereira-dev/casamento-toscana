-- Execute somente em um banco descartável, após fixtures/gift-lists-schema.sql e a migração.
BEGIN;
CREATE FUNCTION pg_temp.expect_error(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text; actual_message text;
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION 'Expected error: %', expected;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE, actual_message = MESSAGE_TEXT;
    IF actual_state <> expected AND actual_message <> expected THEN RAISE; END IF;
  END;
END;
$$;
DO $$
DECLARE wedding uuid; tea uuid; history uuid; original_slug text; result jsonb; moved integer;
BEGIN
  SELECT id INTO wedding FROM public.gift_lists WHERE slug='casamento';
  SELECT id INTO tea FROM public.gift_lists WHERE slug='cha-de-cozinha';
  ASSERT (SELECT list_id=wedding FROM public.gifts WHERE id='existing'), 'backfill do produto';
  ASSERT (SELECT list_id=wedding FROM public.gift_claims WHERE gift_id='existing'), 'backfill da origem';
  ASSERT (SELECT status='draft' FROM public.gift_lists WHERE id=tea), 'chá deve começar oculto';
  ASSERT NOT has_table_privilege('anon','public.gift_lists','SELECT'), 'sem leitura pública de rascunhos';
  ASSERT NOT has_function_privilege('anon','public.create_gift_list_claim(text,uuid,text,text,text)','EXECUTE'), 'RPC não pública';
  ASSERT has_function_privilege('service_role','public.create_gift_list_claim(text,uuid,text,text,text)','EXECUTE'), 'RPC do backend';

  INSERT INTO public.gifts(id,name,price,payment_url) VALUES
    ('free-a','A',10,'https://example.invalid/a'),('free-b','B',20,'https://example.invalid/b'),
    ('reported','C',30,'https://example.invalid/c'),('archive-pending','D',40,'https://example.invalid/d');
  moved := public.move_gifts_to_list(ARRAY['free-a','free-b'],wedding,tea);
  ASSERT moved=2, 'movimento em lote';
  PERFORM pg_temp.expect_error($test$ SELECT public.create_gift_list_claim('free-b',(SELECT id FROM public.gift_lists WHERE slug='cha-de-cozinha'),'Teste','test@example.invalid','draft-token') $test$,'LIST_UNAVAILABLE');
  UPDATE public.gift_lists SET status='published' WHERE id=tea;
  result := public.create_gift_list_claim('free-b',tea,'Teste','test@example.invalid','token-b');
  ASSERT result->'claim'->>'list_id'=tea::text, 'reserva registra lista correta';
  PERFORM pg_temp.expect_error($test$ SELECT public.create_gift_list_claim('free-b',(SELECT id FROM public.gift_lists WHERE slug='cha-de-cozinha'),'Teste','test@example.invalid','duplicate-token') $test$,'GIFT_ALREADY_CLAIMED');
  PERFORM pg_temp.expect_error($test$ SELECT public.move_gifts_to_list(ARRAY['free-a','free-b'],(SELECT id FROM public.gift_lists WHERE slug='cha-de-cozinha'),(SELECT id FROM public.gift_lists WHERE slug='casamento')) $test$,'GIFT_MOVE_BLOCKED');
  ASSERT (SELECT list_id=tea FROM public.gifts WHERE id='free-a'), 'lote não pode mover parcialmente';
  PERFORM pg_temp.expect_error($test$ UPDATE public.gifts SET list_id=(SELECT id FROM public.gift_lists WHERE slug='casamento') WHERE id='free-b' $test$,'GIFT_MOVE_BLOCKED');
  PERFORM pg_temp.expect_error($test$ UPDATE public.gift_claims SET list_id=(SELECT id FROM public.gift_lists WHERE slug='casamento') WHERE claim_token_hash='token-b' $test$,'CLAIM_ORIGIN_IMMUTABLE');

  UPDATE public.gift_claims SET expires_at=now()-interval '1 minute' WHERE claim_token_hash='token-b';
  PERFORM public.move_gifts_to_list(ARRAY['free-b'],tea,wedding);
  ASSERT (SELECT list_id=tea FROM public.gift_claims WHERE claim_token_hash='token-b'), 'origem histórica permanece no chá';
  result := public.create_gift_list_claim('free-b',wedding,'Teste','test@example.invalid','token-b-new');
  ASSERT (SELECT status='expired' FROM public.gift_claims WHERE claim_token_hash='token-b'), 'reserva vencida expira antes de nova reserva';
  ASSERT result->'claim'->>'list_id'=wedding::text, 'nova reserva usa lista atual';
  PERFORM pg_temp.expect_error($test$ SELECT public.create_gift_list_claim('free-a',(SELECT id FROM public.gift_lists WHERE slug='casamento'),'Teste','test@example.invalid','wrong-list') $test$,'GIFT_LIST_MISMATCH');

  PERFORM public.create_gift_list_claim('reported',wedding,'Teste','test@example.invalid','reported-token');
  UPDATE public.gift_claims SET status='payment_reported', expires_at=now()-interval '1 day' WHERE claim_token_hash='reported-token';
  PERFORM pg_temp.expect_error($test$ SELECT public.move_gifts_to_list(ARRAY['reported'],(SELECT id FROM public.gift_lists WHERE slug='casamento'),(SELECT id FROM public.gift_lists WHERE slug='cha-de-cozinha')) $test$,'GIFT_MOVE_BLOCKED');
  PERFORM pg_temp.expect_error($test$ SELECT public.create_gift_list_claim('reported',(SELECT id FROM public.gift_lists WHERE slug='casamento'),'Teste','test@example.invalid','reported-repeat') $test$,'GIFT_ALREADY_CLAIMED');
  ASSERT (SELECT status='payment_reported' FROM public.gift_claims WHERE claim_token_hash='reported-token'), 'pagamento informado não expira';
  PERFORM pg_temp.expect_error($test$ UPDATE public.gift_claims SET status='expired' WHERE claim_token_hash='reported-token' $test$,'PAYMENT_REVIEW_REQUIRED');
  UPDATE public.gift_claims SET status='confirmed' WHERE claim_token_hash='reported-token';
  PERFORM pg_temp.expect_error($test$ SELECT public.move_gifts_to_list(ARRAY['reported'],(SELECT id FROM public.gift_lists WHERE slug='casamento'),(SELECT id FROM public.gift_lists WHERE slug='cha-de-cozinha')) $test$,'GIFT_MOVE_BLOCKED');

  PERFORM public.move_gifts_to_list(ARRAY['archive-pending'],wedding,tea);
  PERFORM public.create_gift_list_claim('archive-pending',tea,'Teste','test@example.invalid','archive-token');
  UPDATE public.gift_lists SET status='archived',name='Chá renomeado' WHERE id=tea;
  ASSERT (SELECT slug='cha-de-cozinha' FROM public.gift_lists WHERE id=tea), 'renomear não quebra link';
  PERFORM pg_temp.expect_error($test$ UPDATE public.gift_lists SET slug='outro-slug' WHERE slug='cha-de-cozinha' $test$,'LIST_LINK_IMMUTABLE');
  PERFORM pg_temp.expect_error($test$ SELECT public.create_gift_list_claim('free-a',(SELECT id FROM public.gift_lists WHERE slug='cha-de-cozinha'),'Teste','test@example.invalid','archived-token') $test$,'LIST_UNAVAILABLE');
  UPDATE public.gift_claims SET status='payment_reported' WHERE claim_token_hash='archive-token';
  ASSERT (SELECT status='payment_reported' FROM public.gift_claims WHERE claim_token_hash='archive-token'), 'arquivar não impede conferência de reserva anterior';
  PERFORM pg_temp.expect_error($test$ DELETE FROM public.gift_lists WHERE slug='cha-de-cozinha' $test$,'23001');
  PERFORM public.reorder_gift_lists(ARRAY[tea,wedding]);
  ASSERT (SELECT position=0 FROM public.gift_lists WHERE id=tea), 'reordenação';
  PERFORM pg_temp.expect_error($test$ SELECT public.reorder_gift_lists(ARRAY[(SELECT id FROM public.gift_lists WHERE slug='casamento')]) $test$,'LIST_SELECTION_CHANGED');

  INSERT INTO public.gift_lists(slug,name,status) VALUES ('history-only','Histórico','published') RETURNING id INTO history;
  INSERT INTO public.gifts(id,name,payment_url,list_id) VALUES ('history-gift','Histórico','https://example.invalid/history',history);
  PERFORM public.create_gift_list_claim('history-gift',history,'Teste','test@example.invalid','history-token');
  UPDATE public.gift_claims SET expires_at=now()-interval '1 minute' WHERE claim_token_hash='history-token';
  PERFORM public.move_gifts_to_list(ARRAY['history-gift'],history,wedding);
  ASSERT NOT EXISTS(SELECT 1 FROM public.gifts WHERE list_id=history), 'lista vazia com histórico';
  PERFORM pg_temp.expect_error($test$ DELETE FROM public.gift_lists WHERE slug='history-only' $test$,'23001');
  INSERT INTO public.gift_lists(slug,name) VALUES ('empty-list','Vazia');
  DELETE FROM public.gift_lists WHERE slug='empty-list';
  ASSERT NOT EXISTS(SELECT 1 FROM public.gift_lists WHERE slug='empty-list'), 'lista vazia pode ser excluída';
END;
$$;
SET LOCAL ROLE service_role;
SELECT public.default_gift_list_id();
RESET ROLE;
ROLLBACK;
