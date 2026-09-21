import { describe, it, expect } from 'vitest';
import { resolveAvatarSrc, getInitials, normaliseAvatarId } from './resolve';

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
    expect(resolveAvatarSrc('constructor')).toBeNull();
    expect(resolveAvatarSrc('__proto__')).toBeNull();
    expect(resolveAvatarSrc('toString')).toBeNull();
    expect(resolveAvatarSrc('valueOf')).toBeNull();
  });
});

describe('normaliseAvatarId', () => {
  it('maps a legacy avatar path onto its house id', () => {
    expect(normaliseAvatarId('/avatars/avatar1.svg')).toBe('house:reel');
    expect(normaliseAvatarId('/avatars/avatar8.svg')).toBe('house:directors-chair');
  });

  it('passes anything else through unchanged', () => {
    expect(normaliseAvatarId('house:reel')).toBe('house:reel');
    expect(normaliseAvatarId('cached:8f3a91c2')).toBe('cached:8f3a91c2');
  });

  it('returns null for a nullish value', () => {
    expect(normaliseAvatarId(null)).toBeNull();
    expect(normaliseAvatarId(undefined)).toBeNull();
    expect(normaliseAvatarId('')).toBeNull();
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
