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

export type TorrentAction = 'pause' | 'resume' | 'stop' | 'remove';

// --- Catalog (new TMDB-shaped API) ---
export interface CatalogItem {
  tmdb_id: number;
  media_type: 'movie';
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

// New tmdb-id download request (the legacy TorrentRequest stays until callers migrate)
export interface CatalogTorrentRequest {
  tmdb_id: number;
  quality: '720p' | '1080p' | '2160p';
  save_path?: string;
  media_type?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

// Browse controls for the new API
export const GENRE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'All Genres' }, { value: 10759, label: 'Action & Adventure' },
  { value: 16, label: 'Animation' }, { value: 35, label: 'Comedy' },
  { value: 80, label: 'Crime' }, { value: 99, label: 'Documentary' },
  { value: 18, label: 'Drama' }, { value: 10751, label: 'Family' },
  { value: 9648, label: 'Mystery' }, { value: 10765, label: 'Sci-Fi & Fantasy' },
  { value: 10768, label: 'War & Politics' }, { value: 37, label: 'Western' },
];
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
}

export interface StreamingProgress {
  id: string;
  user_id: string;
  torrent_id: string;
  movie_id: string;
  current_time: number;
  duration: number | null;
  percentage: number;
  completed: boolean;
  last_watched_at: string;
  created_at: string;
  updated_at: string;
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