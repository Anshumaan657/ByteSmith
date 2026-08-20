import { getProduct } from "@domain/product";
export const renderProduct = (id: string): string => String(getProduct(id).price);
