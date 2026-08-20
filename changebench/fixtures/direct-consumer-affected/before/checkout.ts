import { calculateTax } from "./tax.js";
export const checkoutTotal = (amount: number): number => amount + calculateTax(amount, 0.18);
