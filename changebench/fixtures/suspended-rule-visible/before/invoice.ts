export interface Invoice { total: number; }
export const renderInvoice = (invoice: Invoice) => `${invoice.total}`;
