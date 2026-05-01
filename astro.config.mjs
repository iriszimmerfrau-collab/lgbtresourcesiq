// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Production deployment domain. Update if/when domain changes.
// If deploying to a project subpath on GitHub Pages, also set `base: '/repo-name'`.
export default defineConfig({
  site: 'https://iriszimmerfrau-collab.github.io',
  base: '/lgbtresourcesiq',
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
