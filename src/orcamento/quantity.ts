import type { ParsedQuantity } from './order.js';

/** Converts an order quantity to the number of UNITS the site expects.
 *  CX -> value * unitsPerBox; UN -> value; not informed -> one box. */
export function toSiteUnits(qty: ParsedQuantity | undefined, unitsPerBox: number): number {
  if (qty == null) return unitsPerBox;
  return qty.unit === 'UN' ? qty.value : qty.value * unitsPerBox;
}
