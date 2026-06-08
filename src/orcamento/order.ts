import { z } from 'zod';

export type Unit = 'UN' | 'CX';
export interface ParsedQuantity { value: number; unit: Unit; }
export interface OrderLine { name: string; quantity: ParsedQuantity | undefined; }
export interface Order { client: string; produtos: OrderLine[]; }

const QTY_RE = /^(\d+(?:[.,]\d+)?)\s*(UN|CX)?$/i;

export function parseQuantity(raw: string | undefined): ParsedQuantity | undefined {
  if (raw == null) return undefined;
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s === '') return undefined;
  const m = QTY_RE.exec(s);
  if (!m) throw new Error(`Quantidade inválida: "${raw}"`);
  const value = Number(m[1]!.replace(',', '.'));
  const unit = ((m[2]?.toUpperCase() as Unit) ?? 'CX');
  return { value, unit };
}

const rawOrderSchema = z.object({
  client: z.string().min(1),
  produtos: z.array(z.object({
    name: z.string().min(1),
    quantity: z.string().optional(),
  })),
});

export function parseOrder(input: unknown): Order {
  const raw = rawOrderSchema.parse(input);
  return {
    client: raw.client,
    produtos: raw.produtos.map((p) => ({
      name: p.name,
      quantity: parseQuantity(p.quantity),
    })),
  };
}
