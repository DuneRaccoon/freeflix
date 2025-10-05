import { NextRequest, NextResponse } from 'next/server';
import * as VibrantNS from 'node-vibrant';
const Vibrant: any = (VibrantNS as any).default ?? VibrantNS;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const src = searchParams.get('src');
    if (!src) {
      return NextResponse.json({ error: 'Missing src' }, { status: 400 });
    }

    const res = await fetch(src, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: 400 });
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const palette = await Vibrant.from(buffer).maxColorCount(8).getPalette();

    const toHex = (swatch?: { getHex: () => string } | null, fallback = '#7c3aed') => swatch?.getHex() || fallback;

    const primary = toHex(palette.Vibrant, '#7c3aed');
    const secondary = toHex(palette.LightVibrant, '#06b6d4');
    const accent = toHex(palette.Muted, '#ec4899');
    const background = toHex(palette.DarkMuted, '#0b1020');
    const muted = toHex(palette.DarkVibrant, '#17203a');

    return NextResponse.json({ primary, secondary, background, muted, accent });
  } catch (e) {
    return NextResponse.json({ error: 'Palette extraction failed' }, { status: 500 });
  }
}
