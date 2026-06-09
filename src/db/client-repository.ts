import { DatabaseSync } from 'node:sqlite';
import { CREATE_CLIENT_ALIASES, normalizeAlias } from './schema.js';
import type { Platform } from '../platforms/types.js';

export interface ClientAliasRecord {
  platform: Platform;
  aliasNorm: string;
  aliasRaw: string;
  clientCode: string;
  clientName: string;
  createdAt: string;
}

export interface SaveClientAliasInput {
  platform: Platform;
  aliasRaw: string;
  clientCode: string;
  clientName: string;
}

export class ClientRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(CREATE_CLIENT_ALIASES);
  }

  private mapRow(row: Record<string, unknown>): ClientAliasRecord {
    return {
      platform: row.platform as Platform,
      aliasNorm: row.alias_norm as string,
      aliasRaw: row.alias_raw as string,
      clientCode: row.client_code as string,
      clientName: row.client_name as string,
      createdAt: row.created_at as string,
    };
  }

  find(platform: Platform, aliasRaw: string): ClientAliasRecord | undefined {
    const stmt = this.db.prepare(
      'SELECT platform, alias_norm, alias_raw, client_code, client_name, created_at FROM client_aliases WHERE platform = ? AND alias_norm = ?',
    );
    const row = stmt.get(platform, normalizeAlias(aliasRaw)) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  save(input: SaveClientAliasInput): void {
    const stmt = this.db.prepare(
      `INSERT INTO client_aliases (platform, alias_norm, alias_raw, client_code, client_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, alias_norm) DO UPDATE SET
         alias_raw = excluded.alias_raw,
         client_code = excluded.client_code,
         client_name = excluded.client_name,
         created_at = excluded.created_at`,
    );
    const now = new Date().toISOString();
    stmt.run(
      input.platform,
      normalizeAlias(input.aliasRaw),
      input.aliasRaw,
      input.clientCode,
      input.clientName,
      now,
    );
  }

  close(): void {
    this.db.close();
  }
}
