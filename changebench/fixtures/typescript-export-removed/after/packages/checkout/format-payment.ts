import type { PaymentResponse } from "../../contracts/payment";

export function formatPayment(payment: PaymentResponse): string {
  return `${payment.amount} ${payment.currency}`;
}
