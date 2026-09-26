import type { JSX } from 'react';
import { Composition, Folder } from 'remotion';
import { fontsReady } from './fonts';
import { QueueForgePoster } from './Poster';
import { QueueForgeProductDemo } from './QueueForgeVideo';
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
import { CHAPTERS, FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from './timing';

void fontsReady;

export const RemotionRoot = (): JSX.Element => (
  <>
    <Folder name="QueueForge-Chapters">
      <Composition
        id="QF-Problem"
        component={ProblemScene}
        durationInFrames={CHAPTERS[0].durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="QF-Solution"
        component={SolutionScene}
        durationInFrames={CHAPTERS[1].durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="QF-Roles"
        component={RolesScene}
        durationInFrames={CHAPTERS[2].durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="QF-AdminTour"
        component={AdminTourScene}
        durationInFrames={CHAPTERS[3].durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="QF-Submit"
        component={SubmitScene}
        durationInFrames={CHAPTERS[4].durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="QF-Approve"
        component={ApproveScene}
        durationInFrames={CHAPTERS[5].durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="QF-ProcessDeliver"
        component={ProcessDeliverScene}
        durationInFrames={CHAPTERS[6].durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="QF-Result"
        component={ResultScene}
        durationInFrames={CHAPTERS[7].durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="QF-Pipeline"
        component={PipelineScene}
        durationInFrames={CHAPTERS[8].durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="QF-Close"
        component={CloseScene}
        durationInFrames={CHAPTERS[9].durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </Folder>
    <Composition
      id="QueueForgeProductDemo"
      component={QueueForgeProductDemo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    <Composition
      id="QueueForgePoster"
      component={QueueForgePoster}
      durationInFrames={1}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  </>
);
