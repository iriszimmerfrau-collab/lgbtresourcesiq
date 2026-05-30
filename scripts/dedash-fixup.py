#!/usr/bin/env python3
"""
Second-pass fixup for dedash.py: catches sentences that start with a
lowercase letter after a period because markdown emphasis (** or _ or *) or
a link bracket sat between the period and the first word.

Patterns fixed:
    ". **this ..." -> ". **This ..."
    ". *foo* ..."  -> ". *Foo* ..."
    ". [link]..."  -> ". [Link]..."
    ". `code`..."  -> ". `Code`..."  (rare; code spans are usually identifiers)

Heuristic: only uppercase ASCII a-z. Arabic and Sorani have no case so this
is a no-op there. Code spans starting with identifier chars (which often
look uppercase-correct already, e.g. `Estrofem`) are mostly fine; the rare
all-lowercase identifier after a period (e.g. `getElementById`) is left
alone — we don't want to mangle actual code references.

Only run after dedash.py.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

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

EXCLUDE = {
    ROOT / 'src/content/stories/story-7.md',
}

# Period (or ! or ?) followed by space, optional markdown emphasis chars or
# link bracket, then a lowercase ASCII letter we want to uppercase.
PATTERN = re.compile(r'([.!?]\s+)([*_`\[]*)([a-z])')

def fix(match: re.Match) -> str:
    return match.group(1) + match.group(2) + match.group(3).upper()

def main() -> int:
    changed = 0
    for f in TARGETS:
        if f in EXCLUDE or not f.is_file():
            continue
        try:
            original = f.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        new = PATTERN.sub(fix, original)
        if new != original:
            f.write_text(new, encoding='utf-8')
            changed += 1
            print(f'  fixed {f.relative_to(ROOT)}')
    print(f'\nFiles touched: {changed}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
