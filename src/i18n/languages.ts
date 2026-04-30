export const languages = { en: 'English', ar: 'العربية' } as const;
export type Lang = keyof typeof languages;
export const defaultLang: Lang = 'en';

const rtlLanguages: Lang[] = ['ar'];

export function isRtl(lang: Lang): boolean {
  return rtlLanguages.includes(lang);
}
