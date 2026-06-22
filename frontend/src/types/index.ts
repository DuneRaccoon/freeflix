// --- Movie Types ---
export interface Torrent {
  id: string;
  quality: string;
  sizes: [string, string];
  url: string;
  magnet: string;
}

export interface Movie {
  title: string;
  year: number;
  rating: string;
  link: string;
  genre: string;
  img: string;
  description: null | string;
  torrents: Torrent[];
}


export interface DetailedMovie {
  id: string;
  title: string;
  year: number;
  rating: string;
  link: string;
  genre: string;
  img: string;
  description: string | null;
  plot: string | null;
  runtime: string | null;
  language: string | null;
  country: string | null;
  imdb_id: string | null;
  awards: string | null;
  torrents: Array<Torrent>;
  ratings: {
    imdb: string | null;
    imdbVotes: string | null;
    rottenTomatoes: string | null;
    rottenTomatoesCount: number | null;
    rottenTomatoesAudience: string | null;
    rottenTomatoesAudienceCount: number | null;
    metacritic: string | null;
    metacriticCount: number | null;
  };
  credits: {
    director: string | null;
    cast: Array<{
      name: string;
      character: string | null;
      image: string | null;
    }>;
  };
  media: {
    poster: string;
    backdrop: string | null;
    trailer: string | null;
  };
  reviews: Array<{
    source: string;
    author: string | null;
    content: string;
    rating: string | null;
    url: string | null;
    date: string | null;
  }>;
  related_movies: Array<{
    title: string;
    url: string;
    image: string | null;
    critic_score: number | null;
    audience_score: number | null;
  }>;
}

// --- Torrent Status Types ---
export enum TorrentState {
  QUEUED = "queued",
  CHECKING = "checking",
  DOWNLOADING_METADATA = "downloading_metadata",
  DOWNLOADING = "downloading",
  FINISHED = "finished",
  SEEDING = "seeding",
  ALLOCATING = "allocating",
  CHECKING_FASTRESUME = "checking_fastresume",
  PAUSED = "paused",
  ERROR = "error",
  STOPPED = "stopped"
}

export interface TorrentStatus {
  id: string;
  movie_title: string;
  quality: string;
  state: TorrentState;
  progress: number;
  download_rate: number;
  upload_rate: number;
  total_downloaded: number;
  total_uploaded: number;
  num_peers: number;
  save_path: string;
  created_at: string;
  updated_at: string;
  eta?: number;
  error_message?: string;
}

export interface TorrentRequest {
  movie_id: string;
  quality: '720p' | '1080p' | '2160p';
  save_path?: string;
}

export type TorrentAction = 'pause' | 'resume';

export type TorrentBatchActionType = 'pause' | 'resume' | 'clear_completed' | 'retry';

export interface TorrentBatchResult {
  id: string;
  success: boolean;
}

export interface TorrentBatchResponse {
  action: string;
  succeeded: number;
  failed: number;
  results: TorrentBatchResult[];
}

// --- Catalog (new TMDB-shaped API) ---
export interface CatalogItem {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  year: number | null;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  genre_ids: number[];
  genres: string[];
  vote_average: number;
  vote_count: number;
  popularity: number;
  original_language: string | null;
}

export interface CastMember {
  name: string;
  character: string | null;
  image: string | null;
}

export interface MovieDetail extends CatalogItem {
  runtime: number | null;
  imdb_id: string | null;
  tagline: string | null;
  cast: CastMember[];
  director: string | null;
  available_qualities: string[];
}

export interface TorrentHit {
  title: string;
  seeds: number;
  peers: number;
  bytes: number;
  magnet: string;
  hash: string;
  source: string | null;
  quality: string | null;
}

export interface CatalogPage {
  page: number;
  results: CatalogItem[];
  total_pages: number;
  total_results: number;
}

// --- TV ---
export interface SeasonSummary {
  season_number: number;
  name: string;
  episode_count: number;
  overview: string | null;
  poster_url: string | null;
  air_date: string | null;
}

export interface Episode {
  episode_number: number;
  name: string;
  overview: string | null;
  runtime: number | null;
  still_url: string | null;
  air_date: string | null;
  vote_average: number;
}

export interface ShowDetail {
  tmdb_id: number;
  media_type: 'tv';
  name: string;
  year: number | null;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  genres: string[];
  status: string | null;
  first_air_date: string | null;
  last_air_date: string | null;
  number_of_seasons: number;
  vote_average: number;
  vote_count: number;
  seasons: SeasonSummary[];
}

export interface SeasonDetail {
  season_number: number;
  name: string;
  overview: string | null;
  episodes: Episode[];
}

export interface VideoFile {
  index: number;
  name: string;
  size: number;
  downloaded: number;
  progress: number;
  mime_type: string;
  stream_url: string;
  season: number | null;
  episode: number | null;
}

// New tmdb-id download request (the legacy TorrentRequest stays until callers migrate)
export interface CatalogTorrentRequest {
  tmdb_id: number;
  quality: '720p' | '1080p' | '2160p';
  save_path?: string;
  media_type?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

// Browse controls for the new API. Genre ids are the canonical unified TMDB set
// (work in both movie and tv discover modes).
export const GENRE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'All Genres' }, { value: 28, label: 'Action' },
  { value: 12, label: 'Adventure' }, { value: 16, label: 'Animation' },
  { value: 35, label: 'Comedy' }, { value: 80, label: 'Crime' },
  { value: 99, label: 'Documentary' }, { value: 18, label: 'Drama' },
  { value: 10751, label: 'Family' }, { value: 14, label: 'Fantasy' },
  { value: 36, label: 'History' }, { value: 27, label: 'Horror' },
  { value: 10402, label: 'Music' }, { value: 9648, label: 'Mystery' },
  { value: 10749, label: 'Romance' }, { value: 878, label: 'Sci-Fi' },
  { value: 53, label: 'Thriller' }, { value: 10752, label: 'War' },
  { value: 37, label: 'Western' },
];

export const PROVIDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Any Service' }, { value: 8, label: 'Netflix' },
  { value: 9, label: 'Prime Video' }, { value: 337, label: 'Disney+' },
  { value: 1899, label: 'Max' }, { value: 15, label: 'Hulu' },
  { value: 350, label: 'Apple TV+' }, { value: 531, label: 'Paramount+' },
  { value: 386, label: 'Peacock' },
];

export const ORIGIN_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Anywhere' }, { value: 'anime', label: 'Anime' },
  { value: 'KR', label: 'Korean' }, { value: 'JP', label: 'Japanese' },
  { value: 'IN', label: 'Indian' }, { value: 'GB', label: 'British' },
  { value: 'FR', label: 'French' }, { value: 'ES', label: 'Spanish' },
  { value: 'IT', label: 'Italian' }, { value: 'CN', label: 'Chinese' },
];

export const COMPANY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Any Studio' }, { value: 420, label: 'Marvel Studios' },
  { value: 3, label: 'Pixar' }, { value: 521, label: 'DreamWorks' },
  { value: 2, label: 'Walt Disney' }, { value: 174, label: 'Warner Bros' },
  { value: 33, label: 'Universal' }, { value: 41077, label: 'A24' },
  { value: 10342, label: 'Studio Ghibli' }, { value: 923, label: 'Legendary' },
  { value: 1632, label: 'Lionsgate' }, { value: 3172, label: 'Blumhouse' },
];

export const COLLECTION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Any Collection' }, { value: 86311, label: 'The Avengers' },
  { value: 1241, label: 'Harry Potter' }, { value: 10, label: 'Star Wars' },
  { value: 645, label: 'James Bond 007' }, { value: 9485, label: 'Fast & Furious' },
  { value: 119, label: 'Lord of the Rings' }, { value: 121938, label: 'The Hobbit' },
  { value: 328, label: 'Jurassic Park' }, { value: 131635, label: 'The Hunger Games' },
  { value: 295, label: 'Pirates of the Caribbean' }, { value: 87359, label: 'Mission Impossible' },
  { value: 404609, label: 'John Wick' }, { value: 263, label: 'Dark Knight' },
  { value: 2344, label: 'The Matrix' }, { value: 10194, label: 'Toy Story' },
  { value: 2150, label: 'Shrek' }, { value: 86066, label: 'Despicable Me' },
  { value: 87096, label: 'Avatar' }, { value: 748, label: 'X-Men' },
  { value: 8091, label: 'Alien' },
];

export const BEST_OF_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any Year' }, { value: 'best_2025', label: 'Best of 2025' },
  { value: 'best_2024', label: 'Best of 2024' }, { value: 'best_2023', label: 'Best of 2023' },
  { value: 'best_2022', label: 'Best of 2022' }, { value: 'best_2021', label: 'Best of 2021' },
  { value: 'best_2020', label: 'Best of 2020' },
];

// Discover params accepted by the browse services / endpoints.
export interface BrowseParams {
  api?: string;
  sort?: string;
  genre?: number;       // legacy single-genre alias
  genres?: string;      // comma-separated tmdb genre ids
  year?: number;
  provider?: number | string;
  origin?: string;
  company?: number | string;
  collection?: number | string;
  lang?: string;
  page?: number;
}
export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'popularity.desc', label: 'Popular' },
  { value: 'vote_average.desc', label: 'Top Rated' },
  { value: 'primary_release_date.desc', label: 'Newest' },
  { value: 'revenue.desc', label: 'Highest Grossing' },
];
export const YEAR_OPTIONS: number[] = [0, ...Array.from({ length: 2026 - 2010 + 1 }, (_, i) => 2026 - i)];

// --- Search Types ---
export type OrderByLiteral = 'latest' | 'oldest' | 'featured' | 'year' | 'rating' | 'likes' | 'alphabetical'
export type GenreLiteral = 'all' | 'action' | 'adventure' | 'animation' | 'biography' | 'comedy' | 'crime' | 'documentary' | 'drama' | 'family' | 'fantasy' | 'film-noir' | 'game-show' | 'history' | 'horror' | 'music' | 'musical' | 'mystery' | 'news' | 'reality-tv' | 'romance' | 'sci-fi' | 'sport' | 'talk-show' | 'thriller' | 'war' | 'western'
export type QualityLiteral = 'all' | '720p' | '1080p' | '2160p' | '3d'
export type YearLiteral = 'all' | '2025' | '2024' | '2023' | '2022' | '2021' | '2020' | '2019' | '2018' | '2017' | '2016' | '2015' | '2014' | '2013' | '2012' | '2011' | '2010' | '2000-2009' | '1990-1999' | '1980-1989' | '1970-1979' | '1950-1969' | '1900-1949'
export type RatingLiteral = 'all' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2' | '1'
export interface SearchParams {
  keyword?: string | undefined | string;
  quality?: QualityLiteral | undefined | string;
  genre?: GenreLiteral | undefined | string;
  rating?: RatingLiteral | undefined | string;
  year?: YearLiteral | undefined | string;
  order_by?: OrderByLiteral | string;
  page?: number | undefined | string;
  limit?: number | undefined;
}


// export interface SearchParams {
//   keyword?: string;
//   quality?: string;
//   genre?: string;
//   rating?: number;
//   year?: string;
//   order_by?: string;
//   page?: number;
// }

// --- Schedule Types ---
export interface ScheduleConfig {
  name?: string;
  cron_expression: string;
  search_params: SearchParams;
  quality: '720p' | '1080p' | '2160p';
  max_downloads: number;
  enabled: boolean;
}

export interface ScheduleResponse {
  id: string;
  name?: string;
  config: ScheduleConfig;
  next_run: string;
  last_run?: string;
  status: string;
}

// --- UI Component Types ---
export interface CardProps {
  className?: string;
  children: React.ReactNode;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
  error?: string;
}

// --- Common API Response Types ---
export interface ApiResponse<T> {
  data: T;
  error?: string;
}

// --- Streaming Types ---
export interface VideoFileInfo {
  name: string;
  size: number;
  downloaded: number;
  progress: number;
  mime_type: string;
  stream_url: string;
}

export interface StreamingInfo {
  torrent_id: string;
  movie_title: string;
  quality: string;
  progress: number;
  video_file: VideoFileInfo;
  total_progress: number;
  state: string;
  content_id?: string | null;
  season?: number | null;
  episode?: number | null;
  file_index?: number | null;
}

export interface StreamingProgress {
  id: string;
  user_id: string;
  torrent_id: string | null; // NULL once the torrent is removed; watch history survives
  movie_id: string;
  current_time: number;
  duration: number | null;
  percentage: number;
  completed: boolean;
  last_watched_at: string;
  created_at: string;
  updated_at: string;
  file_index?: number | null;
  title?: string | null;
}

export interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  showControls: boolean;
  isLoading: boolean;
  error: string | null;
}