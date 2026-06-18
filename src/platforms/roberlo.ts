import type { PlatformConfig } from './types.js';

export const roberlo: PlatformConfig = {
  id: 'roberlo',
  url: process.env.ROBERLO_URL ?? '',
  tipoOrcamento: 'Previsto',
  transportadora: '000293',
  frete: 'CIF',
  minOrderValue: 5000,
  computeLineDiscount(): number {
    return 0; // discount read from portal by the driver (Desconto 02 -> 03)
  },
  computeParcelas() {
    return { label: '30/60/90' };
  },
};
