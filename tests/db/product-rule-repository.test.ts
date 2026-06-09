import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  ProductRuleRepository,
  type CreateProductRuleInput,
} from '../../src/db/product-rule-repository.js';

let dbPath: string;
let repo: ProductRuleRepository | undefined;

beforeEach(() => {
  dbPath = join(tmpdir(), `rule-test-${process.pid}-${Date.now()}.db`);
  repo = new ProductRuleRepository(dbPath);
});

afterEach(() => {
  repo?.close();
  repo = undefined;
  rmSync(dbPath, { force: true });
});

describe('ProductRuleRepository', () => {
  it('returns empty list for a provider with no rules', () => {
    expect(repo.listByProvider('autoamerica')).toEqual([]);
  });

  it('saves and lists rules for a provider', () => {
    const rule: CreateProductRuleInput = {
      provider: 'autoamerica',
      type: 'add-product',
      productCode: '123',
      quantityValue: 1,
      quantityUnit: 'CX',
    };
    repo.save(rule);

    const rules = repo.listByProvider('autoamerica');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.productCode).toBe('123');
    expect(rules[0]?.type).toBe('add-product');
    expect(rules[0]?.enabled).toBe(true);
  });

  it('upserts rules based on provider, type, productCode and quantityValue', () => {
    repo.save({
      provider: 'autoamerica',
      type: 'add-product',
      productCode: '123',
      quantityValue: 1,
      quantityUnit: 'CX',
    });

    repo.save({
      provider: 'autoamerica',
      type: 'add-product',
      productCode: '123',
      quantityValue: 1, // Same quantityValue should upsert
      quantityUnit: 'UN',
    });

    const rules = repo.listByProvider('autoamerica');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.quantityUnit).toBe('UN');

    // Different quantityValue should result in a different row
    repo.save({
      provider: 'autoamerica',
      type: 'threshold-discount',
      productCode: '*',
      quantityValue: 10,
      discountPct: 15,
    });
    repo.save({
      provider: 'autoamerica',
      type: 'threshold-discount',
      productCode: '*',
      quantityValue: 20,
      discountPct: 25,
    });
    expect(repo.listByProvider('autoamerica')).toHaveLength(3);
  });

  it('filters rules by provider', () => {
    repo.save({
      provider: 'autoamerica',
      type: 'add-product',
      productCode: 'A',
      quantityValue: 1,
      quantityUnit: 'UN',
    });
    repo.save({
      provider: 'roberlo',
      type: 'add-product',
      productCode: 'B',
      quantityValue: 1,
      quantityUnit: 'UN',
    });

    expect(repo.listByProvider('autoamerica')).toHaveLength(1);
    expect(repo.listByProvider('autoamerica')[0]?.productCode).toBe('A');
    expect(repo.listByProvider('roberlo')).toHaveLength(1);
    expect(repo.listByProvider('roberlo')[0]?.productCode).toBe('B');
  });

  it('preserves data across repository re-instantiation (no destructive drop)', () => {
    repo!.save({
      provider: 'autoamerica',
      type: 'threshold-discount',
      productCode: '*',
      quantityValue: 10,
      discountPct: 15,
    });
    repo!.close();
    repo = undefined; // Avoid afterEach trying to close it again

    // Re-open same DB
    const newRepo = new ProductRuleRepository(dbPath);
    const rules = newRepo.listByProvider('autoamerica');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.quantityValue).toBe(10);
    newRepo.close();
  });

  it('upserts override-discount rules correctly (NULL quantity deduplication)', () => {
    repo!.save({
      provider: 'autoamerica',
      type: 'override-discount',
      productCode: 'ABC',
      discountPct: 5,
    });

    repo!.save({
      provider: 'autoamerica',
      type: 'override-discount',
      productCode: 'ABC',
      discountPct: 10, // Should update
    });

    const rules = repo!.listByProvider('autoamerica');
    const overrides = rules.filter((r) => r.productCode === 'ABC');
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.discountPct).toBe(10);
  });

  it('deletes a rule by id', () => {
    repo.save({
      provider: 'autoamerica',
      type: 'add-product',
      productCode: '123',
      quantityValue: 1,
      quantityUnit: 'UN',
    });
    const rule = repo.listByProvider('autoamerica')[0];
    if (!rule) throw new Error('Rule not found');

    repo.delete(rule.id);
    expect(repo.listByProvider('autoamerica')).toHaveLength(0);
  });

  it('toggles enabled status', () => {
    repo.save({
      provider: 'autoamerica',
      type: 'add-product',
      productCode: '123',
      quantityValue: 1,
      quantityUnit: 'UN',
    });
    const rule = repo.listByProvider('autoamerica')[0];
    if (!rule) throw new Error('Rule not found');
    expect(rule.enabled).toBe(true);

    repo.setEnabled(rule.id, false);
    expect(repo.listByProvider('autoamerica')[0]?.enabled).toBe(false);
  });
});
