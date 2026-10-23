import { calculateTotal as priceCart } from '@demo/index';
import type { CartLine } from '@demo/index';

const cart: CartLine[] = [{ sku: 'notebook', quantity: 2, unitPrice: 12.5 }];

// Enough static identifier references to exercise the second reference page.
export const checkoutQuotes = {
  standard: priceCart(cart),
  member: priceCart(cart, 0.05),
  student: priceCart(cart, 0.1),
  launch: priceCart(cart, 0.15),
  partner: priceCart(cart, 0.2),
  bulk: priceCart(cart, 0.25),
  loyalty: priceCart(cart, 0.3),
  clearance: priceCart(cart, 0.35),
  staff: priceCart(cart, 0.4),
  community: priceCart(cart, 0.45),
};
