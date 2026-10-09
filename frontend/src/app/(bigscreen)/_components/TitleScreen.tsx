import type { ReactNode } from 'react';

import { backgroundImageFor } from './Hero';

/**
 * The frame both detail screens (movie, show) share: a full-bleed backdrop under a scrim,
 * the title block, then the actions row, then whatever the screen puts below.
 *
 * It owns NO focus stop. `actions` and `below` bring their own, and the screen reports
 * their counts to its one `useFocusGrid`: row 0 is `actions`, rows 1+ are `below`. Anything
 * passed as `actions` must never unmount while it holds focus; an unmounted focused control
 * drops DOM focus to <body> with nothing to bring it back on a remote.
 *
 * The art is taken as given. The caller upgrades it to `w1920` (`atSize`) so this frame
 * stays free of image policy. It is an inline `background-image`, quoted with
 * JSON.stringify so a stray quote or paren cannot end the `url()`.
 */
export function TitleScreen({
  art,
  eyebrow,
  title,
  overview,
  actions,
  below,
}: {
  art: string | null;
  eyebrow?: string | null;
  title: string;
  overview: string | null;
  /** Row 0: the actions. */
  actions: ReactNode;
  /** Rows 1+: an episode list, or nothing on a movie. */
  below?: ReactNode;
}) {
  return (
    <div className="bs-shell">
      <div className="bs-shell__scroll">
        <section className="bs-title">
          {art && <div className="bs-title__art" style={{ backgroundImage: backgroundImageFor(art) }} aria-hidden="true" />}
          <div className="bs-title__scrim" aria-hidden="true" />
          <div className="bs-title__body">
            {eyebrow ? <p className="bs-title__eyebrow">{eyebrow}</p> : null}
            <h1 className="bs-title__name">{title}</h1>
            {overview ? <p className="bs-title__overview">{overview}</p> : null}
            <div className="bs-title__actions">{actions}</div>
          </div>
        </section>
        {below ? <div className="bs-title__below">{below}</div> : null}
      </div>
    </div>
  );
}
