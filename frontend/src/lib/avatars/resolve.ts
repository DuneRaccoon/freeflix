import { AVATAR_IDS } from './catalog';

/**
 * The eight retired files, mapped onto House Set pieces by index. This is a
 * READ-TIME coercion: rows are never rewritten, so the change stays reversible.
 */
const LEGACY_AVATAR_MAP = new Map<string, string>([
  ['/avatars/avatar1.svg', 'house:reel'],
  ['/avatars/avatar2.svg', 'house:clapper'],
  ['/avatars/avatar3.svg', 'house:filmstrip'],
  ['/avatars/avatar4.svg', 'house:projector'],
  ['/avatars/avatar5.svg', 'house:ticket'],
  ['/avatars/avatar6.svg', 'house:boom-mic'],
  ['/avatars/avatar7.svg', 'house:marquee'],
  ['/avatars/avatar8.svg', 'house:directors-chair'],
]);

const CACHED_RE = /^cached:[a-f0-9]{8,64}$/;

/**
 * The ONLY place an avatar value becomes a URL. Anything unrecognised returns
 * null and the caller renders a monogram — which is what keeps an arbitrary
 * stored string (`javascript:`, a remote URL) out of `<img src>`.
 */
export function resolveAvatarSrc(value: string | null | undefined): string | null {
  if (!value) return null;

  const id = LEGACY_AVATAR_MAP.get(value) ?? value;

  if (id.startsWith('house:')) {
    return AVATAR_IDS.has(id) ? `/avatars/house/${id.slice('house:'.length)}.svg` : null;
  }
  if (CACHED_RE.test(id)) {
    return `/api/v1/assets/avatars/${id.slice('cached:'.length)}.jpg`;
  }
  return null;
}

/** First letter of up to two words. Moved verbatim from the deleted avatarHelper. */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
