export const loadHandler = async (name: string): Promise<unknown> => import(`./${name}.js`);
