import { getCollection, type CollectionEntry } from 'astro:content';
import type { Lang } from '@i18n/languages';

export async function getCollectionByLang<T extends 'guides' | 'stories' | 'news' | 'alerts'>(
  collection: T,
  lang: Lang,
): Promise<CollectionEntry<T>[]> {
  return await getCollection(collection, (entry) => {
    return entry.data.lang === lang && !entry.data.draft;
  });
}

export async function getGuidesByParent(lang: Lang, parentGuide: string) {
  const guides = await getCollectionByLang('guides', lang);
  return guides
    .filter((g) => g.data.parentGuide === parentGuide)
    .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0));
}

export function getSlugFromId(id: string): string {
  const parts = id.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.(md|mdx)$/, '');
}

export function estimateReadingTime(content: string): number {
  const words = content.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}
