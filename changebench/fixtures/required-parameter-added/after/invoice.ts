export function createInvoice(customerId: string, currency: string): string {
  return `invoice:${customerId}:${currency}`;
}
