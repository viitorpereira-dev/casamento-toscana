-- Reclassifica os presentes existentes sem alterar preços, pagamentos ou disponibilidade.
BEGIN;

WITH category_mapping(id, category) AS (VALUES
  ('cafeteira', 'cozinha'),
  ('panelas', 'cozinha'),
  ('cozi-pasta-tramontina-professional-inox-2-pecas-20-cm', 'cozinha'),
  ('jogo-panelas-tramontina-refinatta-starflon-premium-3-pecas', 'cozinha'),
  ('jogo-panelas-tramontina-una-ceramic-grafite-4-pecas', 'cozinha'),
  ('batedeira', 'eletrodomesticos'),
  ('liquidificador', 'eletrodomesticos'),
  ('106', 'eletrodomesticos'),
  ('air-fryer-mondial-dual-duplo-cesto-preto-e-inox-8l-com-timer', 'eletrodomesticos'),
  ('cooktop', 'eletrodomesticos'),
  ('104', 'eletrodomesticos'),
  ('105', 'eletrodomesticos'),
  ('107', 'eletrodomesticos'),
  ('aparelho-de-jantar', 'mesa'),
  ('tacas', 'mesa'),
  ('102', 'moveis'),
  ('111', 'moveis'),
  ('114', 'moveis'),
  ('110', 'moveis'),
  ('112', 'moveis'),
  ('teste', 'moveis'),
  ('101', 'moveis'),
  ('toalhas', 'cama-banho'),
  ('linho', 'cama-banho'),
  ('manta', 'decoracao'),
  ('luminaria', 'decoracao'),
  ('108', 'eletronicos'),
  ('armario', 'lavanderia'),
  ('100', 'lavanderia'),
  ('cunhado-como-piloto-na-lua-de-mel', 'lua-de-mel'),
  ('bancar-parte-da-viagem', 'lua-de-mel'),
  ('ajuda-para-nossa-lua-de-mel', 'lua-de-mel'),
  ('so-pra-dizer-que-nao-dei-nada-2', 'contribuicoes'),
  ('nao-dei-nada-1', 'contribuicoes'),
  ('gravata-virtual', 'contribuicoes'),
  ('vaquinha-para-ajudar-os-noivos', 'contribuicoes'),
  ('levar-convidado-extra', 'brincadeiras'),
  ('convidado-vip', 'brincadeiras'),
  ('escolher-musica-para-os-noivos-dancarem', 'brincadeiras')
)
UPDATE public.gifts AS gift
SET category = mapping.category, updated_at = now()
FROM category_mapping AS mapping
WHERE gift.id = mapping.id AND gift.category IS DISTINCT FROM mapping.category;

WITH category_order(category, position) AS (VALUES
  ('cozinha', 1),
  ('eletrodomesticos', 2),
  ('mesa', 3),
  ('moveis', 4),
  ('cama-banho', 5),
  ('decoracao', 6),
  ('eletronicos', 7),
  ('lavanderia', 8),
  ('lua-de-mel', 9),
  ('contribuicoes', 10),
  ('brincadeiras', 11),
  ('outros', 12)
), ordered AS (
  SELECT gift.id, row_number() OVER (
    ORDER BY gift.available DESC, coalesce(category_order.position, 99), gift.price, gift.id
  )::integer AS position
  FROM public.gifts AS gift
  LEFT JOIN category_order ON category_order.category = gift.category
)
UPDATE public.gifts AS gift
SET featured = ordered.position, updated_at = now()
FROM ordered
WHERE gift.id = ordered.id AND gift.featured IS DISTINCT FROM ordered.position;

COMMIT;

