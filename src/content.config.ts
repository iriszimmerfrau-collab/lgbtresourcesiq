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
    /** Sibling guide slugs to surface as "See also" links in the article footer. */
    relatedGuides: z.array(z.string()).optional(),
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

const alerts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/alerts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    lang: z.enum(['en', 'ar']),
    pubDate: z.coerce.date(),
    /** Severity drives styling (red/orange/yellow/blue accents) */
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
    /** Topic for filtering and routing */
    category: z.enum(['legal', 'violence', 'surveillance', 'border', 'community', 'news', 'asylum']),
    /** Original news source name, e.g. "Reuters" */
    source: z.string().optional(),
    /** URL of the original article */
    sourceUrl: z.string().url().optional(),
    /** Geographic / demographic scope, e.g. "Baghdad", "Iraqi Kurdistan", "trans women" */
    affected: z.string().optional(),
    keywords: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { guides, stories, news, alerts };
