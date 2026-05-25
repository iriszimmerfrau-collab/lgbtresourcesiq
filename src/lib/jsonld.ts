/**
 * Schema.org JSON-LD builders. Each function returns a JSON-serializable
 * object ready for <script type="application/ld+json"> emission.
 *
 * Builders are pure — no I/O, no DOM, no async. They take collection
 * entries (or plain shape) and a small `ctx` carrying lang + siteUrl,
 * and return one schema object.
 *
 * BaseLayout already injects a global Organization+WebSite graph on every
 * page. These builders produce *page-specific* schemas that supplement
 * the global one (Article, MedicalWebPage, HowTo, BreadcrumbList,
 * LearningResource, FAQPage with Speakable, Person, WebPage).
 */

import type { CollectionEntry } from 'astro:content';
import type { Lang } from '@i18n/languages';

export interface JsonLdContext {
  lang: Lang;
  /** Absolute URL of the current page (canonical) */
  pageUrl: string;
  /** Absolute URL of the site root, ending in `/` */
  siteUrl: string;
  /** Display name of the site in the current language */
  siteName: string;
}

type GuideEntry = CollectionEntry<'guides'>;
type StoryEntry = CollectionEntry<'stories'>;
type NewsEntry = CollectionEntry<'news'>;
type AlertEntry = CollectionEntry<'alerts'>;

const ORG_ID = '#org';
const orgRef = (siteUrl: string) => ({ '@id': `${siteUrl}${ORG_ID}` });

// ---------------------------------------------------------------------------
// Article (used as fallback / supplement to MedicalWebPage and LearningResource)
// ---------------------------------------------------------------------------

export function buildArticleSchema(entry: GuideEntry | NewsEntry, ctx: JsonLdContext) {
  return {
    '@context': 'https://schema.org',
    '@type': entry.collection === 'news' ? 'NewsArticle' : 'Article',
    headline: entry.data.title,
    description: entry.data.description,
    datePublished: entry.data.pubDate.toISOString(),
    ...('updatedDate' in entry.data && entry.data.updatedDate
      ? { dateModified: entry.data.updatedDate.toISOString() }
      : {}),
    inLanguage: ctx.lang,
    author: orgRef(ctx.siteUrl),
    publisher: orgRef(ctx.siteUrl),
    mainEntityOfPage: ctx.pageUrl,
    ...(entry.data.keywords
      ? { keywords: entry.data.keywords.split(',').map((s) => s.trim()).filter(Boolean) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// MedicalWebPage — HRT and mental-health guides
// ---------------------------------------------------------------------------

const HRT_CONDITIONS: Record<string, { name: string; code?: string }> = {
  hrt: { name: 'Gender dysphoria', code: 'F64.0' },
  'mental-health': { name: 'Mental health' },
};

const MEDICAL_SPECIALTIES: Record<string, string> = {
  hrt: 'Endocrinology',
  'mental-health': 'Psychiatry',
};

export function buildMedicalWebPageSchema(entry: GuideEntry, ctx: JsonLdContext) {
  const category = entry.data.category;
  const specialty = MEDICAL_SPECIALTIES[category] ?? 'PublicHealth';
  const condition = HRT_CONDITIONS[category];

  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name: entry.data.title,
    description: entry.data.description,
    inLanguage: ctx.lang,
    url: ctx.pageUrl,
    datePublished: entry.data.pubDate.toISOString(),
    ...(entry.data.updatedDate
      ? {
          dateModified: entry.data.updatedDate.toISOString(),
          lastReviewed: entry.data.updatedDate.toISOString().slice(0, 10),
        }
      : { lastReviewed: entry.data.pubDate.toISOString().slice(0, 10) }),
    author: orgRef(ctx.siteUrl),
    publisher: orgRef(ctx.siteUrl),
    medicalAudience: { '@type': 'MedicalAudience', audienceType: 'Patient' },
    specialty: { '@type': 'MedicalSpecialty', name: specialty },
    ...(condition
      ? { about: { '@type': 'MedicalCondition', name: condition.name, ...(condition.code ? { code: { '@type': 'MedicalCode', code: condition.code, codingSystem: 'ICD-10' } } : {}) } }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// HowTo — pharmacy script guide specifically
// ---------------------------------------------------------------------------

export interface HowToStepInput {
  name: string;
  text: string;
}

export function buildHowToSchema(args: {
  name: string;
  description: string;
  steps: HowToStepInput[];
  ctx: JsonLdContext;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: args.name,
    description: args.description,
    inLanguage: args.ctx.lang,
    totalTime: 'PT15M',
    step: args.steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

// ---------------------------------------------------------------------------
// BreadcrumbList
// ---------------------------------------------------------------------------

export interface BreadcrumbCrumb {
  name: string;
  url: string;
}

export function buildBreadcrumbList(crumbs: BreadcrumbCrumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

// ---------------------------------------------------------------------------
// LearningResource — identity / general guides
// ---------------------------------------------------------------------------

export function buildLearningResourceSchema(entry: GuideEntry, ctx: JsonLdContext) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: entry.data.title,
    description: entry.data.description,
    inLanguage: ctx.lang,
    url: ctx.pageUrl,
    learningResourceType: 'Article',
    educationalLevel: 'beginner',
    teaches: entry.data.title,
    author: orgRef(ctx.siteUrl),
    publisher: orgRef(ctx.siteUrl),
    datePublished: entry.data.pubDate.toISOString(),
    ...(entry.data.updatedDate
      ? { dateModified: entry.data.updatedDate.toISOString() }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// FAQPage with Speakable
// ---------------------------------------------------------------------------

export interface FaqEntry {
  q: string;
  a: string;
}

export function buildFaqPageWithSpeakable(faqs: FaqEntry[], ctx: JsonLdContext) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: ctx.lang,
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['.prose h2', '.prose p'],
    },
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.a.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1'),
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Person (story bylines, anonymous-safe)
// ---------------------------------------------------------------------------

export function buildPersonSchema(story: StoryEntry, ctx: JsonLdContext) {
  const isAnonymous = story.data.anonymous || !story.data.pseudonym;
  const displayName = isAnonymous ? 'Anonymous contributor' : (story.data.pseudonym as string);
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: displayName,
    description: 'Anonymous contributor to Iraqi Social Progress Collective',
    knowsLanguage: ctx.lang,
  };
}

// ---------------------------------------------------------------------------
// NewsArticle for alerts (richer than the existing inline schema)
// ---------------------------------------------------------------------------

export function buildAlertNewsArticleSchema(alert: AlertEntry, ctx: JsonLdContext) {
  const data = alert.data;
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: data.title,
    description: data.description,
    datePublished: data.pubDate.toISOString(),
    inLanguage: ctx.lang,
    author: orgRef(ctx.siteUrl),
    publisher: orgRef(ctx.siteUrl),
    mainEntityOfPage: ctx.pageUrl,
    ...(data.source
      ? { sourceOrganization: { '@type': 'NewsMediaOrganization', name: data.source } }
      : {}),
    ...(data.sourceUrl ? { isBasedOn: data.sourceUrl } : {}),
    ...(data.keywords
      ? { keywords: data.keywords.split(',').map((s) => s.trim()).filter(Boolean) }
      : {}),
    articleSection: data.category,
  };
}

// ---------------------------------------------------------------------------
// WebPage — generic static page (about, safety, community, privacy, feedback)
// ---------------------------------------------------------------------------

export function buildWebPageSchema(args: {
  title: string;
  description: string;
  ctx: JsonLdContext;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: args.title,
    description: args.description,
    inLanguage: args.ctx.lang,
    url: args.ctx.pageUrl,
    isPartOf: { '@id': `${args.ctx.siteUrl}#website` },
    publisher: orgRef(args.ctx.siteUrl),
  };
}

// ---------------------------------------------------------------------------
// @graph wrapper — combine multiple schemas into a single script tag
// ---------------------------------------------------------------------------

export function combineSchemas(...schemas: Array<Record<string, unknown> | null | undefined>) {
  const cleaned = schemas.filter((s): s is Record<string, unknown> => !!s);
  if (cleaned.length === 1) return cleaned[0];
  return {
    '@context': 'https://schema.org',
    '@graph': cleaned.map((s) => {
      // Strip @context from each entry since the wrapper supplies it
      const { '@context': _ctx, ...rest } = s as Record<string, unknown>;
      return rest;
    }),
  };
}
