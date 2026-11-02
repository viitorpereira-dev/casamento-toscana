import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const db = new PGlite();
try {
  for (const path of ['../fixtures/gift-lists-schema.sql','../../supabase/migrations/20261102194311_gift_lists.sql','../gift-lists.sql']) {
    await db.exec(await readFile(new URL(path, import.meta.url), 'utf8'));
  }
  console.log('PASS: migração, permissões, listas, movimentação atômica e histórico de reservas/pagamentos.');
} finally { await db.close(); }
