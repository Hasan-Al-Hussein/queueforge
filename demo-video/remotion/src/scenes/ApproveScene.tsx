import type { JSX } from 'react';
import { clips, clipTrimBefore, fallbackScreens } from '../assets';
import { ActionCue, palette, RecordingFrame, SceneCanvas, StepBadge } from '../shared';
import { CHAPTER_DURATIONS } from '../timing';

export const ApproveScene = (): JSX.Element => (
  <SceneCanvas>
    <RecordingFrame
      clip={clips.approve}
      fallback={fallbackScreens.approve}
      durationInFrames={CHAPTER_DURATIONS.approve}
      label="Approver reviews and decides"
      trimBefore={clipTrimBefore.approve}
      playbackRate={0.71}
    />
    <StepBadge step="STEP 2" title="Record an independent decision" role="Amina · Approver" />
    <ActionCue from={70} duration={150} x={780} y={540} label="Search the request summary" />
    <ActionCue
      from={250}
      duration={130}
      x={1400}
      y={720}
      label="Check amount and cost center"
      accent={palette.proof}
    />
    <ActionCue from={450} duration={150} x={1470} y={820} label="Approve with a recorded note" />
  </SceneCanvas>
);
