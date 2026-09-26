import type { JSX } from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { clips, clipTrimBefore, fallbackScreens } from '../assets';
import { palette, RecordingFrame, SceneCanvas, SceneLabel } from '../shared';
import { CHAPTER_DURATIONS } from '../timing';

const EvidenceCard = ({
  index,
  title,
  detail,
  x,
  y,
  enterAt,
}: {
  index: string;
  title: string;
  detail: string;
  x: number;
  y: number;
  enterAt: number;
}): JSX.Element => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [enterAt, enterAt + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 320,
        padding: '16px 18px',
        zIndex: 10,
        background: 'rgba(13,26,32,0.98)',
        border: `1px solid ${palette.rule}`,
        opacity: reveal,
        translate: `${(1 - reveal) * 24}px 0px`,
      }}
    >
      <div style={{ fontFamily: 'IBM Plex Mono', color: palette.brass, fontSize: 13 }}>{index}</div>
      <div style={{ fontSize: 21, fontWeight: 720, marginTop: 5 }}>{title}</div>
      <div style={{ fontSize: 14, lineHeight: 1.4, color: palette.muted, marginTop: 5 }}>
        {detail}
      </div>
    </div>
  );
};

export const ProblemScene = (): JSX.Element => {
  const frame = useCurrentFrame();
  const headline = interpolate(frame, [4, 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <SceneCanvas>
      <RecordingFrame
        clip={clips.overview}
        fallback={fallbackScreens.overview}
        durationInFrames={CHAPTER_DURATIONS.problem}
        label="Overview proof forge"
        trimBefore={clipTrimBefore.problem}
        dim={0.88}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 8,
          background:
            'linear-gradient(90deg, rgba(5,13,17,0.99) 0%, rgba(5,13,17,0.97) 48%, rgba(5,13,17,0.84) 100%)',
        }}
      />
      <SceneLabel chapter="00" title="The problem" />
      <div
        style={{
          position: 'absolute',
          left: 172,
          top: 190,
          width: 670,
          zIndex: 10,
          opacity: headline,
          translate: `0px ${(1 - headline) * 18}px`,
        }}
      >
        <div style={{ fontSize: 61, lineHeight: 1.03, fontWeight: 760 }}>
          One request.
          <br />
          <span style={{ color: palette.brass }}>Four disconnected stories.</span>
        </div>
        <div
          style={{ fontSize: 20, lineHeight: 1.5, color: palette.muted, marginTop: 22, width: 570 }}
        >
          When each handoff keeps its own history, the team must reconstruct the chain after
          something fails.
        </div>
      </div>
      <EvidenceCard
        index="01"
        title="Request sent"
        detail="The submitted revision lives in one view."
        x={1030}
        y={205}
        enterAt={20}
      />
      <EvidenceCard
        index="02"
        title="Approval recorded"
        detail="The decision is stored somewhere else."
        x={1400}
        y={330}
        enterAt={34}
      />
      <EvidenceCard
        index="03"
        title="Worker retried"
        detail="Earlier attempts disappear into logs."
        x={1030}
        y={535}
        enterAt={48}
      />
      <EvidenceCard
        index="04"
        title="Receiver answered"
        detail="The response is hard to connect back."
        x={1400}
        y={660}
        enterAt={62}
      />
    </SceneCanvas>
  );
};
