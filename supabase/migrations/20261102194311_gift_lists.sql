CREATE TABLE public.gift_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  position integer NOT NULL DEFAULT 99 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gift_lists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gift_lists FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gift_lists TO service_role;
CREATE INDEX gift_lists_published_order ON public.gift_lists (position, created_at, id) WHERE status = 'published';

INSERT INTO public.gift_lists (slug, name, description, status, position) VALUES
  ('casamento', 'Casamento', 'Presentes para celebrar o nosso casamento.', 'published', 0),
  ('cha-de-cozinha', 'Chá de cozinha', 'Uma lista para montar a nossa cozinha.', 'draft', 1);

CREATE FUNCTION public.default_gift_list_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT id FROM public.gift_lists WHERE status <> 'archived'
  ORDER BY (slug = 'casamento') DESC, position, created_at, id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.default_gift_list_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.default_gift_list_id() TO service_role;

ALTER TABLE public.gifts ADD COLUMN list_id uuid;
UPDATE public.gifts SET list_id = (SELECT id FROM public.gift_lists WHERE slug = 'casamento');
ALTER TABLE public.gifts ALTER COLUMN list_id SET NOT NULL;
ALTER TABLE public.gifts ALTER COLUMN list_id SET DEFAULT public.default_gift_list_id();
ALTER TABLE public.gifts ADD CONSTRAINT gifts_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.gift_lists(id) ON DELETE RESTRICT;
CREATE INDEX gifts_list_catalog ON public.gifts (list_id, available, featured, id);

ALTER TABLE public.gift_claims ADD COLUMN list_id uuid;
UPDATE public.gift_claims AS claim SET list_id = gift.list_id FROM public.gifts AS gift WHERE gift.id = claim.gift_id;
ALTER TABLE public.gift_claims ALTER COLUMN list_id SET NOT NULL;
ALTER TABLE public.gift_claims ADD CONSTRAINT gift_claims_origin_list_fkey FOREIGN KEY (list_id) REFERENCES public.gift_lists(id) ON DELETE RESTRICT;
CREATE INDEX gift_claims_origin_list ON public.gift_claims (list_id, gift_id);
CREATE INDEX gift_claims_gift_history ON public.gift_claims (gift_id);

ALTER FUNCTION public.touch_updated_at() SET search_path = '';
CREATE TRIGGER gift_lists_touch_updated_at BEFORE UPDATE ON public.gift_lists FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE FUNCTION public.guard_gift_list_link() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN RAISE EXCEPTION 'LIST_LINK_IMMUTABLE' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER gift_lists_stable_link BEFORE UPDATE ON public.gift_lists FOR EACH ROW EXECUTE FUNCTION public.guard_gift_list_link();

CREATE FUNCTION public.guard_gift_list_move() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE target_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.list_id IS NOT DISTINCT FROM OLD.list_id THEN RETURN NEW; END IF;
  SELECT status INTO target_status FROM public.gift_lists WHERE id = NEW.list_id FOR SHARE;
  IF NOT FOUND OR target_status = 'archived' THEN RAISE EXCEPTION 'LIST_UNAVAILABLE' USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM public.gift_claims WHERE gift_id = OLD.id AND
      (status IN ('payment_reported', 'confirmed') OR (status = 'reserved' AND expires_at > now()))
  ) THEN RAISE EXCEPTION 'GIFT_MOVE_BLOCKED' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER gifts_guard_list_move BEFORE INSERT OR UPDATE OF list_id ON public.gifts FOR EACH ROW EXECUTE FUNCTION public.guard_gift_list_move();

CREATE FUNCTION public.guard_claim_origin_list() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE gift_list_id uuid; locked_gift_list_id uuid; list_status text; gift_available boolean; gift_payment_url text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.list_id IS DISTINCT FROM OLD.list_id OR NEW.gift_id IS DISTINCT FROM OLD.gift_id THEN
      RAISE EXCEPTION 'CLAIM_ORIGIN_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status IN ('payment_reported', 'confirmed') AND NEW.status = 'expired' THEN
      RAISE EXCEPTION 'PAYMENT_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status IN ('reserved', 'payment_reported', 'confirmed') THEN
      PERFORM 1 FROM public.gift_lists WHERE id = NEW.list_id FOR SHARE;
      SELECT list_id INTO locked_gift_list_id FROM public.gifts WHERE id = NEW.gift_id FOR UPDATE;
      IF locked_gift_list_id IS DISTINCT FROM NEW.list_id THEN RAISE EXCEPTION 'GIFT_LIST_MISMATCH' USING ERRCODE = 'P0001'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  SELECT list_id INTO gift_list_id FROM public.gifts WHERE id = NEW.gift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_UNAVAILABLE' USING ERRCODE = 'P0001'; END IF;
  SELECT status INTO list_status FROM public.gift_lists WHERE id = gift_list_id FOR SHARE;
  IF list_status IS DISTINCT FROM 'published' THEN RAISE EXCEPTION 'LIST_UNAVAILABLE' USING ERRCODE = 'P0001'; END IF;
  SELECT list_id, available, payment_url INTO locked_gift_list_id, gift_available, gift_payment_url FROM public.gifts WHERE id = NEW.gift_id FOR UPDATE;
  IF NOT gift_available THEN RAISE EXCEPTION 'GIFT_UNAVAILABLE' USING ERRCODE = 'P0001'; END IF;
  IF btrim(gift_payment_url) = '' THEN RAISE EXCEPTION 'GIFT_PAYMENT_MISSING' USING ERRCODE = 'P0001'; END IF;
  IF locked_gift_list_id IS DISTINCT FROM gift_list_id OR (NEW.list_id IS NOT NULL AND NEW.list_id IS DISTINCT FROM gift_list_id) THEN
    RAISE EXCEPTION 'GIFT_LIST_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  NEW.list_id := gift_list_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER gift_claims_guard_origin BEFORE INSERT OR UPDATE ON public.gift_claims FOR EACH ROW EXECUTE FUNCTION public.guard_claim_origin_list();

CREATE FUNCTION public.create_gift_list_claim(p_gift_id text, p_list_id uuid, p_guest_name text, p_guest_email text, p_claim_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE selected_list public.gift_lists%ROWTYPE; selected_gift public.gifts%ROWTYPE; new_claim public.gift_claims%ROWTYPE;
BEGIN
  SELECT * INTO selected_list FROM public.gift_lists WHERE id = p_list_id FOR SHARE;
  IF NOT FOUND OR selected_list.status <> 'published' THEN RAISE EXCEPTION 'LIST_UNAVAILABLE' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO selected_gift FROM public.gifts WHERE id = p_gift_id FOR UPDATE;
  IF NOT FOUND OR NOT selected_gift.available THEN RAISE EXCEPTION 'GIFT_UNAVAILABLE' USING ERRCODE = 'P0001'; END IF;
  IF selected_gift.list_id <> p_list_id THEN RAISE EXCEPTION 'GIFT_LIST_MISMATCH' USING ERRCODE = 'P0001'; END IF;
  IF btrim(selected_gift.payment_url) = '' THEN RAISE EXCEPTION 'GIFT_PAYMENT_MISSING' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.gift_claims SET status = 'expired' WHERE gift_id = p_gift_id AND status = 'reserved' AND expires_at <= now();
  IF EXISTS (SELECT 1 FROM public.gift_claims WHERE gift_id = p_gift_id AND status IN ('reserved', 'payment_reported', 'confirmed')) THEN
    RAISE EXCEPTION 'GIFT_ALREADY_CLAIMED' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.gift_claims (gift_id, list_id, guest_name, guest_email, payment_method, status, claim_token_hash, expires_at)
  VALUES (p_gift_id, p_list_id, p_guest_name, p_guest_email, 'mercado-pago', 'reserved', p_claim_token_hash, now() + interval '24 hours')
  RETURNING * INTO new_claim;
  RETURN jsonb_build_object(
    'claim', jsonb_build_object('id',new_claim.id,'gift_id',new_claim.gift_id,'list_id',new_claim.list_id,'status',new_claim.status,'expires_at',new_claim.expires_at),
    'gift', jsonb_build_object('id',selected_gift.id,'name',selected_gift.name,'price',selected_gift.price,'payment_url',selected_gift.payment_url,'list_id',selected_gift.list_id),
    'list', jsonb_build_object('id',selected_list.id,'name',selected_list.name,'slug',selected_list.slug)
  );
END;
$$;

CREATE FUNCTION public.move_gifts_to_list(p_gift_ids text[], p_source_list_id uuid, p_target_list_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE target_status text; found_count integer; moved_count integer;
BEGIN
  IF coalesce(cardinality(p_gift_ids),0) NOT BETWEEN 1 AND 500 OR cardinality(p_gift_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_gift_ids) AS id) THEN
    RAISE EXCEPTION 'INVALID_GIFT_SELECTION' USING ERRCODE = 'P0001';
  END IF;
  PERFORM id FROM public.gift_lists WHERE id IN (p_source_list_id, p_target_list_id) ORDER BY id FOR SHARE;
  SELECT status INTO target_status FROM public.gift_lists WHERE id = p_target_list_id;
  IF NOT FOUND OR target_status = 'archived' THEN RAISE EXCEPTION 'LIST_UNAVAILABLE' USING ERRCODE = 'P0001'; END IF;
  PERFORM id FROM public.gifts WHERE id = ANY(p_gift_ids) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO found_count FROM public.gifts WHERE id = ANY(p_gift_ids) AND list_id = p_source_list_id;
  IF found_count <> cardinality(p_gift_ids) THEN RAISE EXCEPTION 'GIFT_SELECTION_CHANGED' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.gifts SET list_id = p_target_list_id WHERE id = ANY(p_gift_ids) AND list_id IS DISTINCT FROM p_target_list_id;
  GET DIAGNOSTICS moved_count = ROW_COUNT;
  RETURN moved_count;
END;
$$;

CREATE FUNCTION public.reorder_gift_lists(p_list_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM id FROM public.gift_lists ORDER BY id FOR UPDATE;
  IF coalesce(cardinality(p_list_ids),0) = 0 OR cardinality(p_list_ids) <> (SELECT count(*) FROM public.gift_lists)
    OR cardinality(p_list_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_list_ids) AS id)
    OR EXISTS (SELECT 1 FROM unnest(p_list_ids) AS selected(id) WHERE NOT EXISTS (SELECT 1 FROM public.gift_lists WHERE gift_lists.id = selected.id)) THEN
    RAISE EXCEPTION 'LIST_SELECTION_CHANGED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.gift_lists AS list SET position = ordered.position - 1
  FROM unnest(p_list_ids) WITH ORDINALITY AS ordered(id, position) WHERE list.id = ordered.id;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_gift_list_link(), public.guard_gift_list_move(), public.guard_claim_origin_list(), public.create_gift_list_claim(text,uuid,text,text,text), public.move_gifts_to_list(text[],uuid,uuid), public.reorder_gift_lists(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_gift_list_link(), public.guard_gift_list_move(), public.guard_claim_origin_list(), public.create_gift_list_claim(text,uuid,text,text,text), public.move_gifts_to_list(text[],uuid,uuid), public.reorder_gift_lists(uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
