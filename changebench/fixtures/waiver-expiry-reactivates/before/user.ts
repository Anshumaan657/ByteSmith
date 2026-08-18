export interface User { email: string; }
export const sendReceipt = (user: User) => user.email;
