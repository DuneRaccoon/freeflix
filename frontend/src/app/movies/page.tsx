import { Suspense } from 'react';
import MoviesBrowse from '@/components/movies/MoviesBrowse';

export default function MoviesHubPage() {
  return (
    <Suspense>
      <MoviesBrowse />
    </Suspense>
  );
}
