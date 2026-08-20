export function createInvoice(customerId: string): string {
  return `invoice:${customerId}`;
}
