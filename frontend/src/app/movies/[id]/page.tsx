import { Metadata } from 'next';
import { moviesService } from '@/services/movies';
import MovieDetailsContent from '@/components/movies/MovieDetailsContent';
import { notFound } from 'next/navigation';

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const { id } = await params;
    const movieId = decodeURIComponent(id);
    const movie = await moviesService.getDetail(Number(movieId));

    return {
      title: `${movie.title} (${movie.year ?? 'N/A'}) | Freeflix`,
      description: movie.overview || `Watch and download ${movie.title}`,
      openGraph: {
        images: movie.poster_url ? [movie.poster_url] : [],
        title: `${movie.title} (${movie.year ?? 'N/A'})`,
        description: movie.overview || '',
      },
    };
  } catch (error) {
    return {
      title: 'Movie | Freeflix',
    };
  }
}

export default async function MoviePage({ params }: Props) {
  try {
    const { id } = await params;

    // Fetch movie data server-side
    const movieId = decodeURIComponent(id);
    const movie = await moviesService.getDetail(Number(movieId));

    // Pass data to client component
    return <MovieDetailsContent movie={movie} />;
  } catch (error) {
    notFound();
  }
}
