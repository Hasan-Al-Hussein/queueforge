import type { JSX } from 'react';
import { clips, clipTrimBefore, fallbackScreens } from '../assets';
import { ActionCue, palette, RecordingFrame, SceneCanvas, StepBadge } from '../shared';
import { CHAPTER_DURATIONS } from '../timing';

export const SubmitScene = (): JSX.Element => (
  <SceneCanvas>
    <RecordingFrame
      clip={clips.submit}
      fallback={fallbackScreens.submit}
      durationInFrames={CHAPTER_DURATIONS.submit}
      label="Operator enters, reviews, and submits Expense review"
      trimBefore={clipTrimBefore.submit}
      playbackRate={0.75}
    />
    <ActionCue from={64} duration={110} x={900} y={360} label="Choose Expense review" />
    <ActionCue
      from={220}
      duration={210}
      x={730}
      y={610}
      label="Enter the request details"
      accent={palette.proof}
    />
    <ActionCue from={560} duration={210} x={1440} y={850} label="Review the route, then send" />
    <StepBadge step="STEP 1" title="Submit the request" role="Omar · Operator" />
  </SceneCanvas>
);
