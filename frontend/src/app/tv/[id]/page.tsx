import { Metadata } from 'next';
import { tvService } from '@/services/tv';
import ShowDetailsContent from '@/components/tv/ShowDetailsContent';
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

export default async function ShowPage({ params }: Props) {
  try {
    const { id } = await params;
    const showId = decodeURIComponent(id);
    const show = await tvService.getShow(Number(showId));

    return <ShowDetailsContent show={show} />;
  } catch (error) {
    notFound();
  }
}
