// frontend/src/lib/feedThemes/resolveFeedTheme.ts
import { BrowseParams } from '@/types';
import { FeedIdentity, FeedTheme } from './types';
import { FEED_THEMES } from './registry';

/** Treat 0 / '0' / undefined / null as "not set". */
function present(v: number | string | undefined | null): v is number | string {
  return v != null && v !== 0 && v !== '0';
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
