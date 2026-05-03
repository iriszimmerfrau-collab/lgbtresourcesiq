import { z, defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

const guides = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    lang: z.enum(['en', 'ar']),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.enum(['hrt', 'mental-health', 'safety', 'general', 'identity']),
    order: z.number().optional(),
    parentGuide: z.string().optional(),
    keywords: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const stories = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/stories' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    lang: z.enum(['en', 'ar']),
    pubDate: z.coerce.date(),
    contentWarning: z.string().optional(),
    anonymous: z.boolean().default(true),
    pseudonym: z.string().optional(),
    keywords: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const news = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    lang: z.enum(['en', 'ar']),
    pubDate: z.coerce.date(),
    source: z.string().optional(),
    sourceUrl: z.string().url().optional(),
    keywords: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { guides, stories, news };
