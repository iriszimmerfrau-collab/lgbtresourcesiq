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

export function switchLangPath(currentPath: string): string {
  const stripped = currentPath.startsWith(BASE) ? currentPath.slice(BASE.length) : currentPath;
  const segments = stripped.split('/').filter(Boolean);
  if (segments.length === 0) return BASE || '/';
  const currentLang = segments[0];
  const otherLang = currentLang === 'ar' ? 'en' : 'ar';
  segments[0] = otherLang;
  return `${BASE}/${segments.join('/')}`;
}

export function getOtherLang(lang: Lang): Lang {
  return lang === 'ar' ? 'en' : 'ar';
}
