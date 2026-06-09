import { DatabaseSync } from 'node:sqlite';
import { CREATE_PRODUCT_RULES } from './schema.js';
import type { Platform } from '../platforms/types.js';

export interface ProductRule {
  id: number;
  provider: Platform;
  type: 'add-product' | 'override-discount' | 'threshold-discount';
  productCode: string;
  productName?: string | undefined;
  unitsPerBox?: number | undefined;
  quantityValue?: number | undefined;
  quantityUnit?: 'UN' | 'CX' | undefined;
  discountPct?: number | undefined;
  enabled: boolean;
  createdAt: string;
}

export type CreateProductRuleInput = Omit<
  ProductRule,
  'id' | 'createdAt' | 'enabled'
> & {
  enabled?: boolean;
};

export class ProductRuleRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(CREATE_PRODUCT_RULES);
  }

  listByProvider(provider: Platform): ProductRule[] {
    const stmt = this.db.prepare(
      'SELECT id, provider, type, product_code, product_name, units_per_box, quantity_value, quantity_unit, discount_pct, enabled, created_at FROM product_rules WHERE provider = ? ORDER BY created_at DESC',
    );
    const rows = stmt.all(provider) as Record<string, unknown>[];
    return rows.map((row) => this.mapRowToRule(row));
  }

  save(rule: CreateProductRuleInput): void {
    const conflictTarget =
      rule.quantityValue !== undefined && rule.quantityValue !== null
        ? '(provider, type, product_code, quantity_value) WHERE quantity_value IS NOT NULL'
        : '(provider, type, product_code) WHERE quantity_value IS NULL';

    const stmt = this.db.prepare(
      `INSERT INTO product_rules (provider, type, product_code, product_name, units_per_box, quantity_value, quantity_unit, discount_pct, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT ${conflictTarget} DO UPDATE SET
         product_name = excluded.product_name,
         units_per_box = excluded.units_per_box,
         quantity_unit = excluded.quantity_unit,
         discount_pct = excluded.discount_pct,
         enabled = excluded.enabled`,
    );
    const now = new Date().toISOString();
    stmt.run(
      rule.provider,
      rule.type,
      rule.productCode,
      rule.productName ?? null,
      rule.unitsPerBox ?? null,
      rule.quantityValue ?? null,
      rule.quantityUnit ?? null,
      rule.discountPct ?? null,
      (rule.enabled ?? true) ? 1 : 0,
      now,
    );
  }

  delete(id: number): void {
    const stmt = this.db.prepare('DELETE FROM product_rules WHERE id = ?');
    stmt.run(id);
  }

  setEnabled(id: number, enabled: boolean): void {
    const stmt = this.db.prepare(
      'UPDATE product_rules SET enabled = ? WHERE id = ?',
    );
    stmt.run(enabled ? 1 : 0, id);
  }

  private mapRowToRule(row: Record<string, unknown>): ProductRule {
    return {
      id: Number(row.id),
      provider: row.provider as Platform,
      type: row.type as
        | 'add-product'
        | 'override-discount'
        | 'threshold-discount',
      productCode: row.product_code as string,
      productName:
        row.product_name !== null ? (row.product_name as string) : undefined,
      unitsPerBox:
        row.units_per_box !== null ? Number(row.units_per_box) : undefined,
      quantityValue:
        row.quantity_value !== null ? Number(row.quantity_value) : undefined,
      quantityUnit: (row.quantity_unit as 'UN' | 'CX') || undefined,
      discountPct:
        row.discount_pct !== null ? Number(row.discount_pct) : undefined,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at as string,
    };
  }

  close(): void {
    this.db.close();
  }
}
