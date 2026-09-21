// frontend/src/lib/avatars/artwork.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AVATAR_COLLECTIONS } from './catalog';

const DIR = join(process.cwd(), 'public', 'avatars', 'house');
const all = AVATAR_COLLECTIONS.flatMap((c) => c.pieces.map((p) => ({ ...p, collection: c.key })));

describe('avatar artwork', () => {
  it('has a unique slug for every piece across all collections', () => {
    const ids = all.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(all)('$id has a file on disk', ({ id }) => {
    expect(existsSync(join(DIR, `${id}.svg`))).toBe(true);
  });

  it.each(all)('$id obeys the canvas contract', ({ id }) => {
    const svg = readFileSync(join(DIR, `${id}.svg`), 'utf8');

    expect(svg).toContain('viewBox="0 0 200 200"');
    // No fixed size: the tile decides how big this renders.
    expect(/<svg[^>]*\swidth=/.test(svg)).toBe(false);
    expect(/<svg[^>]*\sheight=/.test(svg)).toBe(false);
    // A full-bleed field, never a background circle.
    expect(/<rect[^>]*width="200"[^>]*height="200"/.test(svg)).toBe(true);
    expect(/<circle[^>]*r="100"/.test(svg)).toBe(false);
    // Gold is the selection signal, not a pigment.
    expect(svg.toUpperCase()).not.toContain('#C9A86A');
    // Renders through <img>: inherits nothing from the document.
    expect(svg).not.toContain('currentColor');
    expect(svg).not.toContain('<style');
    expect(svg).not.toContain('class=');
  });
});
