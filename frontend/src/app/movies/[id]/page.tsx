import type PageProps from 'next';
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
    const movie = await moviesService.getMovieDetails(movieId);
    console.log(movie);
    
    return {
      title: `${movie.title} (${movie.year}) | Freeflix`,
      description: movie.description || movie.plot || `Watch and download ${movie.title}`,
      openGraph: {
        images: [movie.media.poster || movie.img],
        title: `${movie.title} (${movie.year})`,
        description: movie.description || movie.plot || '',
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
    const movie = await moviesService.getMovieDetails(movieId);

    console.log(id);
    console.log(movie);
    
    // Pass data to client component
    return <MovieDetailsContent movie={movie} />;
  } catch (error) {
    notFound();
  }
}