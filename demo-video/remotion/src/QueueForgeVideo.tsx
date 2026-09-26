import { Audio } from '@remotion/media';
import type { JSX } from 'react';
import { AbsoluteFill, Sequence, staticFile } from 'remotion';
import { CaptionLayer } from './shared';
import {
  AdminTourScene,
  ApproveScene,
  CloseScene,
  PipelineScene,
  ProblemScene,
  ProcessDeliverScene,
  ResultScene,
  RolesScene,
  SolutionScene,
  SubmitScene,
} from './scenes';
import { AUDIO_START_FRAMES_WITHIN_SCENE, CHAPTERS } from './timing';

const Narration = ({ id }: { id: string }): JSX.Element => (
  <Sequence from={AUDIO_START_FRAMES_WITHIN_SCENE} layout="none">
    <Audio src={staticFile(`narration-v3/${id}.mp3`)} volume={0.96} />
  </Sequence>
);

export const QueueForgeProductDemo = (): JSX.Element => (
  <AbsoluteFill>
    <Sequence
      from={CHAPTERS[0].startFrame}
      durationInFrames={CHAPTERS[0].durationInFrames}
      name="Problem"
    >
      <ProblemScene />
      <Narration id="problem" />
    </Sequence>
    <Sequence
      from={CHAPTERS[1].startFrame}
      durationInFrames={CHAPTERS[1].durationInFrames}
      name="Solution"
    >
      <SolutionScene />
      <Narration id="solution" />
    </Sequence>
    <Sequence
      from={CHAPTERS[2].startFrame}
      durationInFrames={CHAPTERS[2].durationInFrames}
      name="People and roles"
    >
      <RolesScene />
      <Narration id="roles" />
    </Sequence>
    <Sequence
      from={CHAPTERS[3].startFrame}
      durationInFrames={CHAPTERS[3].durationInFrames}
      name="Workspace tour"
    >
      <AdminTourScene />
      <Narration id="admin-tour" />
    </Sequence>
    <Sequence
      from={CHAPTERS[4].startFrame}
      durationInFrames={CHAPTERS[4].durationInFrames}
      name="Step 1 · Submit"
    >
      <SubmitScene />
      <Narration id="submit" />
    </Sequence>
    <Sequence
      from={CHAPTERS[5].startFrame}
      durationInFrames={CHAPTERS[5].durationInFrames}
      name="Step 2 · Approve"
    >
      <ApproveScene />
      <Narration id="approve" />
    </Sequence>
    <Sequence
      from={CHAPTERS[6].startFrame}
      durationInFrames={CHAPTERS[6].durationInFrames}
      name="Step 3 · Process and deliver"
    >
      <ProcessDeliverScene />
      <Narration id="process-deliver" />
    </Sequence>
    <Sequence
      from={CHAPTERS[7].startFrame}
      durationInFrames={CHAPTERS[7].durationInFrames}
      name="Result"
    >
      <ResultScene />
      <Narration id="result" />
    </Sequence>
    <Sequence
      from={CHAPTERS[8].startFrame}
      durationInFrames={CHAPTERS[8].durationInFrames}
      name="Pipeline"
    >
      <PipelineScene />
      <Narration id="pipeline" />
    </Sequence>
    <Sequence
      from={CHAPTERS[9].startFrame}
      durationInFrames={CHAPTERS[9].durationInFrames}
      name="Close"
    >
      <CloseScene />
      <Narration id="close" />
    </Sequence>
    <CaptionLayer />
  </AbsoluteFill>
);
