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

// --- Search Types ---
export interface SearchParams {
  keyword?: string;
  quality?: string;
  genre?: string;
  rating?: number;
  year?: number;
  order_by?: string;
  page?: number;
}

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