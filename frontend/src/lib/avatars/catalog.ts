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

export const AVATAR_COLLECTIONS: AvatarCollection[] = [HOUSE_SET];

export const AVATAR_IDS: ReadonlySet<string> = new Set(
  AVATAR_COLLECTIONS.flatMap((c) => c.pieces.map((p) => `house:${p.id}`)),
);
