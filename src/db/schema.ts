// src/db/schema.ts
export const CREATE_ALIASES = `
CREATE TABLE IF NOT EXISTS aliases (
  platform      TEXT NOT NULL,
  alias_norm    TEXT NOT NULL,
  alias_raw     TEXT NOT NULL,
  product_code  TEXT NOT NULL,
  product_name  TEXT NOT NULL,
  units_per_box INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (platform, alias_norm)
);
`;

/** Normalizes an alias: lowercase, strip accents, collapse whitespace. */
export function normalizeAlias(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
