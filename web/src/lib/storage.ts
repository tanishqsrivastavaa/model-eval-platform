/** Safe localStorage get/set — port of static/app.js:39-42. Never throws. */

export function storageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export function storageSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
}

export const PROVIDER_KEY = 'provider';
export const modelKey = (provider: string): string => `model:${provider}`;

export const getProvider = (): string | null => storageGet(PROVIDER_KEY);
export const setProvider = (id: string): void => storageSet(PROVIDER_KEY, id);
export const getModel = (provider: string): string | null => storageGet(modelKey(provider));
export const setModel = (provider: string, model: string): void =>
  storageSet(modelKey(provider), model);
