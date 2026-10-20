import type { Metadata } from 'next';
import { ShellFlag } from './_components/ShellFlag';

export const metadata: Metadata = {
  title: 'Freeflix — Big Screen',
  description: 'Freeflix on the television.',
};

/**
 * Second root layout, for the TV surface only.
 *
 * It deliberately imports NO stylesheet. The engine would now cope — the set reads
 * as Chromium 120 (webOS 25), so Tailwind v4's cascade layers would render — but
 * the web stylesheet brings the whole pointer-first design system with it: the blur
 * stacks and the full-viewport atmosphere layer that spec §9 keeps off TV silicon.
 * public/bigscreen.css is hand-authored plain CSS, linked directly so it never
 * passes through PostCSS, and legacy-target.test.ts pins both rules.
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
      <body>
        {/* Captures `?from=app` once. Renders nothing; see the component. */}
        <ShellFlag />
        {children}
      </body>
    </html>
  );
}
