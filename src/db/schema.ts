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

export const CREATE_PRODUCT_RULES = `
CREATE TABLE IF NOT EXISTS product_rules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  provider       TEXT NOT NULL,
  type           TEXT NOT NULL,
  product_code   TEXT NOT NULL,
  product_name   TEXT,
  units_per_box  INTEGER,
  quantity_value INTEGER,
  quantity_unit  TEXT,
  discount_pct   INTEGER,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  UNIQUE(provider, type, product_code)
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
