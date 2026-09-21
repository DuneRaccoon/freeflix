import type { AvatarCollection } from './types';

export const HOUSE_SET: AvatarCollection = {
  key: 'house',
  title: 'The House Set',
  accent: '#CFC8B8',
  pieces: [
    { id: 'reel', label: 'Film reel' },
    { id: 'clapper', label: 'Clapperboard' },
    { id: 'filmstrip', label: '35mm strip' },
    { id: 'projector', label: 'Projector head' },
    { id: 'ticket', label: 'Ticket stub' },
    { id: 'boom-mic', label: 'Boom microphone' },
    { id: 'marquee', label: 'Marquee bulb' },
    { id: 'directors-chair', label: "Director's chair" },
    { id: 'leader-three', label: 'Academy leader' },
  ],
};

export const AFTER_DARK: AvatarCollection = {
  key: 'after-dark',
  title: 'After Dark',
  accent: '#8E2C2C',
  pieces: [
    { id: 'moth', label: 'Moth' },
    { id: 'porcelain-mask', label: 'Porcelain mask' },
    { id: 'streetlamp', label: 'Streetlamp in fog' },
    { id: 'raven', label: 'Raven' },
  ],
};

export const FUTURE: AvatarCollection = {
  key: 'future',
  title: 'The Future Is Now',
  accent: '#3FB7C4',
  pieces: [
    { id: 'visor', label: 'Helmet visor' },
    { id: 'ringed-planet', label: 'Ringed planet' },
    { id: 'ray-gun', label: 'Ray gun' },
    { id: 'satellite', label: 'Satellite' },
  ],
};

export const FRONTIER: AvatarCollection = {
  key: 'frontier',
  title: 'The Frontier',
  accent: '#BB6B3A',
  pieces: [
    { id: 'brim-hat', label: 'Wide-brim hat' },
    { id: 'horseshoe', label: 'Horseshoe' },
    { id: 'saguaro', label: 'Saguaro' },
    { id: 'spurs', label: 'Spurs' },
  ],
};

export const AVATAR_COLLECTIONS: AvatarCollection[] = [HOUSE_SET, AFTER_DARK, FUTURE, FRONTIER];

export const AVATAR_IDS: ReadonlySet<string> = new Set(
  AVATAR_COLLECTIONS.flatMap((c) => c.pieces.map((p) => `house:${p.id}`)),
);
