export function createInvoice(customerId: string, currency?: string): string {
  return currency ? `invoice:${customerId}:${currency}` : `invoice:${customerId}`;
}
