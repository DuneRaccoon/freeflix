import { Metadata } from 'next';
import { tvService } from '@/services/tv';
import ShowDetailView from '@/components/tv/ShowDetailView';
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

    return <ShowDetailView show={show} />;
  } catch (error) {
    notFound();
  }
}
