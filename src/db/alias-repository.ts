import { DatabaseSync } from 'node:sqlite';
import { CREATE_ALIASES, normalizeAlias } from './schema.js';
import type { Platform } from '../platforms/types.js';

export interface AliasRecord {
  platform: Platform;
  aliasNorm: string;
  aliasRaw: string;
  productCode: string;
  productName: string;
  unitsPerBox: number;
  createdAt: string;
}

export interface SaveAliasInput {
  platform: Platform;
  aliases: string[];
  productCode: string;
  productName: string;
  unitsPerBox: number;
}

export class AliasRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(CREATE_ALIASES);
  }

  find(platform: Platform, aliasRaw: string): AliasRecord | undefined {
    const stmt = this.db.prepare(
      'SELECT platform, alias_norm, alias_raw, product_code, product_name, units_per_box, created_at FROM aliases WHERE platform = ? AND alias_norm = ?',
    );
    const row = stmt.get(platform, normalizeAlias(aliasRaw)) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      platform: row.platform as Platform,
      aliasNorm: row.alias_norm as string,
      aliasRaw: row.alias_raw as string,
      productCode: row.product_code as string,
      productName: row.product_name as string,
      unitsPerBox: Number(row.units_per_box),
      createdAt: row.created_at as string,
    };
  }

  save(input: SaveAliasInput): void {
    const stmt = this.db.prepare(
      `INSERT INTO aliases (platform, alias_norm, alias_raw, product_code, product_name, units_per_box, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, alias_norm) DO UPDATE SET
         alias_raw = excluded.alias_raw,
         product_code = excluded.product_code,
         product_name = excluded.product_name,
         units_per_box = excluded.units_per_box`,
    );
    const now = new Date().toISOString();
    for (const aliasRaw of input.aliases) {
      stmt.run(
        input.platform,
        normalizeAlias(aliasRaw),
        aliasRaw,
        input.productCode,
        input.productName,
        input.unitsPerBox,
        now,
      );
    }
  }

  close(): void {
    this.db.close();
  }
}
