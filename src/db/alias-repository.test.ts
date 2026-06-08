import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { AliasRepository } from './alias-repository.js';

let dbPath: string;
let repo: AliasRepository;

beforeEach(() => {
  dbPath = join(tmpdir(), `orc-test-${process.pid}-${Date.now()}.db`);
  repo = new AliasRepository(dbPath);
});

afterEach(() => {
  repo.close();
  rmSync(dbPath, { force: true });
});

describe('AliasRepository', () => {
  it('returns undefined for an unknown alias', () => {
    expect(repo.find('autoamerica', 'Produto A')).toBeUndefined();
  });

  it('saves and finds an alias (normalized lookup)', () => {
    repo.save({
      platform: 'autoamerica',
      aliases: ['Produto A'],
      productCode: '303535001',
      productName: 'BRILHO RAP S/SIL MOTHERS 473ML',
      unitsPerBox: 6,
    });
    const found = repo.find('autoamerica', '  produto   a ');
    expect(found?.productCode).toBe('303535001');
    expect(found?.unitsPerBox).toBe(6);
  });

  it('saves multiple aliases for the same product', () => {
    repo.save({
      platform: 'autoamerica',
      aliases: ['Brilho Rápido', 'brilho mothers', 'mothers brilho'],
      productCode: '303535001',
      productName: 'BRILHO RAP S/SIL MOTHERS 473ML',
      unitsPerBox: 6,
    });
    expect(repo.find('autoamerica', 'Brilho Rapido')?.productCode).toBe('303535001');
    expect(repo.find('autoamerica', 'brilho mothers')?.productCode).toBe('303535001');
    expect(repo.find('autoamerica', 'mothers brilho')?.productCode).toBe('303535001');
  });

  it('scopes aliases by platform', () => {
    repo.save({ platform: 'autoamerica', aliases: ['X'], productCode: '1', productName: 'n', unitsPerBox: 2 });
    expect(repo.find('roberlo', 'X')).toBeUndefined();
  });

  it('upserts on the same platform+alias', () => {
    repo.save({ platform: 'roberlo', aliases: ['Y'], productCode: '1', productName: 'a', unitsPerBox: 2 });
    repo.save({ platform: 'roberlo', aliases: ['Y'], productCode: '2', productName: 'b', unitsPerBox: 4 });
    expect(repo.find('roberlo', 'Y')?.productCode).toBe('2');
  });
});
