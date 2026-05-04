/**
 * ISPC API Worker
 *
 * Public endpoints (origin-locked, no auth):
 *   POST /feedback       — accepts feedback form, creates GitHub Issue
 *   POST /submissions    — accepts story submission, creates GitHub Issue
 *
 * Admin endpoints (Cloudflare Access protects /admin/* — configure in
 *   Zero Trust dashboard with policy: email == iriszimmerfrau@gmail.com):
 *   GET  /admin                              — admin dashboard HTML
 *   GET  /admin/api/feedback                 — list open feedback issues
 *   GET  /admin/api/submissions              — list open submission issues
 *   POST /admin/api/issues/:n/close|approve|reject  — moderate
 */

interface Env {
  GITHUB_TOKEN: string;      // secret
  GITHUB_OWNER: string;
  GITHUB_REPO: string;       // inbox repo (issues)
  PUBLISH_REPO: string;      // site repo (where approved stories get committed)
  PUBLISH_BRANCH: string;    // typically "main"
  ALLOWED_ORIGIN: string;
  PLAUSIBLE_API_KEY: string; // secret
  PLAUSIBLE_SITE_ID: string; // e.g. "ispc-iq.org"
}

const LIMITS = {
  feedback: 4000,
  storyTitle: 200,
  story: 20000,
  category: 32,
  lang: 4,
  pseudonym: 80,
  contact: 200,
  contentWarning: 200,
} as const;

// Control char strip pattern, written via Unicode escapes so the source
// file stays free of literal control bytes.
const CTRL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

const FALLBACK_ORIGIN = 'https://ispc-iq.org';

function corsHeaders(allowedOrigin: string | undefined): HeadersInit {
  return {
    'Access-Control-Allow-Origin': allowedOrigin || FALLBACK_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, allowedOrigin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(allowedOrigin) },
  });
}

function plain(msg: string, status = 200): Response {
  return new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function sanitize(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CTRL, '').trim().slice(0, max);
}

async function gh(env: Env, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ispc-api-worker',
      ...(init?.headers ?? {}),
    },
  });
}

async function createIssue(
  env: Env,
  args: { title: string; body: string; labels: string[] },
): Promise<unknown> {
  const res = await gh(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub createIssue ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

interface Issue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  labels: { name: string }[];
}

async function listIssues(env: Env, label: string): Promise<Issue[]> {
  const res = await gh(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues?labels=${encodeURIComponent(
      label,
    )}&state=open&per_page=100&sort=created&direction=desc`,
  );
  if (!res.ok) throw new Error(`GitHub listIssues ${res.status}`);
  const data = (await res.json()) as Issue[];
  // Filter out PRs (Issues API returns PRs too)
  return data.filter((it) => !('pull_request' in it));
}

async function patchIssue(
  env: Env,
  num: number,
  args: { state?: 'open' | 'closed'; labels?: string[] },
): Promise<void> {
  const res = await gh(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${num}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub patchIssue ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function getIssue(env: Env, num: number): Promise<Issue> {
  const res = await gh(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${num}`);
  if (!res.ok) throw new Error(`GitHub getIssue ${res.status}`);
  return res.json();
}

interface Submission {
  lang: string;
  pseudonym: string;
  contentWarning: string;
  story: string;
}

function parseSubmissionBody(body: string): Submission {
  const lang = body.match(/\*\*Language:\*\*\s*(\S+)/)?.[1] || 'en';
  const pseudonym = body.match(/\*\*Pseudonym:\*\*\s*(.+?)$/m)?.[1].trim() || 'Anonymous';
  const contentWarning = body.match(/\*\*Content warning:\*\*\s*(.+?)$/m)?.[1].trim() || 'none';
  // Story body is everything after the "---" divider line
  const dividerMatch = body.match(/\n---\n/);
  const story = dividerMatch
    ? body.slice((dividerMatch.index ?? 0) + dividerMatch[0].length).trim()
    : body.trim();
  return { lang, pseudonym, contentWarning, story };
}

function yamlString(value: string): string {
  // Force a quoted YAML scalar; backslash-escape backslashes and double quotes.
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function makeDescription(story: string, max = 180): string {
  // Take first paragraph or first `max` chars, single-line, no markdown.
  const firstPara = story.split(/\n\n+/)[0].replace(/\s+/g, ' ').trim();
  if (firstPara.length <= max) return firstPara;
  return firstPara.slice(0, max).trim() + '…';
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

interface ContentFile {
  sha: string;
  content: string;
}

async function getRepoFile(env: Env, path: string): Promise<ContentFile | null> {
  const res = await gh(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.PUBLISH_REPO}/contents/${path}?ref=${env.PUBLISH_BRANCH}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getRepoFile ${res.status}`);
  return res.json();
}

async function putRepoFile(
  env: Env,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<void> {
  const res = await gh(env, `/repos/${env.GITHUB_OWNER}/${env.PUBLISH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: utf8ToBase64(content),
      branch: env.PUBLISH_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub putRepoFile ${res.status}: ${text.slice(0, 300)}`);
  }
}

// ----- Generic content (stories / news) read/write/delete -----

type ContentType = 'stories' | 'news' | 'alerts';
type ContentLang = 'en' | 'ar';

function isContentType(s: string): s is ContentType {
  return s === 'stories' || s === 'news' || s === 'alerts';
}
function isContentLang(s: string): s is ContentLang {
  return s === 'en' || s === 'ar';
}
function isSafeSlug(s: string): boolean {
  // Lowercase letters, digits, hyphen. Length 1-80. No path traversal.
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(s);
}

interface RepoEntry {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
}

async function listRepoDir(env: Env, dirPath: string): Promise<RepoEntry[]> {
  const res = await gh(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.PUBLISH_REPO}/contents/${dirPath}?ref=${env.PUBLISH_BRANCH}`,
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`listRepoDir ${dirPath} ${res.status}`);
  const data = (await res.json()) as RepoEntry[];
  return Array.isArray(data) ? data : [];
}

interface FileBlob {
  sha: string;
  content: string; // base64
  encoding: string;
}

function base64ToUtf8(s: string): string {
  const binary = atob(s.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function parseFrontmatter(markdown: string): {
  fm: Record<string, string>;
  body: string;
} {
  const fm: Record<string, string> = {};
  if (!markdown.startsWith('---')) return { fm, body: markdown };
  const closingIdx = markdown.indexOf('\n---', 3);
  if (closingIdx === -1) return { fm, body: markdown };
  const fmText = markdown.slice(3, closingIdx).trim();
  const body = markdown.slice(closingIdx + 4).replace(/^\n/, '');
  for (const line of fmText.split('\n')) {
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    fm[match[1]] = value;
  }
  return { fm, body };
}

interface ContentSummary {
  type: ContentType;
  lang: ContentLang;
  slug: string;
  path: string;
  sha: string;
  title: string;
  pubDate: string;
  draft: boolean;
}

async function listContent(env: Env, type: ContentType): Promise<ContentSummary[]> {
  const langs: ContentLang[] = ['en', 'ar'];
  const results: ContentSummary[] = [];
  for (const lang of langs) {
    const dir = `src/content/${type}/${lang}`;
    const entries = await listRepoDir(env, dir);
    const mdFiles = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md'));
    const detailed = await Promise.all(
      mdFiles.map(async (entry) => {
        const slug = entry.name.replace(/\.md$/, '');
        try {
          const res = await gh(
            env,
            `/repos/${env.GITHUB_OWNER}/${env.PUBLISH_REPO}/contents/${entry.path}?ref=${env.PUBLISH_BRANCH}`,
          );
          if (!res.ok) throw new Error(`fetch failed ${res.status}`);
          const blob = (await res.json()) as FileBlob;
          const md = base64ToUtf8(blob.content);
          const { fm } = parseFrontmatter(md);
          return {
            type,
            lang,
            slug,
            path: entry.path,
            sha: blob.sha,
            title: fm.title || slug,
            pubDate: fm.pubDate || '',
            draft: fm.draft === 'true',
          };
        } catch {
          return {
            type,
            lang,
            slug,
            path: entry.path,
            sha: entry.sha,
            title: slug,
            pubDate: '',
            draft: false,
          };
        }
      }),
    );
    results.push(...detailed);
  }
  // Sort by pubDate desc, then slug asc
  results.sort((a, b) => {
    if (a.pubDate === b.pubDate) return a.slug.localeCompare(b.slug);
    return b.pubDate.localeCompare(a.pubDate);
  });
  return results;
}

interface ContentDetail extends ContentSummary {
  content: string; // raw markdown including frontmatter
}

async function getContentFile(
  env: Env,
  type: ContentType,
  lang: ContentLang,
  slug: string,
): Promise<ContentDetail | null> {
  const path = `src/content/${type}/${lang}/${slug}.md`;
  const res = await gh(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.PUBLISH_REPO}/contents/${path}?ref=${env.PUBLISH_BRANCH}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getContentFile ${res.status}`);
  const blob = (await res.json()) as FileBlob;
  const md = base64ToUtf8(blob.content);
  const { fm } = parseFrontmatter(md);
  return {
    type,
    lang,
    slug,
    path,
    sha: blob.sha,
    title: fm.title || slug,
    pubDate: fm.pubDate || '',
    draft: fm.draft === 'true',
    content: md,
  };
}

function validateMarkdownFrontmatter(md: string): string | null {
  if (!md.startsWith('---')) return 'must start with frontmatter ---';
  const closingIdx = md.indexOf('\n---', 3);
  if (closingIdx === -1) return 'frontmatter not closed (need a line with ---)';
  const { fm } = parseFrontmatter(md);
  if (!fm.title || fm.title.length < 1) return 'title is required in frontmatter';
  if (!fm.lang || (fm.lang !== 'en' && fm.lang !== 'ar')) return 'lang must be en or ar';
  if (!fm.pubDate) return 'pubDate is required';
  return null;
}

async function saveContentFile(
  env: Env,
  type: ContentType,
  lang: ContentLang,
  slug: string,
  markdown: string,
  expectedSha?: string,
): Promise<void> {
  const validationError = validateMarkdownFrontmatter(markdown);
  if (validationError) throw new Error(`validation: ${validationError}`);
  const path = `src/content/${type}/${lang}/${slug}.md`;
  await putRepoFile(
    env,
    path,
    markdown,
    expectedSha ? `Update ${type}/${lang}/${slug}` : `Create ${type}/${lang}/${slug}`,
    expectedSha,
  );
}

async function deleteContentFile(
  env: Env,
  type: ContentType,
  lang: ContentLang,
  slug: string,
  sha: string,
): Promise<void> {
  const path = `src/content/${type}/${lang}/${slug}.md`;
  const res = await gh(env, `/repos/${env.GITHUB_OWNER}/${env.PUBLISH_REPO}/contents/${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Delete ${type}/${lang}/${slug}`,
      sha,
      branch: env.PUBLISH_BRANCH,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`deleteContentFile ${res.status}: ${text.slice(0, 200)}`);
  }
}

// ----- end content management -----

// ----- Plausible Stats API -----

interface PlausibleQueryBody {
  metrics: string[];
  date_range: string; // "day" | "7d" | "30d" | "month" | "6mo" | "12mo" | "all" | array
  dimensions?: string[];
  filters?: unknown[];
  pagination?: { limit: number; offset?: number };
}

interface PlausibleQueryResult {
  results: { metrics: number[]; dimensions: string[] }[];
  meta?: Record<string, unknown>;
  query?: unknown;
}

async function plausibleQuery(env: Env, body: PlausibleQueryBody): Promise<PlausibleQueryResult> {
  const apiKey = (env.PLAUSIBLE_API_KEY || '').trim();
  const siteId = (env.PLAUSIBLE_SITE_ID || '').trim();
  if (!apiKey) throw new Error('PLAUSIBLE_API_KEY secret is not set');
  if (!siteId) throw new Error('PLAUSIBLE_SITE_ID var is not set');
  const res = await fetch('https://plausible.io/api/v2/query', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ site_id: siteId, ...body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`plausible ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function getAnalytics(env: Env, period: string) {
  const dateRange = ['day', '7d', '30d', 'month', '6mo', '12mo', 'all'].includes(period)
    ? period
    : '7d';
  const [aggregate, timeseries, topPages, topCountries, topSources] = await Promise.all([
    plausibleQuery(env, {
      metrics: ['visitors', 'pageviews', 'bounce_rate', 'visit_duration'],
      date_range: dateRange,
    }),
    plausibleQuery(env, {
      metrics: ['visitors', 'pageviews'],
      date_range: dateRange,
      dimensions: ['time:day'],
    }),
    plausibleQuery(env, {
      metrics: ['visitors', 'pageviews'],
      date_range: dateRange,
      dimensions: ['event:page'],
      pagination: { limit: 15 },
    }),
    plausibleQuery(env, {
      metrics: ['visitors'],
      date_range: dateRange,
      dimensions: ['visit:country'],
      pagination: { limit: 10 },
    }),
    plausibleQuery(env, {
      metrics: ['visitors'],
      date_range: dateRange,
      dimensions: ['visit:source'],
      pagination: { limit: 10 },
    }),
  ]);
  return { period: dateRange, aggregate, timeseries, topPages, topCountries, topSources };
}

// ----- end analytics -----

// ----- RSS aggregator (security alerts feeder) -----

/**
 * Sources we monitor. Google News RSS lets us query mainstream wire services
 * with arbitrary search strings; HRW and Outright publish dedicated feeds.
 * Each entry is just a URL the Worker can GET.
 */
const FEED_URLS: { name: string; url: string }[] = [
  { name: 'Google News — LGBTQ Iraq', url: 'https://news.google.com/rss/search?q=%22LGBTQ%22+%22Iraq%22&hl=en-US&gl=US&ceid=US:en' },
  { name: 'Google News — Iraq gay law', url: 'https://news.google.com/rss/search?q=%22Iraq%22+%22gay+law%22&hl=en-US&gl=US&ceid=US:en' },
  { name: 'Google News — Iraq transgender', url: 'https://news.google.com/rss/search?q=%22Iraq%22+%22transgender%22&hl=en-US&gl=US&ceid=US:en' },
  { name: 'Google News — Iraq queer', url: 'https://news.google.com/rss/search?q=%22Iraq%22+%22queer%22&hl=en-US&gl=US&ceid=US:en' },
  { name: 'Google News — Iraq homosexuality law', url: 'https://news.google.com/rss/search?q=%22Iraq%22+%22homosexuality%22&hl=en-US&gl=US&ceid=US:en' },
  { name: 'HRW Iraq', url: 'https://www.hrw.org/middle-east/n-africa/iraq/rss.xml' },
];

interface FeedItem {
  title: string;
  link: string;
  pubDate?: string;
  description?: string;
  source?: string;
}

/** Strip HTML tags and decode the most common HTML entities to plain text. */
function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse RSS 2.0 / Atom feed XML using regex. Returns up to 30 items. */
function parseFeed(xml: string, defaultSource: string): FeedItem[] {
  const items: FeedItem[] = [];
  // Try RSS <item>...</item>
  const itemRe = /<item[\s>][\s\S]*?<\/item>/g;
  const matches = xml.match(itemRe) || [];
  for (const block of matches.slice(0, 30)) {
    const titleM = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const linkM = block.match(/<link[^>]*>([\s\S]*?)<\/link>/);
    const dateM = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/);
    const descM = block.match(/<description[^>]*>([\s\S]*?)<\/description>/);
    const srcM = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    if (!titleM || !linkM) continue;
    items.push({
      title: stripHtml(titleM[1]).slice(0, 300),
      link: stripHtml(linkM[1]).slice(0, 500),
      pubDate: dateM ? stripHtml(dateM[1]) : undefined,
      description: descM ? stripHtml(descM[1]).slice(0, 500) : undefined,
      source: srcM ? stripHtml(srcM[1]).slice(0, 80) : defaultSource,
    });
  }
  // Fall back to Atom <entry>...</entry>
  if (items.length === 0) {
    const entryRe = /<entry[\s>][\s\S]*?<\/entry>/g;
    const entries = xml.match(entryRe) || [];
    for (const block of entries.slice(0, 30)) {
      const titleM = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      const linkM = block.match(/<link[^>]*\bhref="([^"]+)"/);
      const dateM = block.match(/<(?:updated|published)[^>]*>([\s\S]*?)<\/(?:updated|published)>/);
      const summaryM = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
      if (!titleM || !linkM) continue;
      items.push({
        title: stripHtml(titleM[1]).slice(0, 300),
        link: stripHtml(linkM[1]).slice(0, 500),
        pubDate: dateM ? stripHtml(dateM[1]) : undefined,
        description: summaryM ? stripHtml(summaryM[1]).slice(0, 500) : undefined,
        source: defaultSource,
      });
    }
  }
  return items;
}

/** Heuristic relevance filter — drop items that don't look LGBTQ+Iraq related. */
function isRelevant(item: FeedItem): boolean {
  const text = `${item.title} ${item.description ?? ''}`.toLowerCase();
  const hasIraq = /\biraq\b|\biraqi\b/.test(text);
  const hasQueer = /\b(lgbt|lgbtq|lgbtqia|gay|lesbian|trans|transgender|queer|bisexual|homosexual|sexual orientation|gender identity|same-sex)\b/.test(text);
  return hasIraq && hasQueer;
}

async function searchExistingAlertIssues(env: Env, link: string): Promise<boolean> {
  // GitHub search for an exact URL string in our private inbox repo.
  const q = encodeURIComponent(`repo:${env.GITHUB_OWNER}/${env.GITHUB_REPO} in:body "${link}"`);
  const res = await gh(env, `/search/issues?q=${q}&per_page=1`);
  if (!res.ok) return false;
  const data = (await res.json()) as { total_count?: number };
  return (data.total_count ?? 0) > 0;
}

async function aggregateRssOnce(env: Env): Promise<{ created: number; skipped: number; errors: string[] }> {
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const feed of FEED_URLS) {
    let xml = '';
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'ispc-api-worker (security alerts aggregator)' },
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      if (!res.ok) {
        errors.push(`${feed.name}: HTTP ${res.status}`);
        continue;
      }
      xml = await res.text();
    } catch (e) {
      errors.push(`${feed.name}: fetch failed (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }

    const items = parseFeed(xml, feed.name);
    for (const item of items) {
      if (!isRelevant(item)) {
        skipped++;
        continue;
      }
      try {
        const exists = await searchExistingAlertIssues(env, item.link);
        if (exists) {
          skipped++;
          continue;
        }
        const body = [
          `**Source feed:** ${feed.name}`,
          `**Original source:** ${item.source ?? feed.name}`,
          `**URL:** ${item.link}`,
          `**Published:** ${item.pubDate ?? 'unknown'}`,
          '',
          '---',
          '',
          item.description ?? '(no description)',
        ].join('\n');
        await createIssue(env, {
          title: `[Alert candidate] ${item.title}`,
          body,
          labels: ['alert-pending'],
        });
        created++;
      } catch (e) {
        errors.push(`${feed.name}/${item.title.slice(0, 60)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return { created, skipped, errors };
}

// ----- end RSS aggregator -----

async function publishStory(env: Env, num: number): Promise<{ path: string; lang: string }> {
  const issue = await getIssue(env, num);
  const rawTitle = issue.title.replace(/^Story submission:\s*/i, '').trim() || `Story #${num}`;
  const sub = parseSubmissionBody(issue.body || '');
  const lang = sub.lang === 'ar' ? 'ar' : 'en';
  const today = new Date().toISOString().slice(0, 10);
  const isAnonymous = !sub.pseudonym || sub.pseudonym === 'Anonymous';

  const frontmatterLines = [
    '---',
    `title: ${yamlString(rawTitle)}`,
    `description: ${yamlString(makeDescription(sub.story))}`,
    `lang: ${lang}`,
    `pubDate: ${today}`,
    `anonymous: ${isAnonymous ? 'true' : 'false'}`,
  ];
  if (!isAnonymous) frontmatterLines.push(`pseudonym: ${yamlString(sub.pseudonym)}`);
  if (sub.contentWarning && sub.contentWarning !== 'none') {
    frontmatterLines.push(`contentWarning: ${yamlString(sub.contentWarning)}`);
  }
  frontmatterLines.push('---', '');

  const fileContent = frontmatterLines.join('\n') + '\n' + sub.story + '\n';
  const path = `src/content/stories/${lang}/story-${num}.md`;

  // If a previous publish exists at this path, get its sha so we can update.
  const existing = await getRepoFile(env, path);
  await putRepoFile(env, path, fileContent, `Publish approved story #${num}`, existing?.sha);

  return { path, lang };
}

async function handleFeedback(req: Request, env: Env, origin: string): Promise<Response> {
  let data: Record<string, unknown>;
  try {
    data = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }
  // Honeypot — should always be empty for humans
  if (typeof data.website === 'string' && data.website.length > 0) {
    return json({ ok: true }, 200, origin); // silently swallow bot
  }
  const message = sanitize(data.message, LIMITS.feedback);
  const category = sanitize(data.category, LIMITS.category);
  const lang = sanitize(data.lang, LIMITS.lang);

  if (!message || message.length < 3) return json({ error: 'message_required' }, 400, origin);

  const body = [
    `**Category:** ${category || 'general'}`,
    `**Language:** ${lang || 'unknown'}`,
    '',
    '---',
    '',
    message,
  ].join('\n');

  await createIssue(env, {
    title: `Feedback (${category || 'general'})`,
    body,
    labels: ['feedback'],
  });
  return json({ ok: true }, 200, origin);
}

async function handleSubmission(req: Request, env: Env, origin: string): Promise<Response> {
  let data: Record<string, unknown>;
  try {
    data = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }
  if (typeof data.website === 'string' && data.website.length > 0) {
    return json({ ok: true }, 200, origin);
  }
  const title = sanitize(data.title, LIMITS.storyTitle);
  const story = sanitize(data.story, LIMITS.story);
  const lang = sanitize(data.lang, LIMITS.lang);
  const pseudonym = sanitize(data.pseudonym, LIMITS.pseudonym);
  const contentWarning = sanitize(data.contentWarning, LIMITS.contentWarning);
  const contact = sanitize(data.contact, LIMITS.contact);

  if (!title || title.length < 3) return json({ error: 'title_required' }, 400, origin);
  if (!story || story.length < 50) return json({ error: 'story_too_short' }, 400, origin);

  const body = [
    `**Language:** ${lang || 'unknown'}`,
    `**Pseudonym:** ${pseudonym || 'Anonymous'}`,
    `**Content warning:** ${contentWarning || 'none'}`,
    `**Contact (optional):** ${contact || '—'}`,
    '',
    '---',
    '',
    story,
  ].join('\n');

  await createIssue(env, {
    title: `Story submission: ${title}`,
    body,
    labels: ['submission'],
  });
  return json({ ok: true }, 200, origin);
}

const ADMIN_MOD_RE = /^\/admin\/api\/issues\/(\d+)\/(close|approve|reject)$/;
// Content routes: /admin/api/content/(stories|news|alerts)/(en|ar)/(slug)
const ADMIN_CONTENT_LIST_RE = /^\/admin\/api\/content\/(stories|news|alerts)$/;
const ADMIN_CONTENT_ITEM_RE = /^\/admin\/api\/content\/(stories|news|alerts)\/(en|ar)\/([a-z0-9][a-z0-9-]{0,79})$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const allowedOrigin = env.ALLOWED_ORIGIN || FALLBACK_ORIGIN;

    // Cheap top-level catch so a thrown error never produces a CF 1101.
    // Detailed errors are still logged via console.error inside handlers.

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    }

    // Lock public form POSTs to our origin
    if (req.method === 'POST' && (url.pathname === '/feedback' || url.pathname === '/submissions')) {
      const origin = req.headers.get('Origin');
      if (origin !== allowedOrigin) {
        return json({ error: 'forbidden_origin' }, 403, allowedOrigin);
      }
    }

    try {
      // Public endpoints
      if (req.method === 'POST' && url.pathname === '/feedback') {
        return await handleFeedback(req, env, allowedOrigin);
      }
      if (req.method === 'POST' && url.pathname === '/submissions') {
        return await handleSubmission(req, env, allowedOrigin);
      }

      // Defense in depth: refuse admin requests if Cloudflare Access didn't
      // populate the JWT/email headers. Without this, a misconfigured Access
      // app would expose the dashboard to anyone.
      if (url.pathname.startsWith('/admin')) {
        const accessJwt = req.headers.get('Cf-Access-Jwt-Assertion');
        const accessEmail = req.headers.get('Cf-Access-Authenticated-User-Email');
        if (!accessJwt || !accessEmail) {
          return new Response(
            'Cloudflare Access is not configured for this path. Configure an Access application for api.ispc-iq.org with path admin/* before this endpoint will respond.',
            { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
          );
        }
      }

      if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
        return new Response(adminHtml(), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      if (req.method === 'GET' && url.pathname === '/admin/api/feedback') {
        const issues = await listIssues(env, 'feedback');
        return json({ issues }, 200, allowedOrigin);
      }
      if (req.method === 'GET' && url.pathname === '/admin/api/submissions') {
        const issues = await listIssues(env, 'submission');
        return json({ issues }, 200, allowedOrigin);
      }
      if (req.method === 'GET' && url.pathname === '/admin/api/analytics') {
        const period = url.searchParams.get('period') || '7d';
        const data = await getAnalytics(env, period);
        return json(data, 200, allowedOrigin);
      }
      // Content list: GET /admin/api/content/(stories|news|alerts)
      const listMatch = ADMIN_CONTENT_LIST_RE.exec(url.pathname);
      if (listMatch) {
        const type = listMatch[1] as ContentType;
        if (req.method === 'GET') {
          const items = await listContent(env, type);
          return json({ items }, 200, allowedOrigin);
        }
        if (req.method === 'POST') {
          // Create new news or alert. Body: { lang, slug, content }
          if (type !== 'news' && type !== 'alerts') {
            return json({ error: 'create_only_for_news_or_alerts' }, 400, allowedOrigin);
          }
          const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
          const lang = String(body.lang || '');
          const slug = String(body.slug || '');
          const content = String(body.content || '');
          if (!isContentLang(lang)) return json({ error: 'bad_lang' }, 400, allowedOrigin);
          if (!isSafeSlug(slug)) return json({ error: 'bad_slug (lowercase, digits, hyphen, max 80)' }, 400, allowedOrigin);
          // Reject if file already exists
          const existing = await getContentFile(env, type, lang, slug);
          if (existing) return json({ error: 'slug_exists' }, 409, allowedOrigin);
          await saveContentFile(env, type, lang, slug, content);
          return json({ ok: true, path: `src/content/${type}/${lang}/${slug}.md` }, 200, allowedOrigin);
        }
      }

      // Content item: GET/PUT/DELETE /admin/api/content/(stories|news)/(en|ar)/(slug)
      const itemMatch = ADMIN_CONTENT_ITEM_RE.exec(url.pathname);
      if (itemMatch) {
        const type = itemMatch[1] as ContentType;
        const lang = itemMatch[2] as ContentLang;
        const slug = itemMatch[3];
        if (req.method === 'GET') {
          const detail = await getContentFile(env, type, lang, slug);
          if (!detail) return json({ error: 'not_found' }, 404, allowedOrigin);
          return json(detail, 200, allowedOrigin);
        }
        if (req.method === 'PUT') {
          const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
          const content = String(body.content || '');
          const sha = body.sha ? String(body.sha) : undefined;
          await saveContentFile(env, type, lang, slug, content, sha);
          return json({ ok: true }, 200, allowedOrigin);
        }
        if (req.method === 'DELETE') {
          const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
          const sha = String(body.sha || '');
          if (!sha) return json({ error: 'sha_required' }, 400, allowedOrigin);
          await deleteContentFile(env, type, lang, slug, sha);
          return json({ ok: true }, 200, allowedOrigin);
        }
      }

      if (req.method === 'POST') {
        const m = ADMIN_MOD_RE.exec(url.pathname);
        if (m) {
          const num = parseInt(m[1], 10);
          const action = m[2];
          if (action === 'close') {
            await patchIssue(env, num, { state: 'closed' });
            return json({ ok: true }, 200, allowedOrigin);
          }
          if (action === 'reject') {
            await patchIssue(env, num, { state: 'closed', labels: ['submission', 'rejected'] });
            return json({ ok: true }, 200, allowedOrigin);
          }
          if (action === 'approve') {
            // 1. Publish the story to the site repo as a markdown file.
            const result = await publishStory(env, num);
            // 2. Mark the inbox issue closed + approved only after publish succeeds.
            await patchIssue(env, num, { state: 'closed', labels: ['submission', 'approved'] });
            return json({ ok: true, published: result.path, lang: result.lang }, 200, allowedOrigin);
          }
        }
      }

      // Health check (handy for verifying the route works end-to-end)
      if (req.method === 'GET' && url.pathname === '/health') {
        return plain('ok');
      }
      // Manual trigger of the RSS feeder (admin-only via Access). Useful for
      // testing without waiting for the cron, or kicking a one-shot fetch.
      if (req.method === 'POST' && url.pathname === '/admin/api/feeder/run') {
        const result = await aggregateRssOnce(env);
        return json(result, 200, allowedOrigin);
      }
      // Surface deploy state for debugging — confirms env vars reached the bundle.
      if (req.method === 'GET' && url.pathname === '/debug') {
        const plausibleKey = (env.PLAUSIBLE_API_KEY || '').trim();
        const rawPlausibleKey = env.PLAUSIBLE_API_KEY || '';
        return json({
          ok: true,
          hasGithubToken: Boolean(env.GITHUB_TOKEN),
          githubOwner: env.GITHUB_OWNER || null,
          githubRepo: env.GITHUB_REPO || null,
          publishRepo: env.PUBLISH_REPO || null,
          publishBranch: env.PUBLISH_BRANCH || null,
          allowedOrigin: env.ALLOWED_ORIGIN || null,
          hasPlausibleKey: Boolean(plausibleKey),
          plausibleKeyLength: plausibleKey.length,
          plausibleKeyHasWhitespace: rawPlausibleKey.length !== plausibleKey.length,
          plausibleKeyPrefix: plausibleKey.slice(0, 4),
          plausibleKeySuffix: plausibleKey.slice(-4),
          plausibleSiteId: env.PLAUSIBLE_SITE_ID || null,
        }, 200, allowedOrigin);
      }

      return plain('not found', 404);
    } catch (err) {
      console.error('worker error', err instanceof Error ? err.stack || err.message : String(err));
      return json({ error: 'internal_error', message: err instanceof Error ? err.message : String(err) }, 500, allowedOrigin);
    }
  },

  /** Cloudflare cron trigger entry-point. Configured in wrangler.toml. */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const result = await aggregateRssOnce(env);
          console.log(`[cron] feeder created=${result.created} skipped=${result.skipped} errors=${result.errors.length}`);
          if (result.errors.length) console.error('[cron] feeder errors', result.errors.slice(0, 5));
        } catch (err) {
          console.error('[cron] feeder fatal', err instanceof Error ? err.stack : String(err));
        }
      })(),
    );
  },
};

/** Admin dashboard HTML — served by Worker, behind Cloudflare Access. */
function adminHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>ISPC Admin</title>
<style>
:root { --bg:#faf7f2; --navy:#0d1b2e; --terra:#b85c38; --olive:#5a6e48; --red:#c4382b; --muted:#5a5750; --cream:#f0e6d3; }
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:#1a1a18;line-height:1.5}
header{background:var(--navy);color:var(--cream);padding:.85rem 1.25rem;display:flex;justify-content:space-between;align-items:center;gap:1rem}
header h1{margin:0;font-size:.95rem;font-weight:600;letter-spacing:.02em}
header .who{font-size:.78rem;opacity:.7;margin-right:1rem}
header a.logout{color:var(--cream);font-size:.78rem;opacity:.7;text-decoration:underline}
header a.logout:hover{opacity:1}
main{max-width:1080px;margin:0 auto;padding:1.25rem}
.tabs{display:flex;gap:0;border-bottom:1px solid #d8cfb9;margin-bottom:1.25rem;flex-wrap:wrap}
.tabs button{background:none;border:none;padding:.7rem 1.15rem;cursor:pointer;font:inherit;color:var(--muted);border-bottom:2px solid transparent}
.tabs button[aria-selected="true"]{color:var(--navy);border-bottom-color:var(--terra);font-weight:600}
.tabs .count{display:inline-block;margin-inline-start:.4rem;font-size:.7rem;background:var(--terra);color:white;padding:.05rem .4rem;border-radius:99px;vertical-align:middle}
.panel{display:none}
.panel[data-active]{display:block}
.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem;gap:.5rem;flex-wrap:wrap}
.toolbar .left{font-size:.85rem;color:var(--muted)}
.btn{padding:.45rem .9rem;font-size:.82rem;cursor:pointer;border:1px solid var(--navy);background:white;color:var(--navy);text-decoration:none;font-family:inherit}
.btn:hover{background:#f5efe1}
.btn.primary{background:var(--navy);color:var(--cream);border-color:var(--navy)}
.btn.primary:hover{background:#1a2a40;color:white}
.btn.danger{background:var(--red);color:white;border-color:var(--red)}
.btn.olive{background:var(--olive);color:white;border-color:var(--olive)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.item{background:white;border:1px solid #e5dcc6;padding:1rem;margin-bottom:.75rem}
.item h3{margin:0 0 .35rem;font-size:.95rem;color:var(--navy)}
.item .meta{font-size:.72rem;color:var(--muted);margin-bottom:.5rem;font-family:ui-monospace,monospace}
.item .body{white-space:pre-wrap;font-size:.85rem;max-height:340px;overflow-y:auto;padding:.65rem;background:#faf7f2;border:1px solid #ece4d3;font-family:ui-monospace,Menlo,monospace}
.actions{margin-top:.7rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.actions button,.actions a{padding:.4rem .8rem;font-size:.8rem;cursor:pointer;border:1px solid var(--navy);background:white;color:var(--navy);text-decoration:none;font-family:inherit}
.actions button.approve{background:var(--olive);color:white;border-color:var(--olive)}
.actions button.reject{background:var(--red);color:white;border-color:var(--red)}
.actions a.gh{color:var(--muted);border-color:#ddd;font-size:.75rem}
.empty{padding:2rem;text-align:center;color:var(--muted)}
.err{color:var(--red);padding:1rem;background:#fff;border:1px solid var(--red)}
.toast{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:var(--navy);color:white;padding:.6rem 1rem;font-size:.85rem;z-index:99}
.row{display:grid;grid-template-columns:auto 1fr auto;gap:.75rem;align-items:center;padding:.75rem 1rem;background:white;border:1px solid #e5dcc6;margin-bottom:.5rem}
.row .badge{font-size:.65rem;padding:.15rem .4rem;border:1px solid var(--navy);color:var(--navy);text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.row .badge.ar{background:var(--terra);color:white;border-color:var(--terra)}
.row .badge.draft{background:var(--muted);color:white;border-color:var(--muted);margin-inline-start:.35rem}
.row .info{display:flex;flex-direction:column;min-width:0}
.row .info .title{font-size:.9rem;color:var(--navy);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .info .sub{font-size:.7rem;color:var(--muted);font-family:ui-monospace,monospace;margin-top:.15rem}
.row .row-actions{display:flex;gap:.4rem}
.editor{background:white;border:1px solid #e5dcc6;padding:1.25rem;margin-bottom:1rem}
.editor h2{margin:0 0 1rem;font-size:1.05rem;color:var(--navy)}
.editor .field{display:block;margin-bottom:.85rem}
.editor label{display:block;font-size:.78rem;font-weight:600;color:var(--navy);margin-bottom:.25rem}
.editor input,.editor select,.editor textarea{width:100%;padding:.5rem;border:1px solid #c0b9a8;background:#fdfcf7;font-family:ui-monospace,Menlo,monospace;font-size:.85rem}
.editor textarea{min-height:380px;line-height:1.5;resize:vertical}
.editor .editor-actions{display:flex;gap:.5rem;margin-top:1rem}
.editor .help{font-size:.72rem;color:var(--muted);margin-top:.2rem}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.85rem;margin-bottom:1.25rem}
.kpi{background:white;border:1px solid #e5dcc6;padding:1.1rem}
.kpi .label{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.3rem}
.kpi .value{font-size:1.7rem;color:var(--navy);font-weight:700;font-family:ui-monospace,Menlo,monospace;line-height:1}
.tables{display:grid;grid-template-columns:1fr 1fr;gap:.85rem}
@media (max-width: 720px){.tables{grid-template-columns:1fr}}
.table-card{background:white;border:1px solid #e5dcc6;padding:.9rem 1rem}
.table-card h3{margin:0 0 .5rem;font-size:.85rem;color:var(--navy);font-weight:600}
.stats-table{width:100%;border-collapse:collapse;font-size:.82rem}
.stats-table tr{border-bottom:1px solid #f0e8d4}
.stats-table tr:last-child{border-bottom:none}
.stats-table td{padding:.4rem .25rem;vertical-align:top}
.stats-table td.label{max-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stats-table td.num{text-align:right;font-family:ui-monospace,Menlo,monospace;color:var(--muted);width:4rem}
.period-buttons{display:flex;gap:.25rem;flex-wrap:wrap}
.btn.period[aria-pressed="true"]{background:var(--navy);color:var(--cream);border-color:var(--navy)}
.spark-card{background:white;border:1px solid #e5dcc6;padding:.9rem 1rem;margin-bottom:.85rem}
.spark-card h3{margin:0 0 .5rem;font-size:.85rem;color:var(--navy);font-weight:600}
.spark-card svg{width:100%;height:60px;display:block}
.spark-card .spark-meta{font-size:.7rem;color:var(--muted);margin-top:.4rem;display:flex;justify-content:space-between}
</style>
</head>
<body>
<header>
  <h1>ISPC Admin</h1>
  <div>
    <span class="who" id="who"></span>
    <a class="logout" href="/cdn-cgi/access/logout">Sign out</a>
  </div>
</header>
<main>
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected="true" data-tab="submissions">Submissions <span class="count" id="count-sub">0</span></button>
    <button role="tab" aria-selected="false" data-tab="feedback">Feedback <span class="count" id="count-fb">0</span></button>
    <button role="tab" aria-selected="false" data-tab="stories">Stories <span class="count" id="count-stories">0</span></button>
    <button role="tab" aria-selected="false" data-tab="news">News <span class="count" id="count-news">0</span></button>
    <button role="tab" aria-selected="false" data-tab="alerts">Alerts <span class="count" id="count-alerts">0</span></button>
    <button role="tab" aria-selected="false" data-tab="analytics">Analytics</button>
  </div>

  <section id="panel-submissions" class="panel" data-active>
    <div id="submissions-list" class="empty">Loading…</div>
  </section>

  <section id="panel-feedback" class="panel">
    <div id="feedback-list" class="empty">Loading…</div>
  </section>

  <section id="panel-stories" class="panel">
    <div class="toolbar">
      <span class="left">Published stories on the live site. Editing or deleting commits to the site repo and triggers a rebuild.</span>
    </div>
    <div id="stories-list" class="empty">Loading…</div>
    <div id="stories-editor"></div>
  </section>

  <section id="panel-news" class="panel">
    <div class="toolbar">
      <span class="left">News posts on the live site.</span>
      <button class="btn primary" id="news-create-btn">+ New post</button>
    </div>
    <div id="news-list" class="empty">Loading…</div>
    <div id="news-editor"></div>
  </section>

  <section id="panel-alerts" class="panel">
    <div class="toolbar">
      <span class="left">Security alerts & LGBTQ+ Iraq news. The RSS aggregator runs every 6 hours and creates pending issues for review.</span>
      <button class="btn primary" id="alerts-create-btn">+ New alert</button>
    </div>
    <div id="alerts-list" class="empty">Loading…</div>
    <div id="alerts-editor"></div>
  </section>

  <section id="panel-analytics" class="panel">
    <div class="toolbar">
      <span class="left">From Plausible. Opt-in only — visitors who declined consent are not counted.</span>
      <div class="period-buttons">
        <button class="btn period" data-period="day">Today</button>
        <button class="btn period" data-period="7d" aria-pressed="true">7 days</button>
        <button class="btn period" data-period="30d">30 days</button>
        <button class="btn period" data-period="month">Month</button>
        <button class="btn period" data-period="6mo">6 months</button>
        <button class="btn period" data-period="all">All</button>
      </div>
    </div>
    <div id="analytics-content" class="empty">Click Analytics to load.</div>
  </section>
</main>
<div id="toast" class="toast" hidden></div>
<script>
(function(){
  function $(id){return document.getElementById(id)}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function toast(msg){var t=$('toast');t.textContent=msg;t.hidden=false;setTimeout(function(){t.hidden=true},2400)}
  function todayISO(){return new Date().toISOString().slice(0,10)}

  fetch('/cdn-cgi/access/get-identity',{credentials:'include'})
    .then(function(r){return r.ok?r.json():null})
    .then(function(d){if(d&&d.email)$('who').textContent=d.email})
    .catch(function(){});

  // ---------- Submissions / Feedback (issue-backed) ----------
  function renderIssueList(container,items,kind){
    if(!items.length){container.innerHTML='<div class="empty">No items.</div>';return}
    container.innerHTML=items.map(function(it){
      var date=new Date(it.created_at).toLocaleString();
      var actions = kind==='submissions'
        ? '<button class="approve" data-act="approve" data-id="'+it.number+'">Approve & Publish</button>'
          +'<button class="reject" data-act="reject" data-id="'+it.number+'">Reject</button>'
          +'<a class="gh" href="'+esc(it.html_url)+'" target="_blank" rel="noopener noreferrer">Open in GitHub</a>'
        : '<button data-act="close" data-id="'+it.number+'">Mark resolved</button>'
          +'<a class="gh" href="'+esc(it.html_url)+'" target="_blank" rel="noopener noreferrer">Open in GitHub</a>';
      return '<article class="item">'
        +'<h3>#'+it.number+' '+esc(it.title)+'</h3>'
        +'<div class="meta">'+date+'</div>'
        +'<div class="body">'+esc(it.body||'')+'</div>'
        +'<div class="actions">'+actions+'</div>'
        +'</article>';
    }).join('');
    container.querySelectorAll('button[data-act]').forEach(function(btn){
      btn.addEventListener('click',function(){
        var act=btn.getAttribute('data-act');
        var id=btn.getAttribute('data-id');
        if(!confirm('Confirm '+act+' on #'+id+'?')) return;
        btn.disabled=true;
        fetch('/admin/api/issues/'+id+'/'+act,{method:'POST',credentials:'include'})
          .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})})
          .then(function(x){if(!x.ok)throw new Error(x.d.message||'failed');toast('Done.');loadIssues()})
          .catch(function(e){btn.disabled=false;alert('Failed: '+(e.message||e))});
      });
    });
  }
  function loadIssues(){
    fetch('/admin/api/submissions',{credentials:'include'}).then(function(r){return r.json()})
      .then(function(d){var items=d.issues||[];$('count-sub').textContent=items.length;renderIssueList($('submissions-list'),items,'submissions')})
      .catch(function(){$('submissions-list').innerHTML='<div class="err">Failed to load submissions.</div>'});
    fetch('/admin/api/feedback',{credentials:'include'}).then(function(r){return r.json()})
      .then(function(d){var items=d.issues||[];$('count-fb').textContent=items.length;renderIssueList($('feedback-list'),items,'feedback')})
      .catch(function(){$('feedback-list').innerHTML='<div class="err">Failed to load feedback.</div>'});
  }

  // ---------- Content (stories / news, file-backed) ----------
  function panelIdForKind(kind){
    if(kind==='stories') return 'stories';
    if(kind==='news') return 'news';
    if(kind==='alerts') return 'alerts';
    return kind;
  }
  function renderContentList(container,items,kind){
    if(!items.length){container.innerHTML='<div class="empty">No '+kind+' published yet.</div>';return}
    container.innerHTML=items.map(function(it){
      return '<div class="row">'
        +'<span class="badge '+esc(it.lang)+'">'+esc(it.lang)+'</span>'
        +'<div class="info">'
          +'<div class="title">'+esc(it.title)+(it.draft?' <span class="badge draft">draft</span>':'')+'</div>'
          +'<div class="sub">'+esc(it.path)+(it.pubDate?' · '+esc(it.pubDate):'')+'</div>'
        +'</div>'
        +'<div class="row-actions">'
          +'<button class="btn" data-act="edit" data-lang="'+esc(it.lang)+'" data-slug="'+esc(it.slug)+'">Edit</button>'
          +'<button class="btn danger" data-act="delete" data-lang="'+esc(it.lang)+'" data-slug="'+esc(it.slug)+'" data-sha="'+esc(it.sha)+'">Delete</button>'
        +'</div>'
      +'</div>';
    }).join('');
    container.querySelectorAll('button[data-act="edit"]').forEach(function(btn){
      btn.addEventListener('click',function(){openEditor(kind,btn.dataset.lang,btn.dataset.slug)})
    });
    container.querySelectorAll('button[data-act="delete"]').forEach(function(btn){
      btn.addEventListener('click',function(){
        if(!confirm('Delete '+kind+' '+btn.dataset.lang+'/'+btn.dataset.slug+'? This commits a deletion to the site repo.')) return;
        btn.disabled=true;
        fetch('/admin/api/content/'+kind+'/'+btn.dataset.lang+'/'+btn.dataset.slug,{
          method:'DELETE',credentials:'include',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({sha:btn.dataset.sha})
        })
        .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})})
        .then(function(x){if(!x.ok)throw new Error(x.d.error||x.d.message||'failed');toast('Deleted.');loadContent(kind)})
        .catch(function(e){btn.disabled=false;alert('Failed: '+(e.message||e))});
      });
    });
  }
  function loadContent(kind){
    var panel = panelIdForKind(kind);
    fetch('/admin/api/content/'+kind,{credentials:'include'}).then(function(r){return r.json()})
      .then(function(d){var items=d.items||[];$('count-'+panel).textContent=items.length;renderContentList($(panel+'-list'),items,kind)})
      .catch(function(){$(panel+'-list').innerHTML='<div class="err">Failed to load '+kind+'.</div>'});
  }

  function openEditor(kind,lang,slug,template){
    var panel = panelIdForKind(kind);
    var listId = panel+'-list';
    var editorId = panel+'-editor';
    var editor = $(editorId);
    var list = $(listId);
    list.style.display='none';
    var isCreate = !slug;
    var heading = isCreate ? 'New '+kind+' post' : 'Edit '+kind+'/'+lang+'/'+slug;
    var pathHint = kind==='news' ? 'news' : (kind==='alerts' ? 'security-alerts' : 'stories');
    editor.innerHTML =
      '<div class="editor">'
      +'<h2>'+esc(heading)+'</h2>'
      +(isCreate
        ? '<div class="field"><label>Language</label><select id="ed-lang"><option value="en">en</option><option value="ar">ar</option></select></div>'
          +'<div class="field"><label>Slug (lowercase, digits, hyphen — used in URL)</label><input id="ed-slug" type="text" maxlength="80" placeholder="my-post-slug"><div class="help">Only [a-z0-9-]. Will live at /'+esc(pathHint)+'/{slug}.</div></div>'
        : '')
      +'<div class="field"><label>Markdown (must include frontmatter)</label><textarea id="ed-content" spellcheck="false"></textarea><div class="help">Frontmatter must include title, description, lang, pubDate. Stories also need anonymous; alerts need severity (critical|high|medium|low|info) and category.</div></div>'
      +'<div class="editor-actions">'
        +'<button class="btn primary" id="ed-save">Save</button>'
        +'<button class="btn" id="ed-cancel">Cancel</button>'
      +'</div>'
      +'<p id="ed-status" class="help"></p>'
      +'</div>';

    function close(){ editor.innerHTML=''; list.style.display=''; }

    if(isCreate){
      var defaultTemplate;
      if (kind==='news') {
        defaultTemplate = '---\\ntitle: ""\\ndescription: ""\\nlang: en\\npubDate: '+todayISO()+'\\ndraft: true\\n---\\n\\nWrite the post body here.\\n';
      } else if (kind==='alerts') {
        defaultTemplate = '---\\ntitle: ""\\ndescription: ""\\nlang: en\\npubDate: '+todayISO()+'\\nseverity: medium\\ncategory: news\\nsource: ""\\nsourceUrl: ""\\naffected: ""\\ndraft: true\\n---\\n\\nAlert body. Use ## headings.\\n';
      } else {
        defaultTemplate = '---\\ntitle: ""\\ndescription: ""\\nlang: en\\npubDate: '+todayISO()+'\\nanonymous: true\\ndraft: true\\n---\\n\\nWrite here.\\n';
      }
      defaultTemplate = template || defaultTemplate;
      $('ed-content').value = defaultTemplate.replace(/\\\\n/g,'\\n');
      $('ed-cancel').addEventListener('click',close);
      $('ed-save').addEventListener('click',function(){
        var lang = $('ed-lang').value;
        var slug = $('ed-slug').value.trim();
        var content = $('ed-content').value;
        if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)){ $('ed-status').textContent='Bad slug.'; return; }
        $('ed-save').disabled=true;
        fetch('/admin/api/content/'+kind,{
          method:'POST',credentials:'include',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({lang:lang,slug:slug,content:content})
        })
        .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})})
        .then(function(x){if(!x.ok)throw new Error(x.d.error||x.d.message||'failed');toast('Created. Site rebuilds in ~2 min.');close();loadContent(kind)})
        .catch(function(e){$('ed-save').disabled=false;$('ed-status').textContent='Failed: '+(e.message||e)});
      });
    } else {
      // Load existing
      fetch('/admin/api/content/'+kind+'/'+lang+'/'+slug,{credentials:'include'})
        .then(function(r){return r.json()})
        .then(function(d){
          if(d.error){$('ed-status').textContent='Failed: '+d.error;return}
          $('ed-content').value = d.content || '';
          var sha = d.sha;
          $('ed-cancel').addEventListener('click',close);
          $('ed-save').addEventListener('click',function(){
            var content = $('ed-content').value;
            $('ed-save').disabled=true;
            fetch('/admin/api/content/'+kind+'/'+lang+'/'+slug,{
              method:'PUT',credentials:'include',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({content:content,sha:sha})
            })
            .then(function(r){return r.json().then(function(j){return {ok:r.ok,d:j}})})
            .then(function(x){if(!x.ok)throw new Error(x.d.error||x.d.message||'failed');toast('Saved. Site rebuilds in ~2 min.');close();loadContent(kind)})
            .catch(function(e){$('ed-save').disabled=false;$('ed-status').textContent='Failed: '+(e.message||e)});
          });
        });
    }
  }

  $('news-create-btn').addEventListener('click',function(){openEditor('news',null,null)});
  $('alerts-create-btn').addEventListener('click',function(){openEditor('alerts',null,null)});

  // ---------- Analytics ----------
  function fmtDuration(seconds){
    if(!seconds||isNaN(seconds))return '—';
    var s = Math.round(seconds);
    if(s<60) return s+'s';
    var m=Math.floor(s/60), r=s%60;
    if(m<60) return m+'m '+r+'s';
    var h=Math.floor(m/60), rm=m%60;
    return h+'h '+rm+'m';
  }
  function fmtPct(x){ if(x==null||isNaN(x))return '—'; return Math.round(x)+'%' }
  function fmtNum(x){ if(x==null||isNaN(x))return '—'; return new Intl.NumberFormat().format(x) }

  function renderTable(items, valueIdx){
    if(!items||!items.length) return '<div class="empty" style="padding:1rem">No data.</div>';
    var rows = items.map(function(r){
      var label = r.dimensions[0] || '—';
      return '<tr><td class="label" title="'+esc(label)+'">'+esc(label)+'</td><td class="num">'+fmtNum(r.metrics[valueIdx||0])+'</td></tr>';
    }).join('');
    return '<table class="stats-table">'+rows+'</table>';
  }

  function sparkline(series){
    if(!series||!series.length) return '';
    var max = Math.max.apply(null, series.map(function(p){return p.metrics[0]||0}));
    if(max===0) max=1;
    var w=800, h=60;
    var step = w/Math.max(1, series.length-1);
    var pts = series.map(function(p,i){ var v=p.metrics[0]||0; return i*step+','+(h-(v/max)*h); }).join(' ');
    var areaPts = '0,'+h+' '+pts+' '+w+','+h;
    return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'
      +'<polygon points="'+areaPts+'" fill="#b85c38" fill-opacity="0.15"/>'
      +'<polyline points="'+pts+'" fill="none" stroke="#0d1b2e" stroke-width="2" vector-effect="non-scaling-stroke"/>'
      +'</svg>';
  }

  var currentPeriod = '7d';
  function loadAnalytics(period){
    currentPeriod = period;
    document.querySelectorAll('.btn.period').forEach(function(b){
      b.setAttribute('aria-pressed', b.getAttribute('data-period')===period ? 'true':'false');
    });
    var c = $('analytics-content');
    c.innerHTML = '<div class="empty">Loading…</div>';
    fetch('/admin/api/analytics?period='+encodeURIComponent(period),{credentials:'include'})
      .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})})
      .then(function(x){
        if(!x.ok){
          c.innerHTML = '<div class="err">Failed: '+esc(x.d.message||x.d.error||'unknown')+'</div>';
          return;
        }
        var d = x.d;
        var aggMetrics = (d.aggregate && d.aggregate.results && d.aggregate.results[0] && d.aggregate.results[0].metrics) || [0,0,0,0];
        var visitors = aggMetrics[0], pageviews = aggMetrics[1], bounce = aggMetrics[2], duration = aggMetrics[3];
        var ts = (d.timeseries && d.timeseries.results) || [];
        var firstDate = ts[0]?ts[0].dimensions[0]:'';
        var lastDate = ts[ts.length-1]?ts[ts.length-1].dimensions[0]:'';

        c.innerHTML =
          '<div class="kpis">'
            +'<div class="kpi"><div class="label">Unique visitors</div><div class="value">'+fmtNum(visitors)+'</div></div>'
            +'<div class="kpi"><div class="label">Pageviews</div><div class="value">'+fmtNum(pageviews)+'</div></div>'
            +'<div class="kpi"><div class="label">Bounce rate</div><div class="value">'+fmtPct(bounce)+'</div></div>'
            +'<div class="kpi"><div class="label">Avg visit duration</div><div class="value">'+esc(fmtDuration(duration))+'</div></div>'
          +'</div>'
          +(ts.length
            ? '<div class="spark-card"><h3>Visitors over time</h3>'+sparkline(ts)+'<div class="spark-meta"><span>'+esc(firstDate)+'</span><span>'+esc(lastDate)+'</span></div></div>'
            : '')
          +'<div class="tables">'
            +'<div class="table-card"><h3>Top pages</h3>'+renderTable((d.topPages&&d.topPages.results)||[], 0)+'</div>'
            +'<div class="table-card"><h3>Top countries</h3>'+renderTable((d.topCountries&&d.topCountries.results)||[], 0)+'</div>'
          +'</div>'
          +'<div class="tables" style="margin-top:.85rem">'
            +'<div class="table-card"><h3>Top traffic sources</h3>'+renderTable((d.topSources&&d.topSources.results)||[], 0)+'</div>'
            +'<div class="table-card"><h3>Range</h3><table class="stats-table">'
              +'<tr><td class="label">Period</td><td class="num">'+esc(d.period||period)+'</td></tr>'
              +(firstDate?'<tr><td class="label">First day</td><td class="num">'+esc(firstDate)+'</td></tr>':'')
              +(lastDate?'<tr><td class="label">Last day</td><td class="num">'+esc(lastDate)+'</td></tr>':'')
            +'</table></div>'
          +'</div>';
      })
      .catch(function(e){c.innerHTML = '<div class="err">Failed: '+esc(e.message||e)+'</div>'});
  }

  document.querySelectorAll('.btn.period').forEach(function(btn){
    btn.addEventListener('click',function(){loadAnalytics(btn.getAttribute('data-period'))});
  });

  // ---------- Tab switching ----------
  document.querySelectorAll('.tabs button').forEach(function(btn){
    btn.addEventListener('click',function(){
      document.querySelectorAll('.tabs button').forEach(function(b){b.setAttribute('aria-selected','false')});
      btn.setAttribute('aria-selected','true');
      var name=btn.getAttribute('data-tab');
      document.querySelectorAll('.panel').forEach(function(p){p.removeAttribute('data-active')});
      $('panel-'+name).setAttribute('data-active','');
      if(name==='stories') loadContent('stories');
      if(name==='news') loadContent('news');
      if(name==='alerts') loadContent('alerts');
      if(name==='analytics') loadAnalytics(currentPeriod);
    });
  });

  // Initial load
  loadIssues();
  // Lazy: load stories/news only when tab is clicked, but show counts now
  fetch('/admin/api/content/stories',{credentials:'include'}).then(function(r){return r.json()}).then(function(d){if(d.items)$('count-stories').textContent=d.items.length}).catch(function(){});
  fetch('/admin/api/content/news',{credentials:'include'}).then(function(r){return r.json()}).then(function(d){if(d.items)$('count-news').textContent=d.items.length}).catch(function(){});
})();
</script>
</body>
</html>`;
}
