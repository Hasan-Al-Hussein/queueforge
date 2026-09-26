export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const CHAPTER_DURATIONS = {
  problem: 690,
  solution: 450,
  roles: 810,
  'admin-tour': 1740,
  submit: 990,
  approve: 690,
  'process-deliver': 1020,
  result: 840,
  pipeline: 630,
  close: 420,
} as const;

export const CHAPTERS = [
  {
    id: 'problem',
    label: 'The problem',
    startFrame: 0,
    durationInFrames: CHAPTER_DURATIONS.problem,
  },
  {
    id: 'solution',
    label: 'The solution',
    startFrame: 690,
    durationInFrames: CHAPTER_DURATIONS.solution,
  },
  {
    id: 'roles',
    label: 'People and roles',
    startFrame: 1140,
    durationInFrames: CHAPTER_DURATIONS.roles,
  },
  {
    id: 'admin-tour',
    label: 'Workspace tour',
    startFrame: 1950,
    durationInFrames: CHAPTER_DURATIONS['admin-tour'],
  },
  {
    id: 'submit',
    label: 'Step 1 · Submit',
    startFrame: 3690,
    durationInFrames: CHAPTER_DURATIONS.submit,
  },
  {
    id: 'approve',
    label: 'Step 2 · Approve',
    startFrame: 4680,
    durationInFrames: CHAPTER_DURATIONS.approve,
  },
  {
    id: 'process-deliver',
    label: 'Step 3 · Process and deliver',
    startFrame: 5370,
    durationInFrames: CHAPTER_DURATIONS['process-deliver'],
  },
  {
    id: 'result',
    label: 'The result',
    startFrame: 6390,
    durationInFrames: CHAPTER_DURATIONS.result,
  },
  {
    id: 'pipeline',
    label: 'How it works',
    startFrame: 7230,
    durationInFrames: CHAPTER_DURATIONS.pipeline,
  },
  {
    id: 'close',
    label: 'Every handoff leaves proof',
    startFrame: 7860,
    durationInFrames: CHAPTER_DURATIONS.close,
  },
] as const;

export const TOTAL_FRAMES = 8280;
export const TOTAL_SECONDS = TOTAL_FRAMES / FPS;

export const AUDIO_START_FRAMES_WITHIN_SCENE = 8;

export const CAPTION_SOURCES = CHAPTERS.map((chapter) => ({
  src: `narration-v3/${chapter.id}.captions.json`,
  offsetMs: Math.round(((chapter.startFrame + AUDIO_START_FRAMES_WITHIN_SCENE) / FPS) * 1000),
}));

export const sceneFrames = (seconds: number): number => Math.round(seconds * FPS);
