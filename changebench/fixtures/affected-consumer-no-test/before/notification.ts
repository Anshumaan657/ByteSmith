import { sendEmail } from "./email.js";
export const notifyCustomer = (address: string): void => sendEmail(address, "Order ready");
