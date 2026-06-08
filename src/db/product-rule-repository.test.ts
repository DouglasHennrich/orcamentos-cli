import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  ProductRuleRepository,
  type CreateProductRuleInput,
} from './product-rule-repository.js';

let dbPath: string;
let repo: ProductRuleRepository;

beforeEach(() => {
  dbPath = join(tmpdir(), `rule-test-${process.pid}-${Date.now()}.db`);
  repo = new ProductRuleRepository(dbPath);
});

afterEach(() => {
  repo.close();
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

  it('upserts rules based on provider, type and productCode', () => {
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
      quantityValue: 2,
      quantityUnit: 'UN',
    });

    const rules = repo.listByProvider('autoamerica');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.quantityValue).toBe(2);
    expect(rules[0]?.quantityUnit).toBe('UN');
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
