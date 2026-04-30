// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// IMPORTANT: Replace `site` with the actual deployment URL before launch.
// If deploying to a project subpath on GitHub Pages, also set `base: '/repo-name'`.
export default defineConfig({
  site: 'https://example.com',
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
