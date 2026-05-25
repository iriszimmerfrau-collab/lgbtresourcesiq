/**
 * UI string dictionary assembler.
 *
 * The actual strings live in per-language files under ./strings/:
 *   - strings/en.ts    — English (defines the canonical key set + UiKey type)
 *   - strings/ar.ts    — Arabic
 *   - strings/ckb.ts   — Central Kurdish (Sorani)
 *
 * Edit those files to change copy. This file just combines them into one
 * lookup table consumed by t(lang, key) in ./utils.ts. The `satisfies`
 * clauses in ar.ts and ckb.ts ensure every language has every key.
 */
import { en, type UiKey } from './strings/en';
import { ar } from './strings/ar';
import { ckb } from './strings/ckb';

export const ui = { en, ar, ckb } as const;
export type { UiKey };
