import { NextRequest, NextResponse } from 'next/server';
import { Vibrant } from 'node-vibrant/node';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const src = searchParams.get('src');
    if (!src) {
      return NextResponse.json({ error: 'Missing src' }, { status: 400, headers: corsHeaders() });
    }

    // Try extracting directly from the URL first (lets node-vibrant/Jimp fetch and decode)
    let palette;
    try {
      palette = await Vibrant.from(src).maxColorCount(8).getPalette();

    } catch (e) {
      // Fallback: fetch as Buffer and extract
      const res = await fetch(src, { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36', 'Accept': 'image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5', 'Referer': new URL(src).origin } });
      if (!res.ok) {
        return NextResponse.json({ error: 'Failed to fetch image', status: res.status }, { status: 400, headers: corsHeaders() });
      }
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      palette = await Vibrant.from(buffer).maxColorCount(8).getPalette();
    }

    const toHex = (swatch: any, fallback = '#7c3aed') => swatch?.hex || fallback;

    const primary = toHex(palette.Vibrant, '#7c3aed');
    const secondary = toHex(palette.LightVibrant, '#06b6d4');
    const accent = toHex(palette.Muted, '#ec4899');
    const background = toHex(palette.DarkMuted, '#0b1020');
    const muted = toHex(palette.DarkVibrant, '#17203a');

    return NextResponse.json({ primary, secondary, background, muted, accent }, { headers: corsHeaders() });
  } catch (e: any) {
    return NextResponse.json({ error: 'Palette extraction failed', detail: String(e?.message || e) }, { status: 500, headers: corsHeaders() });
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders() });
}
