import { ui, type UiKey } from './ui';
import { defaultLang, type Lang, languages } from './languages';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export function getLangFromUrl(url: URL): Lang {
  const stripped = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname;
  const [, lang] = stripped.split('/');
  if (lang && lang in languages) return lang as Lang;
  return defaultLang;
}

export function t(lang: Lang, key: UiKey): string {
  return ui[lang]?.[key] ?? ui[defaultLang][key];
}

export function localizedPath(lang: Lang, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}/${lang}${clean}`;
}

/**
 * Swap the leading locale segment of a path to the given target language.
 * Always pass an explicit target now that we have three languages — the
 * old binary toggle is gone.
 */
export function switchLangPath(currentPath: string, targetLang: Lang): string {
  const stripped = currentPath.startsWith(BASE) ? currentPath.slice(BASE.length) : currentPath;
  const segments = stripped.split('/').filter(Boolean);
  if (segments.length === 0) return `${BASE}/${targetLang}/`;
  segments[0] = targetLang;
  return `${BASE}/${segments.join('/')}`;
}

/**
 * The full list of other-than-current languages, in display order.
 * Used by the language switcher to render two destination links.
 */
export function getOtherLangs(lang: Lang): Lang[] {
  return (Object.keys(languages) as Lang[]).filter((l) => l !== lang);
}

/**
 * Deprecated convenience kept for any caller that still expects a single
 * "other" language. Returns the first non-current language.
 */
export function getOtherLang(lang: Lang): Lang {
  return getOtherLangs(lang)[0];
}
