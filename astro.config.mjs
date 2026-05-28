// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { remarkBasePrefix } from './src/lib/remark-base-prefix.mjs';

const BASE = '';

export default defineConfig({
  site: 'https://ispc-iq.org',
  markdown: {
    remarkPlugins: [remarkBasePrefix(BASE)],
  },
  i18n: {
    locales: ['en', 'ar', 'ckb'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
  integrations: [
    mdx(),
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en-US', ar: 'ar-IQ', ckb: 'ckb-IQ' },
      },
      /**
       * SEO priority signalling. Search engines treat this as a *relative*
       * hint within the site — uniform 0.5 across every URL (the @astrojs
       * default) wastes the signal. We weight HRT and safety highest because
       * those are the YMYL queries we want surfaced first; news and alerts
       * change frequently but are individually lower-priority than the
       * evergreen guides.
       */
      changefreq: 'weekly',
      priority: 0.7,
      serialize(item) {
        const u = item.url;
        // Homepage(s) and section landing pages are the highest discovery
        // surface for new readers.
        if (/\/(en|ar|ckb)\/?$/.test(u)) {
          return { ...item, priority: 1.0, changefreq: 'weekly' };
        }
        // HRT + safety guides — the evergreen YMYL content we most want
        // AI engines and search engines to weigh.
        if (/\/(en|ar|ckb)\/guides\/(hrt-|honor-violence|mental-health)/.test(u)) {
          return { ...item, priority: 0.95, changefreq: 'monthly' };
        }
        // FAQ + safety + community + about — the high-intent entry pages.
        if (/\/(en|ar|ckb)\/(faq|safety|community|about)\/?$/.test(u)) {
          return { ...item, priority: 0.9, changefreq: 'monthly' };
        }
        // Identity / education guides — evergreen, slightly lower than HRT.
        if (/\/(en|ar|ckb)\/guides\//.test(u)) {
          return { ...item, priority: 0.8, changefreq: 'monthly' };
        }
        // Security alerts — critical context but each item is one of many.
        if (/\/(en|ar|ckb)\/security-alerts\/[^/]+\/?$/.test(u)) {
          return { ...item, priority: 0.7, changefreq: 'monthly' };
        }
        // Listing pages (alert index, guides index, stories index, news index)
        if (/\/(en|ar|ckb)\/(security-alerts|guides|stories|news)\/?$/.test(u)) {
          return { ...item, priority: 0.85, changefreq: 'weekly' };
        }
        // Individual news + stories. Stories now live at the canonical
        // un-prefixed /stories/{slug}/ URL — the per-language /{lang}/stories/
        // routes are listing surfaces only.
        if (/\/(en|ar|ckb)\/news\//.test(u) || /^https?:\/\/[^/]+\/stories\/[^/]+\/?$/.test(u)) {
          return { ...item, priority: 0.6, changefreq: 'yearly' };
        }
        // Privacy / feedback / stories-submit — low-priority utility pages.
        if (/\/(en|ar|ckb)\/(privacy|feedback)/.test(u)) {
          return { ...item, priority: 0.4, changefreq: 'yearly' };
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
