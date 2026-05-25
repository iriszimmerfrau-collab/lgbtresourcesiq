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
 *
 * GEO / AEO design notes:
 *   - We attach `about` and `mentions` arrays referencing Wikidata IDs so
 *     AI answer engines can disambiguate the entities we cover (Iraq,
 *     estradiol, gender dysphoria, etc.) without inferring them from the
 *     prose. Schema.org accepts arbitrary URLs in these fields; Wikidata
 *     IDs are the de-facto canonical entity URIs.
 *   - Medical pages carry `lastReviewed`, `reviewedBy`, and an explicit
 *     `audience` so YMYL trust signals are unambiguous.
 *   - Article schemas include `wordCount` and `timeRequired` (ISO 8601)
 *     which Google + Perplexity both surface as snippet hints.
 *   - Every page-level schema sets `isAccessibleForFree: true` so AI
 *     engines and aggregators don't gate citations behind a paywall
 *     heuristic.
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
// Wikidata entity catalogue — used for `about` / `mentions` disambiguation
// ---------------------------------------------------------------------------

/**
 * Canonical Wikidata IDs for the entities ISPC content covers. When we add a
 * page about a new entity (a medication, a condition, a place, a law), add it
 * here with `Q` ID and a stable display name — then reference by key from the
 * route templates. Centralizing prevents drift.
 */
export const ENTITIES = {
  iraq: { name: 'Iraq', wikidata: 'Q796' },
  iraqiKurdistan: { name: 'Iraqi Kurdistan', wikidata: 'Q205047' },
  baghdad: { name: 'Baghdad', wikidata: 'Q1530' },
  // Medical conditions
  genderDysphoria: { name: 'Gender dysphoria', wikidata: 'Q1077216', icd10: 'F64.0' },
  genderIdentity: { name: 'Gender identity', wikidata: 'Q48270' },
  transgender: { name: 'Transgender', wikidata: 'Q189125' },
  depression: { name: 'Major depressive disorder', wikidata: 'Q131749', icd10: 'F32' },
  anxiety: { name: 'Anxiety disorder', wikidata: 'Q175854', icd10: 'F41' },
  // Therapy / medication
  hrt: { name: 'Hormone replacement therapy', wikidata: 'Q1659125' },
  estradiol: { name: 'Estradiol', wikidata: 'Q422235' },
  cyproteroneAcetate: { name: 'Cyproterone acetate', wikidata: 'Q422232' },
  bicalutamide: { name: 'Bicalutamide', wikidata: 'Q422267' },
  spironolactone: { name: 'Spironolactone', wikidata: 'Q422259' },
  testosterone: { name: 'Testosterone', wikidata: 'Q1318' },
  finasteride: { name: 'Finasteride', wikidata: 'Q420932' },
  // Legal / social context
  lgbtRightsIraq: { name: 'LGBT rights in Iraq', wikidata: 'Q6457268' },
  honorKilling: { name: 'Honor killing', wikidata: 'Q860736' },
  asylumSeeker: { name: 'Asylum seeker', wikidata: 'Q1191213' },
} as const;

export type EntityKey = keyof typeof ENTITIES;

/**
 * Build the Thing reference object Schema.org accepts in `about` / `mentions`.
 * Returns a richer DefinedTerm when an ICD-10 code is present (for medical
 * conditions), otherwise a plain Thing+sameAs+identifier triple.
 */
export function entityRef(key: EntityKey) {
  const e = ENTITIES[key];
  const wd = `https://www.wikidata.org/wiki/${e.wikidata}`;
  if ('icd10' in e && e.icd10) {
    return {
      '@type': 'MedicalCondition',
      name: e.name,
      sameAs: wd,
      identifier: e.wikidata,
      code: {
        '@type': 'MedicalCode',
        code: e.icd10,
        codingSystem: 'ICD-10',
      },
    };
  }
  return {
    '@type': 'Thing',
    name: e.name,
    sameAs: wd,
    identifier: e.wikidata,
  };
}

export function entityRefs(keys: readonly EntityKey[]) {
  return keys.map(entityRef);
}

// ---------------------------------------------------------------------------
// Audience helpers — explicit YMYL signal for queer Iraqi audience
// ---------------------------------------------------------------------------

const QUEER_IRAQI_AUDIENCE = {
  '@type': 'PeopleAudience',
  audienceType: 'LGBTQ+ people living in Iraq, Iraqi Kurdistan, or the Iraqi diaspora',
  geographicArea: {
    '@type': 'Country',
    name: 'Iraq',
    sameAs: 'https://www.wikidata.org/wiki/Q796',
  },
};

const MEDICAL_AUDIENCE_PATIENT = {
  '@type': 'MedicalAudience',
  audienceType: 'Patient',
  geographicArea: { '@type': 'Country', name: 'Iraq' },
};

// ---------------------------------------------------------------------------
// Word-count / reading-time helpers
// ---------------------------------------------------------------------------

export function estimateWordCount(body: string | undefined): number {
  if (!body) return 0;
  // Cheap whitespace split — accurate enough for schema; Arabic/Sorani
  // word counts come out a little low vs CJK-style counters, which is fine
  // since the schema is a hint, not a contract.
  return body.split(/\s+/).filter(Boolean).length;
}

export function isoMinutes(minutes: number): string {
  // ISO 8601 duration; schema.org wants PT prefix
  return `PT${Math.max(1, Math.round(minutes))}M`;
}

// ---------------------------------------------------------------------------
// Article (used as fallback / supplement to MedicalWebPage and LearningResource)
// ---------------------------------------------------------------------------

export interface ArticleEnrichment {
  /** Wikidata-backed entity refs for `about` (page's primary subject). */
  about?: readonly EntityKey[];
  /** Wikidata-backed entity refs for `mentions` (referenced but not primary). */
  mentions?: readonly EntityKey[];
  /** Pre-computed word count of the article body. */
  wordCount?: number;
  /** Reading time in minutes (drives `timeRequired`). */
  readingTime?: number;
  /** Frontmatter citations → schema `citation` array. */
  citations?: CitationInput[];
}

export function buildArticleSchema(
  entry: GuideEntry | NewsEntry,
  ctx: JsonLdContext,
  enrich: ArticleEnrichment = {},
) {
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
    isAccessibleForFree: true,
    author: orgRef(ctx.siteUrl),
    publisher: orgRef(ctx.siteUrl),
    mainEntityOfPage: ctx.pageUrl,
    audience: QUEER_IRAQI_AUDIENCE,
    ...(enrich.about?.length ? { about: entityRefs(enrich.about) } : {}),
    ...(enrich.mentions?.length ? { mentions: entityRefs(enrich.mentions) } : {}),
    ...(enrich.wordCount ? { wordCount: enrich.wordCount } : {}),
    ...(enrich.readingTime ? { timeRequired: isoMinutes(enrich.readingTime) } : {}),
    ...(buildCitationRefs(enrich.citations) ? { citation: buildCitationRefs(enrich.citations) } : {}),
    ...(entry.data.keywords
      ? { keywords: entry.data.keywords.split(',').map((s) => s.trim()).filter(Boolean) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// MedicalWebPage — HRT and mental-health guides
// ---------------------------------------------------------------------------

const MEDICAL_SPECIALTIES: Record<string, string> = {
  hrt: 'Endocrinology',
  'mental-health': 'Psychiatry',
};

export function buildMedicalWebPageSchema(
  entry: GuideEntry,
  ctx: JsonLdContext,
  enrich: ArticleEnrichment = {},
) {
  const category = entry.data.category;
  const specialty = MEDICAL_SPECIALTIES[category] ?? 'PublicHealth';
  const reviewedAt = (entry.data.updatedDate ?? entry.data.pubDate).toISOString().slice(0, 10);

  // Default `about` for HRT and mental-health pages if caller doesn't supply one
  const defaultAbout: readonly EntityKey[] =
    category === 'hrt' ? ['hrt', 'genderDysphoria'] : category === 'mental-health' ? ['depression', 'anxiety'] : [];
  const aboutKeys = enrich.about?.length ? enrich.about : defaultAbout;

  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name: entry.data.title,
    description: entry.data.description,
    inLanguage: ctx.lang,
    url: ctx.pageUrl,
    isAccessibleForFree: true,
    datePublished: entry.data.pubDate.toISOString(),
    ...(entry.data.updatedDate ? { dateModified: entry.data.updatedDate.toISOString() } : {}),
    lastReviewed: reviewedAt,
    reviewedBy: orgRef(ctx.siteUrl),
    author: orgRef(ctx.siteUrl),
    publisher: orgRef(ctx.siteUrl),
    medicalAudience: MEDICAL_AUDIENCE_PATIENT,
    audience: QUEER_IRAQI_AUDIENCE,
    specialty: { '@type': 'MedicalSpecialty', name: specialty },
    ...(aboutKeys.length ? { about: entityRefs(aboutKeys) } : {}),
    ...(enrich.mentions?.length ? { mentions: entityRefs(enrich.mentions) } : {}),
    ...(enrich.wordCount ? { wordCount: enrich.wordCount } : {}),
    ...(enrich.readingTime ? { timeRequired: isoMinutes(enrich.readingTime) } : {}),
    ...(buildCitationRefs(enrich.citations) ? { citation: buildCitationRefs(enrich.citations) } : {}),
  };
}

// ---------------------------------------------------------------------------
// HowTo — pharmacy script + honor-violence escape plan + any numbered guide
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
  /** ISO 8601 duration. Defaults to PT15M. */
  totalTime?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: args.name,
    description: args.description,
    inLanguage: args.ctx.lang,
    isAccessibleForFree: true,
    totalTime: args.totalTime ?? 'PT15M',
    audience: QUEER_IRAQI_AUDIENCE,
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

export function buildLearningResourceSchema(
  entry: GuideEntry,
  ctx: JsonLdContext,
  enrich: ArticleEnrichment = {},
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: entry.data.title,
    description: entry.data.description,
    inLanguage: ctx.lang,
    url: ctx.pageUrl,
    isAccessibleForFree: true,
    learningResourceType: 'Article',
    educationalLevel: 'beginner',
    teaches: entry.data.title,
    audience: QUEER_IRAQI_AUDIENCE,
    author: orgRef(ctx.siteUrl),
    publisher: orgRef(ctx.siteUrl),
    datePublished: entry.data.pubDate.toISOString(),
    ...(entry.data.updatedDate ? { dateModified: entry.data.updatedDate.toISOString() } : {}),
    ...(enrich.about?.length ? { about: entityRefs(enrich.about) } : {}),
    ...(enrich.mentions?.length ? { mentions: entityRefs(enrich.mentions) } : {}),
    ...(enrich.wordCount ? { wordCount: enrich.wordCount } : {}),
    ...(enrich.readingTime ? { timeRequired: isoMinutes(enrich.readingTime) } : {}),
    ...(buildCitationRefs(enrich.citations) ? { citation: buildCitationRefs(enrich.citations) } : {}),
  };
}

// ---------------------------------------------------------------------------
// FAQPage with Speakable
// ---------------------------------------------------------------------------

export interface FaqEntry {
  q: string;
  a: string;
}

/**
 * Strip markdown link syntax → plain text for JSON-LD answer payloads.
 * Schema.org wants plain text; AI engines that consume the schema render
 * the inline links themselves from the prose elsewhere on the page.
 */
function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

/**
 * Convert a frontmatter commonQuestions array to a FAQPage schema. Use
 * inside a combineSchemas(@graph) so it sits alongside the primary
 * MedicalWebPage/Article schema rather than replacing it.
 */
export function buildFaqPageFromQuestions(faqs: FaqEntry[], ctx: JsonLdContext) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: ctx.lang,
    isAccessibleForFree: true,
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: stripMarkdownLinks(f.a),
      },
    })),
  };
}

/**
 * Convert frontmatter citations to a Schema.org `citation` array of
 * CreativeWork references. Returns undefined if no citations supplied
 * so call sites can spread it conditionally.
 */
export interface CitationInput {
  title: string;
  org?: string;
  url?: string;
  year?: number;
}

export function buildCitationRefs(citations: CitationInput[] | undefined) {
  if (!citations || citations.length === 0) return undefined;
  return citations.map((c) => ({
    '@type': 'CreativeWork',
    name: c.title,
    ...(c.org ? { publisher: { '@type': 'Organization', name: c.org } } : {}),
    ...(c.url ? { url: c.url } : {}),
    ...(c.year ? { datePublished: String(c.year) } : {}),
  }));
}

export function buildFaqPageWithSpeakable(faqs: FaqEntry[], ctx: JsonLdContext) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: ctx.lang,
    isAccessibleForFree: true,
    audience: QUEER_IRAQI_AUDIENCE,
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['[data-speakable]', '.prose h2', '.prose p'],
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

export function buildAlertNewsArticleSchema(
  alert: AlertEntry,
  ctx: JsonLdContext,
  enrich: ArticleEnrichment = {},
) {
  const data = alert.data;
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: data.title,
    description: data.description,
    datePublished: data.pubDate.toISOString(),
    inLanguage: ctx.lang,
    isAccessibleForFree: true,
    author: orgRef(ctx.siteUrl),
    publisher: orgRef(ctx.siteUrl),
    mainEntityOfPage: ctx.pageUrl,
    audience: QUEER_IRAQI_AUDIENCE,
    ...(data.source
      ? { sourceOrganization: { '@type': 'NewsMediaOrganization', name: data.source } }
      : {}),
    ...(data.sourceUrl ? { isBasedOn: data.sourceUrl } : {}),
    ...(data.keywords
      ? { keywords: data.keywords.split(',').map((s) => s.trim()).filter(Boolean) }
      : {}),
    ...(enrich.about?.length ? { about: entityRefs(enrich.about) } : {}),
    ...(enrich.mentions?.length ? { mentions: entityRefs(enrich.mentions) } : {}),
    ...(enrich.wordCount ? { wordCount: enrich.wordCount } : {}),
    ...(enrich.readingTime ? { timeRequired: isoMinutes(enrich.readingTime) } : {}),
    ...(buildCitationRefs(enrich.citations) ? { citation: buildCitationRefs(enrich.citations) } : {}),
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
    isAccessibleForFree: true,
    audience: QUEER_IRAQI_AUDIENCE,
    isPartOf: { '@id': `${args.ctx.siteUrl}#website` },
    publisher: orgRef(args.ctx.siteUrl),
  };
}

// ---------------------------------------------------------------------------
// Speakable wrapper — apply to any page-level schema to mark TL;DR + headings
// ---------------------------------------------------------------------------

/**
 * Add a SpeakableSpecification clause to any page-level schema. Targets
 * `[data-speakable]` (the AnswerSummary block at the top of each guide)
 * plus the article H1 so voice / AI engines surface the front-loaded
 * answer rather than an arbitrary middle paragraph.
 */
export function withSpeakable<T extends Record<string, unknown>>(schema: T): T {
  return {
    ...schema,
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['[data-speakable]', '.prose h1'],
    },
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
