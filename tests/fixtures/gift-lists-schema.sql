CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO service_role;
CREATE TABLE public.gifts (
 id text PRIMARY KEY, name text NOT NULL, category text NOT NULL DEFAULT 'outros', description text NOT NULL DEFAULT '',
 price numeric NOT NULL DEFAULT 0 CHECK(price >= 0), image_url text NOT NULL DEFAULT '', badge text NOT NULL DEFAULT '', featured integer NOT NULL DEFAULT 99,
 payment_url text NOT NULL DEFAULT '', pix_key text NOT NULL DEFAULT '', pix_payload text NOT NULL DEFAULT '', available boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.gift_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), gift_id text NOT NULL REFERENCES public.gifts(id) ON DELETE RESTRICT,
 guest_name text NOT NULL, guest_email text NOT NULL, payment_method text NOT NULL CHECK(payment_method IN ('pix','mercado-pago')),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','payment_reported','confirmed','expired','cancelled')),
 claim_token_hash text NOT NULL UNIQUE, payment_note text NOT NULL DEFAULT '', reserved_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 payment_reported_at timestamptz, confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gift_claims_one_active_per_gift ON public.gift_claims(gift_id) WHERE status IN ('reserved','payment_reported','confirmed');
ALTER TABLE public.gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_claims ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.gifts, public.gift_claims TO service_role;
CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TRIGGER gifts_touch_updated_at BEFORE UPDATE ON public.gifts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER gift_claims_touch_updated_at BEFORE UPDATE ON public.gift_claims FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.gifts(id,name,price,payment_url) VALUES ('existing','Existente',123.45,'https://example.invalid/payment');
INSERT INTO public.gift_claims(gift_id,guest_name,guest_email,payment_method,status,claim_token_hash,expires_at)
VALUES ('existing','Teste','test@example.invalid','mercado-pago','expired','old-token',now()-interval '1 day');
