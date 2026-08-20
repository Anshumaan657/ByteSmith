import { getProfile } from "./profile.js";
export const renderProfile = (id: string): string => `<h1>${getProfile(id)}</h1>`;
