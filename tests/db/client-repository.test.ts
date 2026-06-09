import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { ClientRepository } from '../../src/db/client-repository.js';

let dbPath: string;
let repo: ClientRepository;

beforeEach(() => {
  dbPath = join(tmpdir(), `orc-test-clients-${process.pid}-${Date.now()}.db`);
  repo = new ClientRepository(dbPath);
});

afterEach(() => {
  repo.close();
  rmSync(dbPath, { force: true });
});

describe('ClientRepository', () => {
  it('returns undefined for an unknown client alias', () => {
    expect(repo.find('autoamerica', 'Desconhecido')).toBeUndefined();
  });

  it('saves and finds a client alias (normalized lookup)', () => {
    repo.save({
      platform: 'autoamerica',
      aliasRaw: 'Oliveira Oliveira',
      clientCode: 'CLI123',
      clientName: 'OLIVEIRA & OLIVEIRA LTDA',
    });
    const found = repo.find('autoamerica', ' oliveira  oliveira ');
    expect(found?.clientCode).toBe('CLI123');
    expect(found?.clientName).toBe('OLIVEIRA & OLIVEIRA LTDA');
  });

  it('scopes client aliases by platform', () => {
    repo.save({
      platform: 'autoamerica',
      aliasRaw: 'Cliente X',
      clientCode: 'C1',
      clientName: 'EXEMPLO X',
    });
    expect(repo.find('roberlo', 'Cliente X')).toBeUndefined();
  });

  it('upserts on the same platform+alias', () => {
    repo.save({
      platform: 'roberlo',
      aliasRaw: 'Alvo',
      clientCode: 'OLD',
      clientName: 'Antigo',
    });
    repo.save({
      platform: 'roberlo',
      aliasRaw: 'Alvo',
      clientCode: 'NEW',
      clientName: 'Novo',
    });
    expect(repo.find('roberlo', 'Alvo')?.clientCode).toBe('NEW');
  });
});
