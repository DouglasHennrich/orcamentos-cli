import type { PlatformConfig } from './types.js';

export const autoamerica: PlatformConfig = {
  id: 'autoamerica',
  url: process.env.AUTOAMERICA_URL ?? '',
  tipoOrcamento: 'Em elaboração',
  tabelaPrecos: '099 - POLIMENTO C5_12% SP-RS-MG-RJ',
  transportadora: 'EXPRESSO SAO MIGUEL LTDA',
  frete: 'CIF',
  minOrderValue: 2500,
  computeLineDiscount(boxes: number): number {
    return boxes > 10 ? 15 : 0;
  },
  computeParcelas(total: number) {
    return { label: total < 5000 ? '30/60' : '30/60/90' };
  },
};
