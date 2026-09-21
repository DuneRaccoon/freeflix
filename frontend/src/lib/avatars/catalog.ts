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
    { id: 'spurs', label: 'Boot and spur' },
  ],
};

export const SHADOWS: AvatarCollection = {
  key: 'shadows',
  title: 'Shadows & Smoke',
  accent: '#9AA7B4',
  pieces: [
    { id: 'fedora', label: 'Fedora' },
    { id: 'blinds', label: 'Venetian blinds' },
    { id: 'martini', label: 'Martini' },
    { id: 'candlestick-phone', label: 'Candlestick telephone' },
  ],
};

export const WONDER: AvatarCollection = {
  key: 'wonder',
  title: 'Realms of Wonder',
  accent: '#8E7BD6',
  pieces: [
    { id: 'turret', label: 'Castle turret' },
    { id: 'sword', label: 'Sword' },
    { id: 'crescent-star', label: 'Crescent and star' },
    { id: 'owl', label: 'Owl' },
  ],
};

export const HEART: AvatarCollection = {
  key: 'heart',
  title: 'Matters of the Heart',
  accent: '#C77B92',
  pieces: [
    { id: 'rose', label: 'Rose' },
    { id: 'paired-glasses', label: 'Paired glasses' },
    { id: 'sealed-letter', label: 'Sealed letter' },
    { id: 'moon-on-water', label: 'Moon on water' },
  ],
};

export const LAUGH: AvatarCollection = {
  key: 'laugh',
  title: 'The Big Laugh',
  accent: '#E8B62F',
  pieces: [
    { id: 'bowler-cane', label: 'Bowler and cane' },
    { id: 'comedy-mask', label: 'Comedy mask' },
    { id: 'seltzer', label: 'Seltzer bottle' },
    { id: 'pie-tin', label: 'Pie tin' },
  ],
};

export const GREEN: AvatarCollection = {
  key: 'green',
  title: 'The Green World',
  accent: '#6FA287',
  pieces: [
    { id: 'leaf', label: 'Leaf' },
    { id: 'bird-in-flight', label: 'Bird in flight' },
    { id: 'rain-umbrella', label: 'Rain umbrella' },
    { id: 'paper-boat', label: 'Paper boat' },
  ],
};

export const SILENT: AvatarCollection = {
  key: 'silent',
  title: 'Silent Era',
  accent: '#2A2C30',
  pieces: [
    { id: 'iris-shot', label: 'Iris shot' },
    { id: 'upright-piano', label: 'Upright piano' },
    { id: 'title-card', label: 'Title card' },
    { id: 'arc-lamp', label: 'Carbon-arc lamp' },
  ],
};

export const AVATAR_COLLECTIONS: AvatarCollection[] = [
  HOUSE_SET, AFTER_DARK, FUTURE, FRONTIER, SHADOWS, WONDER, HEART, LAUGH, GREEN, SILENT,
];

export const AVATAR_IDS: ReadonlySet<string> = new Set(
  AVATAR_COLLECTIONS.flatMap((c) => c.pieces.map((p) => `house:${p.id}`)),
);
