import { describe, it, expect } from 'vitest';
import { toDownloadQuality } from './downloadQuality';

describe('toDownloadQuality', () => {
  it('keeps every quality the download endpoint accepts', () => {
    expect(['720p', '1080p', '2160p'].map(toDownloadQuality)).toEqual(['720p', '1080p', '2160p']);
  });
  it('sends 1080p for anything else, absent included', () => {
    expect.soft(toDownloadQuality('480p')).toBe('1080p');
    expect.soft(toDownloadQuality('4K')).toBe('1080p');
    expect.soft(toDownloadQuality('')).toBe('1080p');
    expect.soft(toDownloadQuality(undefined)).toBe('1080p');
    expect.soft(toDownloadQuality(null)).toBe('1080p');
  });
});
