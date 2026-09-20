export interface AvatarPiece {
  /** Globally unique slug across ALL collections — it is the stored id. */
  id: string;
  /** Accessible name in the picker, e.g. 'Film reel'. */
  label: string;
}

export interface AvatarCollection {
  key: string;
  title: string;
  /** Field colour this collection's artwork is built from. Never gold. */
  accent: string;
  pieces: AvatarPiece[];
}
