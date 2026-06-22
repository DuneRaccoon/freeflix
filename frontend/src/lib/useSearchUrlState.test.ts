import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
let mockSearchParamsMap: Record<string, string> = {};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParamsMap[key] ?? null,
  }),
}));

// Import AFTER mocks are set up.
import { useSearchUrlState } from './useSearchUrlState';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSearchHook(params: Record<string, string> = {}) {
  mockSearchParamsMap = params;
  return renderHook(() => useSearchUrlState());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParamsMap = {};
});

describe('useSearchUrlState', () => {
  describe('initial state hydration from URL', () => {
    it('uses defaults when no search params are present', () => {
      const { result } = renderSearchHook();
      expect(result.current.state).toEqual({
        q: '', type: 'all', genre: 0, year: 0, sort: '',
        provider: 0, origin: '', company: 0, collection: 0, api: '',
      });
    });

    it('hydrates q from the URL', () => {
      const { result } = renderSearchHook({ q: 'blade runner' });
      expect(result.current.state.q).toBe('blade runner');
    });

    it('hydrates type=movie from the URL', () => {
      const { result } = renderSearchHook({ type: 'movie' });
      expect(result.current.state.type).toBe('movie');
    });

    it('hydrates type=tv from the URL', () => {
      const { result } = renderSearchHook({ type: 'tv' });
      expect(result.current.state.type).toBe('tv');
    });

    it('falls back to "all" for an unknown type value', () => {
      const { result } = renderSearchHook({ type: 'unknown' });
      expect(result.current.state.type).toBe('all');
    });

    it('hydrates genre as a number', () => {
      const { result } = renderSearchHook({ genre: '28' });
      expect(result.current.state.genre).toBe(28);
    });

    it('hydrates year as a number', () => {
      const { result } = renderSearchHook({ year: '2023' });
      expect(result.current.state.year).toBe(2023);
    });

    it('hydrates sort from the URL', () => {
      const { result } = renderSearchHook({ sort: 'popularity.desc' });
      expect(result.current.state.sort).toBe('popularity.desc');
    });

    it('hydrates all params together', () => {
      const { result } = renderSearchHook({
        q: 'dune',
        type: 'movie',
        genre: '878',
        year: '2021',
        sort: 'vote_average.desc',
      });
      expect(result.current.state).toEqual({
        q: 'dune',
        type: 'movie',
        genre: 878,
        year: 2021,
        sort: 'vote_average.desc',
        provider: 0,
        origin: '',
        company: 0,
        collection: 0,
        api: '',
      });
    });

    it('hydrates the new discover dimensions', () => {
      const { result } = renderSearchHook({ provider: '8', origin: 'KR', company: '420', collection: '86311', api: 'best_2025' });
      expect(result.current.state.provider).toBe(8);
      expect(result.current.state.origin).toBe('KR');
      expect(result.current.state.company).toBe(420);
      expect(result.current.state.collection).toBe(86311);
      expect(result.current.state.api).toBe('best_2025');
    });
  });

  describe('setState', () => {
    it('updates state.type and calls router.replace with type=movie', () => {
      const { result } = renderSearchHook();

      act(() => {
        result.current.setState({ type: 'movie' });
      });

      expect(result.current.state.type).toBe('movie');
      expect(mockReplace).toHaveBeenCalledOnce();
      const url: string = mockReplace.mock.calls[0][0];
      expect(url).toContain('type=movie');
    });

    it('updates state.type and calls router.replace with type=tv', () => {
      const { result } = renderSearchHook();

      act(() => {
        result.current.setState({ type: 'tv' });
      });

      expect(result.current.state.type).toBe('tv');
      const url: string = mockReplace.mock.calls[0][0];
      expect(url).toContain('type=tv');
    });

    it('omits "type" from the URL when set back to the default "all"', () => {
      const { result } = renderSearchHook({ type: 'movie' });

      act(() => {
        result.current.setState({ type: 'all' });
      });

      const url: string = mockReplace.mock.calls[0][0];
      expect(url).not.toContain('type=');
    });

    it('merges partial updates — does not reset other fields', () => {
      const { result } = renderSearchHook({ q: 'alien', sort: 'popularity.desc' });

      act(() => {
        result.current.setState({ type: 'tv' });
      });

      expect(result.current.state.q).toBe('alien');
      expect(result.current.state.sort).toBe('popularity.desc');
      expect(result.current.state.type).toBe('tv');
    });

    it('omits q from the URL when empty', () => {
      const { result } = renderSearchHook();

      act(() => {
        result.current.setState({ q: '' });
      });

      const url: string = mockReplace.mock.calls[0][0];
      expect(url).not.toContain('q=');
    });

    it('includes q in the URL when non-empty', () => {
      const { result } = renderSearchHook();

      act(() => {
        result.current.setState({ q: 'inception' });
      });

      const url: string = mockReplace.mock.calls[0][0];
      expect(url).toContain('q=inception');
    });

    it('omits genre from the URL when 0 (default)', () => {
      const { result } = renderSearchHook({ genre: '28' });

      act(() => {
        result.current.setState({ genre: 0 });
      });

      const url: string = mockReplace.mock.calls[0][0];
      expect(url).not.toContain('genre=');
    });

    it('includes genre in the URL when non-zero', () => {
      const { result } = renderSearchHook();

      act(() => {
        result.current.setState({ genre: 28 });
      });

      const url: string = mockReplace.mock.calls[0][0];
      expect(url).toContain('genre=28');
    });

    it('navigates to /search with no query string when all values are defaults', () => {
      const { result } = renderSearchHook();

      act(() => {
        result.current.setState({});
      });

      expect(mockReplace).toHaveBeenCalledWith('/search');
    });

    it('navigates to /search?... with a combined query string', () => {
      const { result } = renderSearchHook();

      act(() => {
        result.current.setState({ q: 'dune', type: 'movie', genre: 878 });
      });

      const url: string = mockReplace.mock.calls[0][0];
      expect(url).toBe('/search?q=dune&type=movie&genre=878');
    });

    it('serialises provider + origin into the URL', () => {
      const { result } = renderSearchHook();
      act(() => { result.current.setState({ provider: 8, origin: 'KR' }); });
      const url: string = mockReplace.mock.calls[0][0];
      expect(url).toContain('provider=8');
      expect(url).toContain('origin=KR');
    });

    it('omits provider when 0 and origin when empty', () => {
      const { result } = renderSearchHook({ provider: '8', origin: 'KR' });
      act(() => { result.current.setState({ provider: 0, origin: '' }); });
      const url: string = mockReplace.mock.calls[0][0];
      expect(url).not.toContain('provider=');
      expect(url).not.toContain('origin=');
    });

    it('serialises company, collection and api into the URL', () => {
      const { result } = renderSearchHook();
      act(() => { result.current.setState({ company: 420, collection: 86311, api: 'best_2025' }); });
      const url: string = mockReplace.mock.calls[0][0];
      expect(url).toContain('company=420');
      expect(url).toContain('collection=86311');
      expect(url).toContain('api=best_2025');
    });

    it('omits company, collection and api at their defaults', () => {
      const { result } = renderSearchHook({ company: '420', collection: '86311', api: 'best_2025' });
      act(() => { result.current.setState({ company: 0, collection: 0, api: '' }); });
      const url: string = mockReplace.mock.calls[0][0];
      expect(url).not.toContain('company=');
      expect(url).not.toContain('collection=');
      expect(url).not.toContain('api=');
    });
  });
});
