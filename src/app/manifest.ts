import type { MetadataRoute } from 'next';
import { LIGHT_BACKGROUND } from '@/lib/theme';

// Deliberately static: this is an unauthenticated public endpoint, and the OS
// caches it at install time, so reading the saved theme per request would add a
// database call for no benefit. The live browser chrome color is handled by
// generateViewport in src/app/layout.tsx instead.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Moli Diary',
    short_name: 'Moli Diary',
    description: '个人日记',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'zh-CN',
    background_color: LIGHT_BACKGROUND,
    theme_color: LIGHT_BACKGROUND,
    icons: [
      { src: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { src: '/icon.png', type: 'image/png', sizes: '512x512' },
      {
        src: '/maskable-512.png',
        type: 'image/png',
        sizes: '512x512',
        purpose: 'maskable',
      },
      { src: '/apple-icon.png', type: 'image/png', sizes: '180x180' },
    ],
  };
}
