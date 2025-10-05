export type ExtractedPalette = {
  primary: string;
  secondary: string;
  background: string;
  muted: string;
  accent: string;
};

async function fetchObjectUrl(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    return url;
  } catch {
    return null;
  }
}

async function computeAverageColor(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      const w = 50; const h = 50;
      canvas.width = w; canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let r = 0, g = 0, b = 0, c = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i + 1]; b += data[i + 2]; c++;
      }
      r = Math.round(r / c); g = Math.round(g / c); b = Math.round(b / c);
      resolve(`#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`);
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

export async function extractPaletteFromImage(imageUrl: string): Promise<ExtractedPalette | null> {
  try {
    // Use serverless proxy to bypass CORS
    const url = `/api/palette?src=${encodeURIComponent(imageUrl)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      return data as ExtractedPalette;
    }

    // Fallback to client-side extraction and average color
    const mod: any = await import('node-vibrant');
    const VibrantAny = (mod as any).default ?? mod;
    const objUrl = await fetchObjectUrl(imageUrl);
    const src = objUrl ?? imageUrl;
    const palette = await VibrantAny.from(src).maxColorCount(8).getPalette();
    if (objUrl) URL.revokeObjectURL(objUrl);
    if (!palette) throw new Error('No palette');

    const toHex = (swatch?: { getHex: () => string } | null, fallback = '#7c3aed') => swatch?.getHex() || fallback;

    const avg = await computeAverageColor(src);
    const primary = toHex(palette.Vibrant, avg || '#7c3aed');
    const secondary = toHex(palette.LightVibrant, '#06b6d4');
    const accent = toHex(palette.Muted, '#ec4899');
    const background = toHex(palette.DarkMuted, '#0b1020');
    const muted = toHex(palette.DarkVibrant, '#17203a');

    return { primary, secondary, background, muted, accent };
  } catch (e) {
    // Fallback to average-only
    const avg = await computeAverageColor(imageUrl);
    if (!avg) return null;
    return {
      primary: avg,
      secondary: avg,
      background: '#0b1020',
      muted: '#17203a',
      accent: avg,
    };
  }
}

export function applyPaletteToCssVars(p: ExtractedPalette) {
  const root = document.documentElement;
  root.style.setProperty('--color-primary', p.primary);
  root.style.setProperty('--color-secondary', p.secondary);
  root.style.setProperty('--color-background', p.background);
  root.style.setProperty('--color-muted', p.muted);
}

export function applyPaletteToElement(el: HTMLElement, p: ExtractedPalette) {
  el.style.setProperty('--movie-primary', p.primary);
  el.style.setProperty('--movie-secondary', p.secondary);
  el.style.setProperty('--movie-background', p.background);
  el.style.setProperty('--movie-muted', p.muted);
  el.style.setProperty('--movie-accent', p.accent);
}
