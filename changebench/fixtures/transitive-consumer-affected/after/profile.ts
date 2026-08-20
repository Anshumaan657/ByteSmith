import { loadUser } from "./user.js";
export const getProfile = (id: string): string => loadUser(id).name;
