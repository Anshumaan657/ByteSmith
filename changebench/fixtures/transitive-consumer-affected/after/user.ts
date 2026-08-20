export const loadUser = (id: string): Promise<{ id: string; name: string }> =>
  Promise.resolve({ id, name: "Ada" });
