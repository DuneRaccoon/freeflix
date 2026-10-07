/**
 * PLACEHOLDER — not the TV home screen. The real home is a later stage of the
 * device-pairing / webOS spec. This exists only so a successful pairing, which
 * navigates here, lands on something that confirms it worked instead of a 404.
 */
export default function BigscreenPlaceholderPage() {
  return (
    <main className="bs-page">
      <h1>You&apos;re signed in</h1>
      <p>This television is paired with your Freeflix account.</p>
      <div className="bs-controls">
        <a className="bs-btn bs-btn--ghost" href="/bigscreen/diag">Diagnostics</a>
      </div>
    </main>
  );
}
