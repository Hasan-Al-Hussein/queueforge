import type { JSX } from 'react';
import { Sequence } from 'remotion';
import { TOUR_CLIPS_ENABLED, tourClips, tourFallbackScreens } from '../assets';
import { RecordingFrame, SceneCanvas, SceneLabel } from '../shared';

const TOUR_FRAMES = {
  home: 300,
  requestTypes: 300,
  deliveryConnections: 180,
  peopleAccess: 150,
  processingHealth: 210,
  activityLog: 210,
  notifications: 240,
  recap: 150,
} as const;

export const AdminTourScene = (): JSX.Element => {
  const requestTypesStart = TOUR_FRAMES.home;
  const deliveryStart = requestTypesStart + TOUR_FRAMES.requestTypes;
  const peopleStart = deliveryStart + TOUR_FRAMES.deliveryConnections;
  const processingStart = peopleStart + TOUR_FRAMES.peopleAccess;
  const activityStart = processingStart + TOUR_FRAMES.processingHealth;
  const notificationsStart = activityStart + TOUR_FRAMES.activityLog;
  const recapStart = notificationsStart + TOUR_FRAMES.notifications;

  return (
    <SceneCanvas>
      <Sequence from={0} durationInFrames={TOUR_FRAMES.home} name="Tour · Home">
        <RecordingFrame
          clip={tourClips.home}
          fallback={tourFallbackScreens.home}
          durationInFrames={TOUR_FRAMES.home}
          label="Home overview tour"
          playbackRate={0.7}
          live={TOUR_CLIPS_ENABLED}
        />
      </Sequence>
      <Sequence
        from={requestTypesStart}
        durationInFrames={TOUR_FRAMES.requestTypes}
        name="Tour · Request types"
      >
        <RecordingFrame
          clip={tourClips.requestTypes}
          fallback={tourFallbackScreens.requestTypes}
          durationInFrames={TOUR_FRAMES.requestTypes}
          label="Request types tour"
          playbackRate={0.7}
          live={TOUR_CLIPS_ENABLED}
        />
      </Sequence>
      <Sequence
        from={deliveryStart}
        durationInFrames={TOUR_FRAMES.deliveryConnections}
        name="Tour · Delivery connections"
      >
        <RecordingFrame
          clip={tourClips.deliveryConnections}
          fallback={tourFallbackScreens.deliveryConnections}
          durationInFrames={TOUR_FRAMES.deliveryConnections}
          label="Delivery connections tour"
          playbackRate={0.86}
          live={TOUR_CLIPS_ENABLED}
        />
      </Sequence>
      <Sequence
        from={peopleStart}
        durationInFrames={TOUR_FRAMES.peopleAccess}
        name="Tour · People and access"
      >
        <RecordingFrame
          clip={tourClips.peopleAccess}
          fallback={tourFallbackScreens.peopleAccess}
          durationInFrames={TOUR_FRAMES.peopleAccess}
          label="People and access tour"
          live={TOUR_CLIPS_ENABLED}
        />
      </Sequence>
      <Sequence
        from={processingStart}
        durationInFrames={TOUR_FRAMES.processingHealth}
        name="Tour · Processing health"
      >
        <RecordingFrame
          clip={tourClips.processingHealth}
          fallback={tourFallbackScreens.processingHealth}
          durationInFrames={TOUR_FRAMES.processingHealth}
          label="Processing health tour"
          playbackRate={0.77}
          live={TOUR_CLIPS_ENABLED}
        />
      </Sequence>
      <Sequence
        from={activityStart}
        durationInFrames={TOUR_FRAMES.activityLog}
        name="Tour · Activity log"
      >
        <RecordingFrame
          clip={tourClips.activityLog}
          fallback={tourFallbackScreens.activityLog}
          durationInFrames={TOUR_FRAMES.activityLog}
          label="Activity log tour"
          playbackRate={0.98}
          live={TOUR_CLIPS_ENABLED}
        />
      </Sequence>
      <Sequence
        from={notificationsStart}
        durationInFrames={TOUR_FRAMES.notifications}
        name="Tour · Notifications"
      >
        <RecordingFrame
          clip={tourClips.notifications}
          fallback={tourFallbackScreens.notifications}
          durationInFrames={TOUR_FRAMES.notifications}
          label="Notifications tour"
          playbackRate={0.77}
          live={TOUR_CLIPS_ENABLED}
        />
      </Sequence>
      <Sequence
        from={recapStart}
        durationInFrames={TOUR_FRAMES.recap}
        name="Tour · Workspace recap"
      >
        <RecordingFrame
          clip={tourClips.home}
          fallback={tourFallbackScreens.home}
          durationInFrames={TOUR_FRAMES.recap}
          label="Workspace map recap"
          trimBefore={30}
          playbackRate={0.75}
          live={TOUR_CLIPS_ENABLED}
        />
      </Sequence>
      <SceneLabel chapter="03" title="Workspace tour" />
    </SceneCanvas>
  );
};
