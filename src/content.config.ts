import { z, defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

const guides = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    lang: z.enum(['en', 'ar', 'ckb']),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.enum(['hrt', 'mental-health', 'safety', 'general', 'identity']),
    order: z.number().optional(),
    parentGuide: z.string().optional(),
    /** Sibling guide slugs to surface as "See also" links in the article footer. */
    relatedGuides: z.array(z.string()).optional(),
    keywords: z.string().optional(),
    draft: z.boolean().default(false),
    /**
     * Translation provenance. `native` hides the machine-translation
     * banner on CKB pages; any other value (or unset on a CKB page)
     * shows the banner naming the AR canonical.
     */
    translationStatus: z.enum(['native', 'machine-pending-review', 'machine-reviewed']).optional(),
    /**
     * Front-loaded answer paragraph rendered at the top of the article inside
     * an AnswerSummary block. Drives Speakable schema + AI answer-engine
     * extraction: AEO winners consistently lead with the answer in 1-3 plain
     * sentences before the article unfolds. Keep under ~280 characters.
     */
    tldr: z.string().optional(),
    /**
     * Per-guide Q&A pairs rendered as a "Common questions" accordion at the
     * bottom of the article AND emitted as a FAQPage schema. AEO winner —
     * AI engines extract these for "people also ask" / related-query answers.
     * Keep questions to the genuine reader queries this page already answers.
     */
    commonQuestions: z.array(z.object({
      q: z.string(),
      a: z.string(),
    })).optional(),
    /**
     * Structured source bibliography rendered at the bottom of the article
     * AND emitted as a `citation` array in JSON-LD. Each entry should be
     * something a reader (or AI engine) could actually look up.
     */
    citations: z.array(z.object({
      title: z.string(),
      org: z.string().optional(),
      url: z.string().url().optional(),
      year: z.number().optional(),
    })).optional(),
  }),
});

const stories = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/stories' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    lang: z.enum(['en', 'ar', 'ckb']),
    pubDate: z.coerce.date(),
    contentWarning: z.string().optional(),
    anonymous: z.boolean().default(true),
    pseudonym: z.string().optional(),
    keywords: z.string().optional(),
    draft: z.boolean().default(false),
    translationStatus: z.enum(['native', 'machine-pending-review', 'machine-reviewed']).optional(),
    /**
     * Front-loaded answer paragraph rendered at the top of the article inside
     * an AnswerSummary block. Drives Speakable schema + AI answer-engine
     * extraction: AEO winners consistently lead with the answer in 1-3 plain
     * sentences before the article unfolds. Keep under ~280 characters.
     */
    tldr: z.string().optional(),
    /**
     * Per-guide Q&A pairs rendered as a "Common questions" accordion at the
     * bottom of the article AND emitted as a FAQPage schema. AEO winner —
     * AI engines extract these for "people also ask" / related-query answers.
     * Keep questions to the genuine reader queries this page already answers.
     */
    commonQuestions: z.array(z.object({
      q: z.string(),
      a: z.string(),
    })).optional(),
    /**
     * Structured source bibliography rendered at the bottom of the article
     * AND emitted as a `citation` array in JSON-LD. Each entry should be
     * something a reader (or AI engine) could actually look up.
     */
    citations: z.array(z.object({
      title: z.string(),
      org: z.string().optional(),
      url: z.string().url().optional(),
      year: z.number().optional(),
    })).optional(),
  }),
});

const news = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    lang: z.enum(['en', 'ar', 'ckb']),
    pubDate: z.coerce.date(),
    source: z.string().optional(),
    sourceUrl: z.string().url().optional(),
    keywords: z.string().optional(),
    draft: z.boolean().default(false),
    translationStatus: z.enum(['native', 'machine-pending-review', 'machine-reviewed']).optional(),
    /**
     * Front-loaded answer paragraph rendered at the top of the article inside
     * an AnswerSummary block. Drives Speakable schema + AI answer-engine
     * extraction: AEO winners consistently lead with the answer in 1-3 plain
     * sentences before the article unfolds. Keep under ~280 characters.
     */
    tldr: z.string().optional(),
    /**
     * Per-guide Q&A pairs rendered as a "Common questions" accordion at the
     * bottom of the article AND emitted as a FAQPage schema. AEO winner —
     * AI engines extract these for "people also ask" / related-query answers.
     * Keep questions to the genuine reader queries this page already answers.
     */
    commonQuestions: z.array(z.object({
      q: z.string(),
      a: z.string(),
    })).optional(),
    /**
     * Structured source bibliography rendered at the bottom of the article
     * AND emitted as a `citation` array in JSON-LD. Each entry should be
     * something a reader (or AI engine) could actually look up.
     */
    citations: z.array(z.object({
      title: z.string(),
      org: z.string().optional(),
      url: z.string().url().optional(),
      year: z.number().optional(),
    })).optional(),
  }),
});

const alerts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/alerts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    lang: z.enum(['en', 'ar', 'ckb']),
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
    translationStatus: z.enum(['native', 'machine-pending-review', 'machine-reviewed']).optional(),
    /**
     * Front-loaded answer paragraph rendered at the top of the article inside
     * an AnswerSummary block. Drives Speakable schema + AI answer-engine
     * extraction: AEO winners consistently lead with the answer in 1-3 plain
     * sentences before the article unfolds. Keep under ~280 characters.
     */
    tldr: z.string().optional(),
    /**
     * Per-guide Q&A pairs rendered as a "Common questions" accordion at the
     * bottom of the article AND emitted as a FAQPage schema. AEO winner —
     * AI engines extract these for "people also ask" / related-query answers.
     * Keep questions to the genuine reader queries this page already answers.
     */
    commonQuestions: z.array(z.object({
      q: z.string(),
      a: z.string(),
    })).optional(),
    /**
     * Structured source bibliography rendered at the bottom of the article
     * AND emitted as a `citation` array in JSON-LD. Each entry should be
     * something a reader (or AI engine) could actually look up.
     */
    citations: z.array(z.object({
      title: z.string(),
      org: z.string().optional(),
      url: z.string().url().optional(),
      year: z.number().optional(),
    })).optional(),
  }),
});

export const collections = { guides, stories, news, alerts };
