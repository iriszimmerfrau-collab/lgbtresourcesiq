#!/usr/bin/env python3
"""
One-shot em-dash + en-dash cleanup pass across the site's user-facing copy.

Strategy
--------
Em-dash (U+2014) usage tells the reader "AI wrote this" — even when it's
typographically correct. We rewrite by context so the result reads like
prose a human wrote, not by mechanically substituting one punctuation
character for another.

Rules applied per file:

  " — " (space-em-space)
      Most common. Functions as a sentence break or strong pause. Replace
      with ". " and uppercase the following letter when it's a Latin
      letter (Arabic and Sorani have no case so they're left alone).

  "— " at line start
      Signature lines like "— The collective". Replace with "" so the
      signature becomes naked (we'll often want to delete the line by
      hand later).

  "—" with no surrounding spaces
      Rare. Replace with comma + space.

  "N–M" numeric range (en-dash U+2013 between digits)
      Convert to "N-M" (ASCII hyphen). Iraqi readers see this in dosing
      tables and prices; the typographically-correct en dash flags as AI
      polish.

  " – " (space en-dash space)
      Treat the same as " — ": replace with ". " + caps.

Files touched:
  - src/content/{guides,alerts,news,stories}/**/*.md
  - src/pages/**/*.astro
  - src/components/**/*.astro
  - src/i18n/strings/*.ts
  - public/llms.txt
  - public/humans.txt

Files SKIPPED:
  - src/content/stories/story-7.md (real user submission — don't touch their voice)
  - scripts/** (this script itself)
  - any file in node_modules/dist/.astro
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

EM = '—'
EN = '–'

# Files that get processed
TARGETS: list[Path] = []
for pattern in [
    'src/content/guides/**/*.md',
    'src/content/alerts/**/*.md',
    'src/content/news/**/*.md',
    'src/pages/**/*.astro',
    'src/components/**/*.astro',
    'src/i18n/strings/*.ts',
    'public/llms.txt',
    'public/humans.txt',
]:
    TARGETS.extend(ROOT.glob(pattern))

# Files that are off-limits
EXCLUDE = {
    ROOT / 'src/content/stories/story-7.md',
}

def caps_following(match: re.Match) -> str:
    """For ' — Foo' -> '. Foo' and ' — foo' -> '. Foo'. Arabic chars pass through."""
    char = match.group(1)
    return '. ' + char.upper()

def process(text: str) -> str:
    # 1. Strip em-dash signature prefix at line start: "— Name" -> "Name"
    #    This handles both bare em-dash and space-em-space at line start.
    text = re.sub(rf'^{re.escape(EM)}\s*', '', text, flags=re.MULTILINE)

    # 2. Space-em-space joining two clauses: "...X — Y..." -> "...X. Y..."
    #    Uppercase the next character so the new sentence reads cleanly.
    text = re.sub(rf' {re.escape(EM)} (.)', caps_following, text)

    # 3. Space-en-space joining: same treatment.
    text = re.sub(rf' {re.escape(EN)} (.)', caps_following, text)

    # 4. Em-dash without surrounding spaces — comma it.
    text = text.replace(EM, ', ')

    # 5. Numeric en-dash range: "1–3 days" -> "1-3 days"
    text = re.sub(rf'(\d){re.escape(EN)}(\d)', r'\1-\2', text)

    # 6. Any remaining en-dashes (rare) — hyphen.
    text = text.replace(EN, '-')

    # 7. Collapse the case where step 2/3 produced ". A. word" patterns from
    #    something like "X — A — B". After two passes the period chain is
    #    already correct; nothing to do here. Leave double-period checks to
    #    a manual pass if they show up.

    return text

def main() -> int:
    changed = 0
    total = 0
    for f in TARGETS:
        if f in EXCLUDE:
            continue
        if not f.is_file():
            continue
        try:
            original = f.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            print(f'skip (not utf-8): {f.relative_to(ROOT)}')
            continue
        new = process(original)
        if new != original:
            f.write_text(new, encoding='utf-8')
            changed += 1
            before = original.count(EM) + original.count(EN)
            after = new.count(EM) + new.count(EN)
            print(f'  {f.relative_to(ROOT)}: {before} -> {after}')
            total += before - after
    print(f'\nFiles changed: {changed}')
    print(f'Dashes removed: {total}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
