import { Metadata } from 'next';
import { tvService } from '@/services/tv';
import ShowDetailView from '@/components/tv/ShowDetailView';
import { episodeAskFrom } from '@/lib/titlePageHref';
import { notFound } from 'next/navigation';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const { id } = await params;
    const showId = decodeURIComponent(id);
    const show = await tvService.getShow(Number(showId));

    return {
      title: `${show.name} (${show.year ?? 'N/A'}) | Freeflix`,
      description: show.overview || `Watch and download ${show.name}`,
      openGraph: {
        images: show.poster_url ? [show.poster_url] : [],
        title: `${show.name} (${show.year ?? 'N/A'})`,
        description: show.overview || '',
      },
    };
  } catch (error) {
    return {
      title: 'TV Show | Freeflix',
    };
  }
}

export default async function ShowPage({ params, searchParams }: Props) {
  // The episode a Continue Watching card asked for (`?season=&episode=`). Read
  // OUTSIDE the try, whose catch is "no such show": `episodeAskFrom` folds every
  // malformed value into "not an ask", and nothing about the query may 404.
  const ask = episodeAskFrom(await searchParams);

  try {
    const { id } = await params;
    const showId = decodeURIComponent(id);
    const show = await tvService.getShow(Number(showId));

    // Keyed on the ask: a search-only navigation (`?season=1&episode=2` →
    // `?season=2&episode=1` on the same show) does not remount page state in
    // Next 15, and the view seeds its season tab from the ask only on mount.
    return (
      <ShowDetailView
        key={`${ask.season ?? ''}:${ask.episode ?? ''}`}
        show={show}
        initialSeason={ask.season}
        initialEpisode={ask.episode}
      />
    );
  } catch (error) {
    notFound();
  }
}
