export const languages = { en: 'English', ar: 'العربية', ckb: 'کوردی' } as const;
export type Lang = keyof typeof languages;
export const defaultLang: Lang = 'en';

// All locales that read right-to-left. Sorani (ckb) uses Arabic script
// with extra letters (ێ ۆ ڕ ڤ ڵ ݨ); Noto Naskh Arabic covers them.
const rtlLanguages: Lang[] = ['ar', 'ckb'];

export function isRtl(lang: Lang): boolean {
  return rtlLanguages.includes(lang);
}

/** Locales for Intl.DateTimeFormat / Intl.NumberFormat. */
export const intlLocaleFor: Record<Lang, string> = {
  en: 'en-US',
  ar: 'ar-IQ',
  // Sorani BCP-47 tag; Intl falls back gracefully if not supported on the runtime
  ckb: 'ckb-IQ',
};

/** ISO 639-1/3 + region tags for og:locale and similar. */
export const ogLocaleFor: Record<Lang, string> = {
  en: 'en_US',
  ar: 'ar_IQ',
  ckb: 'ckb_IQ',
};
