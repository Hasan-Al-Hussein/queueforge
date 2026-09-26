import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FPS, HEIGHT, TOTAL_FRAMES, TOTAL_SECONDS, WIDTH } from '../src/timing';

const projectRoot = resolve(process.cwd(), '../..');
const videoPath = resolve(process.cwd(), '../output/product-demo.mp4');
const captionsPath = resolve(process.cwd(), '../output/product-demo.srt');
const reportPath = resolve(process.cwd(), '../output/media-report.json');
const loudnessReportPath = resolve(process.cwd(), '../output/audio-loudness-report.json');

if (!existsSync(videoPath)) throw new Error(`Video not found: ${videoPath}`);
if (!existsSync(captionsPath)) throw new Error(`Captions not found: ${captionsPath}`);
if (!existsSync(loudnessReportPath))
  throw new Error(`Loudness report not found: ${loudnessReportPath}`);

const packageStore = resolve(projectRoot, 'node_modules/.pnpm');
const compositorDirectory = readdirSync(packageStore).find((name) =>
  name.startsWith('@remotion+compositor-win32-x64-msvc@4.0.518'),
);
if (compositorDirectory === undefined)
  throw new Error('Remotion 4.0.518 Windows compositor is not installed.');

const ffprobe = resolve(
  packageStore,
  compositorDirectory,
  'node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe',
);
const probeOutput = execFileSync(
  ffprobe,
  [
    '-v',
    'error',
    '-count_frames',
    '-show_entries',
    'format=duration,size:stream=index,codec_name,codec_type,duration,pix_fmt,width,height,avg_frame_rate,nb_read_frames,sample_rate,channels,bit_rate',
    '-of',
    'json',
    videoPath,
  ],
  { encoding: 'utf8' },
);

const probe = JSON.parse(probeOutput) as {
  format: { duration: string; size: string };
  streams: Array<{
    codec_name: string;
    codec_type: string;
    duration?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    nb_read_frames?: string;
    sample_rate?: string;
    channels?: number;
    bit_rate?: string;
  }>;
};
const video = probe.streams.find((stream) => stream.codec_type === 'video');
const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
if (video === undefined) throw new Error('The final file has no video stream.');

const loudnessReport = JSON.parse(readFileSync(loudnessReportPath, 'utf8')) as {
  target: { integratedLoudnessLufs: number; truePeakDbtp: number; loudnessRangeLu: number };
  finalMeasurement: { input_i: string; input_tp: string; input_lra: string };
};
const measuredIntegratedLoudness = Number(loudnessReport.finalMeasurement.input_i);
const measuredTruePeak = Number(loudnessReport.finalMeasurement.input_tp);

const captionText = readFileSync(captionsPath, 'utf8').trim();
const captionBlocks = captionText.length === 0 ? [] : captionText.split(/\r?\n\r?\n/);
const parseSrtTime = (value: string): number => {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value);
  if (match === null) throw new Error(`Invalid SRT timestamp: ${value}`);
  return (
    ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4])
  );
};
let previousEnd = 0;
for (const [index, block] of captionBlocks.entries()) {
  const lines = block.split(/\r?\n/);
  if (Number(lines[0]) !== index + 1)
    throw new Error(`Caption index ${index + 1} is not sequential.`);
  const [startText, endText] = lines[1].split(' --> ');
  const start = parseSrtTime(startText);
  const end = parseSrtTime(endText);
  if (start < previousEnd || end <= start)
    throw new Error(`Caption ${index + 1} is overlapping or empty.`);
  previousEnd = end;
}

const containerDurationSeconds = Number(probe.format.duration);
const videoDurationSeconds = Number(video.duration ?? probe.format.duration);
const checks = {
  // AAC is packetized and may pad the MP4 container beyond the final video
  // frame. The authored timeline is therefore proven by the video stream and
  // exact frame count, while container padding remains tightly bounded.
  durationMatchesComposition: Math.abs(videoDurationSeconds - TOTAL_SECONDS) <= 1 / FPS,
  containerPaddingIsBounded:
    containerDurationSeconds - videoDurationSeconds >= 0 &&
    containerDurationSeconds - videoDurationSeconds <= 0.15,
  dimensionsAreCorrect: video.width === WIDTH && video.height === HEIGHT,
  frameRateIsCorrect: video.avg_frame_rate === `${FPS}/1`,
  frameCountMatchesComposition: Number(video.nb_read_frames) === TOTAL_FRAMES,
  videoIsH264Yuv420p: video.codec_name === 'h264' && video.pix_fmt === 'yuv420p',
  audioIsAac48Khz: audio?.codec_name === 'aac' && Number(audio.sample_rate) === 48_000,
  audioIsMono: audio?.channels === 1,
  loudnessMatchesLocalGuardTreatment:
    Math.abs(measuredIntegratedLoudness - -16.8) <= 0.4 && measuredTruePeak <= -2.0,
  captionsArePresent: captionBlocks.length > 0,
  captionsEndInsideVideo: previousEnd <= videoDurationSeconds * 1000,
};
const pass = Object.values(checks).every(Boolean);
const report = {
  generatedAt: new Date().toISOString(),
  pass,
  expected: {
    durationSeconds: TOTAL_SECONDS,
    frames: TOTAL_FRAMES,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
  },
  observed: {
    videoDurationSeconds,
    containerDurationSeconds,
    frames: Number(video.nb_read_frames),
    fps: video.avg_frame_rate,
    width: video.width,
    height: video.height,
    videoCodec: video.codec_name,
    pixelFormat: video.pix_fmt,
    audioCodec: audio?.codec_name,
    audioSampleRate: Number(audio?.sample_rate),
    audioChannels: audio?.channels,
    audioBitRate: Number(audio?.bit_rate),
    integratedLoudnessLufs: measuredIntegratedLoudness,
    truePeakDbtp: measuredTruePeak,
    bytes: Number(probe.format.size),
    captionCues: captionBlocks.length,
    lastCaptionEndSeconds: previousEnd / 1000,
  },
  checks,
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!pass) process.exitCode = 1;
