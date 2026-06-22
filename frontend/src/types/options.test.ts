import { describe, it, expect } from 'vitest';
import { GENRE_OPTIONS, PROVIDER_OPTIONS, ORIGIN_OPTIONS, COMPANY_OPTIONS, COLLECTION_OPTIONS } from './index';

describe('catalog option constants', () => {
  it('GENRE_OPTIONS uses canonical movie ids, not TV-only ids', () => {
    const values = GENRE_OPTIONS.map((o) => o.value);
    expect(values).toContain(28);   // Action
    expect(values).toContain(878);  // Sci-Fi
    expect(values).toContain(37);   // Western
    expect(values).not.toContain(10759); // TV-only Action & Adventure
    expect(values).not.toContain(10765); // TV-only Sci-Fi & Fantasy
  });

  it('ORIGIN_OPTIONS includes anime as a string value', () => {
    expect(ORIGIN_OPTIONS.map((o) => o.value)).toContain('anime');
    expect(ORIGIN_OPTIONS.map((o) => o.value)).toContain('KR');
  });

  it('PROVIDER/COMPANY/COLLECTION carry the spec ids', () => {
    expect(PROVIDER_OPTIONS.find((o) => o.label === 'Netflix')?.value).toBe(8);
    expect(COMPANY_OPTIONS.find((o) => o.label === 'A24')?.value).toBe(41077);
    expect(COLLECTION_OPTIONS.find((o) => o.label === 'The Avengers')?.value).toBe(86311);
  });
});
