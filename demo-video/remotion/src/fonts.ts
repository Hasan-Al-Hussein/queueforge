import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

export const fontsReady = Promise.all([
  loadFont({
    family: 'Plus Jakarta Sans',
    url: staticFile('fonts/plus-jakarta-sans.woff2'),
    weight: '400 800',
    display: 'block',
  }),
  loadFont({
    family: 'IBM Plex Mono',
    url: staticFile('fonts/ibm-plex-mono-500.woff2'),
    weight: '500',
    display: 'block',
  }),
]);
