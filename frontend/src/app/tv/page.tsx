import { Suspense } from 'react';
import SeriesBrowse from '@/components/tv/SeriesBrowse';

export default function TvPage() {
  return (
    <Suspense>
      <SeriesBrowse />
    </Suspense>
  );
}
