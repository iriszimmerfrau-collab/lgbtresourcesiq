// Rewrites markdown links that start with `/en/` or `/ar/` to be base-prefixed.
// Example: `/en/guides/foo` → `/lgbtresourcesiq/en/guides/foo` when base = `/lgbtresourcesiq`.
// No-op when base is `/` or empty.
import { visit } from 'unist-util-visit';

export function remarkBasePrefix(base) {
  const prefix = (base ?? '').replace(/\/$/, '');
  return () => (tree) => {
    if (!prefix) return;
    visit(tree, 'link', (node) => {
      if (typeof node.url !== 'string') return;
      if (/^\/(en|ar)(\/|$)/.test(node.url)) {
        node.url = `${prefix}${node.url}`;
      }
    });
  };
}
