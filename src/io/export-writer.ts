import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { Platform } from '../platforms/types.js';

export interface ExportWriterInput {
  platform: Platform;
  /** Nome do cliente vindo do portal (coluna "Nome" da listagem). */
  clientName: string;
  /** Optional label for the source order file or array item, used to derive a stable export filename. */
  label?: string;
  pdfBase64: string;
}

export type ExportWriter = (input: ExportWriterInput) => Promise<string>;

/** Remove caracteres inválidos de nome de arquivo; volta para "orcamento" se vazio. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'orcamento';
}

/**
 * Cria um writer que grava o PDF em `<baseDir>/<platform>/<cliente>.pdf`.
 * baseDir default: env ORCAMENTO_EXPORT_DIR ou "public/orcamentos".
 */
export function makeExportWriter(
  baseDir: string = process.env.ORCAMENTO_EXPORT_DIR ?? 'public/orcamentos',
): ExportWriter {
  return async ({ platform, clientName, label, pdfBase64 }) => {
    const fileBaseName = clientName.trim()
      ? sanitizeFileName(clientName)
      : label
        ? sanitizeFileName(basename(label))
        : 'orcamento';
    const filePath = resolve(baseDir, platform, `${fileBaseName}.pdf`);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(pdfBase64, 'base64'));
    return filePath;
  };
}
