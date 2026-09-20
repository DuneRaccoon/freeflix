import { describe, it, expect } from 'vitest';
import { resolveAvatarSrc, getInitials } from './resolve';

describe('resolveAvatarSrc', () => {
  it('resolves a known house id to its file', () => {
    expect(resolveAvatarSrc('house:reel')).toBe('/avatars/house/reel.svg');
  });

  it('returns null for a well-formed but unknown house id', () => {
    expect(resolveAvatarSrc('house:not-a-real-piece')).toBeNull();
  });

  it('resolves a cached id to the backend asset route', () => {
    expect(resolveAvatarSrc('cached:8f3a91c2')).toBe('/api/v1/assets/avatars/8f3a91c2.jpg');
  });

  it('coerces every legacy path to a house id', () => {
    expect(resolveAvatarSrc('/avatars/avatar1.svg')).toBe('/avatars/house/reel.svg');
    expect(resolveAvatarSrc('/avatars/avatar8.svg')).toBe('/avatars/house/directors-chair.svg');
  });

  it('refuses anything else', () => {
    expect(resolveAvatarSrc('javascript:alert(1)')).toBeNull();
    expect(resolveAvatarSrc('https://evil.example/x.gif')).toBeNull();
    expect(resolveAvatarSrc('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(resolveAvatarSrc('house:UPPERCASE')).toBeNull();
    expect(resolveAvatarSrc('cached:nothex')).toBeNull();
    expect(resolveAvatarSrc('')).toBeNull();
    expect(resolveAvatarSrc(null)).toBeNull();
    expect(resolveAvatarSrc(undefined)).toBeNull();
  });
});

describe('getInitials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(getInitials('Ben Herro')).toBe('BH');
    expect(getInitials('ava')).toBe('A');
  });

  it('returns an empty string for an empty name rather than throwing', () => {
    expect(getInitials('')).toBe('');
  });
});
