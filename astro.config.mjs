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
    locales: ['en', 'ar'],
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
        locales: { en: 'en-US', ar: 'ar-IQ' },
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
