// frontend/src/lib/feedThemes/resolveFeedTheme.ts
import { BrowseParams } from '@/types';
import { FeedIdentity, FeedTheme } from './types';
import { FEED_THEMES } from './registry';

/** Treat 0 / '0' / undefined / null as "not set". */
function present(v: number | string | undefined | null): v is number | string {
  return v != null && v !== 0 && v !== '0';
}

/**
 * TMDB genre id → canonical theme slug. Folds movie AND TV ids of the same
 * genre into one slug (e.g. Action is movie 28 / TV 10759; Sci-Fi is movie 878
 * / TV "Sci-Fi & Fantasy" 10765). Only THEMED genres appear here — any genre
 * not listed resolves to `undefined` and stays neutral gold.
 */
const GENRE_ID_TO_SLUG: Record<string, string> = {
  '27': 'horror',
  '878': 'scifi',
  '10765': 'scifi', // TV: Sci-Fi & Fantasy
  '28': 'action',
  '12': 'action', // Adventure folds into Action & Adventure
  '10759': 'action', // TV: Action & Adventure
  '10749': 'romance',
  '80': 'crime',
  '53': 'crime', // Thriller shares the noir look
  '35': 'comedy',
  '14': 'fantasy',
  '37': 'western',
};

/** Slugs that the home page already uses as rail keys (e.g. "genre-scifi"). */
const GENRE_SLUGS = new Set(Object.values(GENRE_ID_TO_SLUG));

/** Map a raw genre token (numeric tmdb id or slug) → canonical themed slug. */
function genreSlug(token: string): string | undefined {
  const id = token.trim();
  if (GENRE_ID_TO_SLUG[id]) return GENRE_ID_TO_SLUG[id];
  return GENRE_SLUGS.has(id) ? id : undefined;
}

/**
 * Preferred path: derive a feed identity from the structured browse params.
 * Order is company → collection → provider; first match wins.
 */
export function feedIdentityFromParams(
  params: BrowseParams | undefined,
): FeedIdentity | undefined {
  if (!params) return undefined;
  if (present(params.company)) return { type: 'company', id: String(params.company) };
  if (present(params.collection)) return { type: 'collection', id: String(params.collection) };
  if (present(params.provider)) return { type: 'provider', id: String(params.provider) };
  // Genre is the lowest-priority identity: a row tagged with a studio/network
  // keeps that marquee look; a plain genre row picks up the genre theme.
  const genreToken = present(params.genres)
    ? String(params.genres).split(',')[0]
    : present(params.genre)
      ? String(params.genre)
      : undefined;
  if (genreToken) {
    const slug = genreSlug(genreToken);
    if (slug) return { type: 'genre', id: slug };
  }
  return undefined;
}

const KEY_PREFIX: Record<string, FeedIdentity['type']> = {
  company: 'company',
  collection: 'collection',
  provider: 'provider',
};

/**
 * Fallback path: parse a rail key like "company-420" by KNOWN prefix only.
 * Keys such as "top-rated" / "genre-28" / "trending" → undefined (neutral).
 */
export function feedIdentityFromKey(key: string | undefined): FeedIdentity | undefined {
  if (!key) return undefined;
  // Genre rails: "genre-<id|slug>" and personalized "taste-genre-<id>".
  const genreToken =
    key.startsWith('genre-') ? key.slice('genre-'.length)
    : key.startsWith('taste-genre-') ? key.slice('taste-genre-'.length)
    : undefined;
  if (genreToken !== undefined) {
    const slug = genreSlug(genreToken);
    return slug ? { type: 'genre', id: slug } : undefined;
  }
  const dash = key.indexOf('-');
  if (dash <= 0) return undefined;
  const type = KEY_PREFIX[key.slice(0, dash)];
  const id = key.slice(dash + 1);
  if (!type || !id) return undefined;
  return { type, id };
}

/** Identity → curated theme, or null when unmapped (neutral). */
export function resolveFeedTheme(identity: FeedIdentity | undefined): FeedTheme | null {
  if (!identity) return null;
  return FEED_THEMES[`${identity.type}:${identity.id}`] ?? null;
}
