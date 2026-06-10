import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  makeExportWriter,
  sanitizeFileName,
} from '../../src/io/export-writer.js';

describe('sanitizeFileName', () => {
  it('replaces invalid filesystem characters and trims', () => {
    expect(sanitizeFileName('ACME / LTDA: "X"')).toBe('ACME LTDA X');
  });
  it('falls back to "orcamento" when the name is empty after sanitizing', () => {
    expect(sanitizeFileName('   ')).toBe('orcamento');
  });
});

describe('makeExportWriter', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'export-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the decoded PDF to <baseDir>/<platform>/<client>.pdf', async () => {
    const writer = makeExportWriter(dir);
    const pdfBase64 = Buffer.from('%PDF-1.4 fake').toString('base64');
    const path = await writer({
      platform: 'autoamerica',
      clientName: 'ZIKALIMP LTDA',
      pdfBase64,
    });

    expect(path).toBe(join(dir, 'autoamerica', 'ZIKALIMP LTDA.pdf'));
    const written = await readFile(path);
    expect(written.toString()).toBe('%PDF-1.4 fake');
  });

  it('uses the provider folder per platform', async () => {
    const writer = makeExportWriter(dir);
    const pdfBase64 = Buffer.from('x').toString('base64');
    const path = await writer({
      platform: 'roberlo',
      clientName: 'CASA DO CARRO',
      pdfBase64,
    });
    expect(path).toBe(join(dir, 'roberlo', 'CASA DO CARRO.pdf'));
  });

  it('uses the client name even when a source label is provided', async () => {
    const writer = makeExportWriter(dir);
    const pdfBase64 = Buffer.from('x').toString('base64');
    const path = await writer({
      platform: 'autoamerica',
      clientName: 'CLIENTE STUB',
      label: './pedido.example.json[0]',
      pdfBase64,
    });
    expect(path).toBe(join(dir, 'autoamerica', 'CLIENTE STUB.pdf'));
  });

  it('falls back to the source label only when clientName is empty', async () => {
    const writer = makeExportWriter(dir);
    const pdfBase64 = Buffer.from('x').toString('base64');
    const path = await writer({
      platform: 'autoamerica',
      clientName: '   ',
      label: './pedido.example.json[0]',
      pdfBase64,
    });
    expect(path).toBe(join(dir, 'autoamerica', 'pedido.example.json[0].pdf'));
  });
});
