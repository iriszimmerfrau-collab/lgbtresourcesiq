/**
 * Per-slug Wikidata entity overlays for guides and alerts. Centralised so
 * en/ar/ckb route templates share identical entity hints — the language
 * differs, but the underlying Wikidata entities are universal.
 *
 * When adding a new guide or alert slug, map it here so the page's JSON-LD
 * `about` / `mentions` reference Wikidata IDs that AI answer engines can
 * resolve without inferring from the prose.
 */

import type { EntityKey } from './jsonld';

interface EntityOverlay {
  about?: readonly EntityKey[];
  mentions?: readonly EntityKey[];
}

export const GUIDE_ENTITY_OVERLAYS: Record<string, EntityOverlay> = {
  'hrt-overview': { about: ['hrt', 'genderDysphoria', 'transgender'], mentions: ['iraq', 'estradiol', 'cyproteroneAcetate', 'bicalutamide', 'spironolactone', 'testosterone'] },
  'hrt-what-is-hrt': { about: ['hrt'], mentions: ['estradiol', 'testosterone', 'cyproteroneAcetate'] },
  'hrt-feminizing': { about: ['hrt', 'estradiol'], mentions: ['cyproteroneAcetate', 'bicalutamide', 'spironolactone', 'finasteride', 'iraq'] },
  'hrt-masculinizing': { about: ['hrt', 'testosterone'], mentions: ['iraq'] },
  'hrt-sourcing-iraq': { about: ['hrt', 'iraq'], mentions: ['estradiol', 'cyproteroneAcetate', 'bicalutamide'] },
  'hrt-pharmacy-script': { about: ['hrt', 'iraq'], mentions: ['estradiol', 'cyproteroneAcetate'] },
  'hrt-monitoring': { about: ['hrt'], mentions: ['estradiol', 'testosterone', 'iraq'] },
  'hrt-risks': { about: ['hrt'], mentions: ['cyproteroneAcetate', 'estradiol', 'testosterone'] },
  'mental-health': { about: ['depression', 'anxiety', 'genderDysphoria'], mentions: ['iraq', 'transgender', 'lgbtRightsIraq'] },
  'honor-violence': { about: ['honorKilling', 'lgbtRightsIraq'], mentions: ['iraq', 'iraqiKurdistan', 'asylumSeeker'] },
  'gender': { about: ['genderIdentity'], mentions: ['transgender'] },
  'gender-spectrum': { about: ['genderIdentity'], mentions: ['transgender'] },
  'sex-vs-gender': { about: ['genderIdentity'] },
  'sex-biological': { about: ['genderIdentity'] },
  'sexual-orientation': { about: ['lgbtRightsIraq'] },
  'sexual-spectrum': { about: ['lgbtRightsIraq'] },
  'lgbtqia-education': { about: ['lgbtRightsIraq'], mentions: ['iraq'] },
  'lgbtqia-history': { mentions: ['iraq', 'lgbtRightsIraq'] },
  'arabic-neopronouns': { mentions: ['iraq'] },
  'pronouns': {},
  'inclusive-language': {},
};

export const ALERT_ENTITY_OVERLAYS: Record<string, EntityOverlay> = {
  'law-14-2024-passed': { about: ['lgbtRightsIraq'], mentions: ['iraq'] },
  'airport-phone-search-pattern': { about: ['lgbtRightsIraq'], mentions: ['iraq', 'baghdad'] },
  'dating-app-entrapment-pattern': { about: ['lgbtRightsIraq', 'honorKilling'], mentions: ['iraq', 'baghdad'] },
  'asylum-pathways-2024-2025': { about: ['asylumSeeker', 'lgbtRightsIraq'], mentions: ['iraq'] },
  'trans-healthcare-pharmacy-shift': { about: ['hrt', 'lgbtRightsIraq'], mentions: ['iraq', 'estradiol'] },
  'hrw-2009-they-want-us-exterminated': { about: ['lgbtRightsIraq', 'honorKilling'], mentions: ['iraq'] },
  'media-commission-terminology-order-2024': { about: ['lgbtRightsIraq'], mentions: ['iraq'] },
  'online-platform-blocking-history': { about: ['lgbtRightsIraq'], mentions: ['iraq'] },
  'un-upr-iraq-2024-recommendations': { about: ['lgbtRightsIraq'], mentions: ['iraq'] },
};

export function guideEntityHints(slug: string): EntityOverlay {
  return GUIDE_ENTITY_OVERLAYS[slug] ?? {};
}

export function alertEntityHints(slug: string): EntityOverlay {
  return ALERT_ENTITY_OVERLAYS[slug] ?? {};
}
