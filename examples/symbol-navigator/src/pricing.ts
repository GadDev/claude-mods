export interface CartLine {
  sku: string;
  quantity: number;
  unitPrice: number;
}

// The demo task: understand where checkout prices use this discount.
export function quoteTotal(lines: readonly CartLine[], discount = 0): number {
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return Math.round(subtotal * (1 - discount) * 100) / 100;
}
