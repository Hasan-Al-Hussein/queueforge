import type { Caption } from '@remotion/captions';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { formatCaptionText } from '../src/caption-display';
import { CAPTION_SOURCES } from '../src/timing';

const format = (milliseconds: number): string => {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return (
    [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':') +
    ',' +
    String(millis).padStart(3, '0')
  );
};

const captions = (
  await Promise.all(
    CAPTION_SOURCES.map(async (source) => {
      const captionPath = resolve(process.cwd(), 'public', source.src);
      const localCaptions = JSON.parse(await readFile(captionPath, 'utf8')) as Caption[];
      return localCaptions.map((caption) => ({
        ...caption,
        startMs: caption.startMs + source.offsetMs,
        endMs: caption.endMs + source.offsetMs,
      }));
    }),
  )
)
  .flat()
  .sort((left, right) => left.startMs - right.startMs);

const output = captions
  .map(
    (caption, index) =>
      `${index + 1}\n${format(caption.startMs)} --> ${format(caption.endMs)}\n${formatCaptionText(caption.text)}\n`,
  )
  .join('\n');
const destination = resolve(process.cwd(), '../output/product-demo.srt');
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, output, 'utf8');
console.log(destination);
