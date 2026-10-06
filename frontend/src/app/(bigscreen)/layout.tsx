import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Freeflix — Big Screen',
  description: 'Freeflix on the television.',
};

/**
 * Second root layout, for the TV surface only.
 *
 * It deliberately imports NO stylesheet: Tailwind v4 wraps its output in a CSS
 * cascade-layers at-rule that Chromium 87 (webOS TV 22) does not understand and
 * therefore discards wholesale, leaving an unstyled page. public/bigscreen.css is
 * hand-authored plain CSS and is linked directly so it never passes through PostCSS.
 *
 * It also mounts none of the app's providers — the TV surface must render before
 * device pairing exists.
 */
export default function BigScreenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/bigscreen.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
