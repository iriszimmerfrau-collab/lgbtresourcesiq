import { ui, type UiKey } from './ui';
import { defaultLang, type Lang, languages } from './languages';

export function getLangFromUrl(url: URL): Lang {
  const [, lang] = url.pathname.split('/');
  if (lang && lang in languages) return lang as Lang;
  return defaultLang;
}

export function t(lang: Lang, key: UiKey): string {
  return ui[lang]?.[key] ?? ui[defaultLang][key];
}

export function localizedPath(lang: Lang, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `/${lang}${clean}`;
}

export function switchLangPath(currentPath: string): string {
  const segments = currentPath.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  const currentLang = segments[0];
  const otherLang = currentLang === 'ar' ? 'en' : 'ar';
  segments[0] = otherLang;
  return `/${segments.join('/')}`;
}

export function getOtherLang(lang: Lang): Lang {
  return lang === 'ar' ? 'en' : 'ar';
}
