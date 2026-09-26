import type { JSX } from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { palette, SceneCanvas, SceneLabel } from '../shared';

const PipelineNode = ({
  index,
  title,
  body,
  x,
  active,
}: {
  index: string;
  title: string;
  body: string;
  x: number;
  active: boolean;
}): JSX.Element => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: 382,
      width: 276,
      height: 220,
      padding: '24px 24px 22px',
      background: active ? palette.raised : palette.surface,
      border: `1px solid ${active ? palette.brass : palette.rule}`,
      boxShadow: active
        ? '0 18px 46px rgba(0,0,0,0.28), inset 0 1px rgba(255,255,255,0.05)'
        : undefined,
    }}
  >
    <div
      style={{
        fontFamily: 'IBM Plex Mono',
        fontSize: 13,
        color: active ? palette.brass : palette.muted,
      }}
    >
      {index}
    </div>
    <div style={{ fontSize: 25, fontWeight: 740, marginTop: 18 }}>{title}</div>
    <div style={{ fontSize: 16, lineHeight: 1.4, color: palette.muted, marginTop: 12 }}>{body}</div>
  </div>
);

export const PipelineScene = (): JSX.Element => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [28, 410], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const activeIndex = Math.min(4, Math.floor(progress * 5));
  const packetX = interpolate(progress, [0, 1], [188, 1646], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <SceneCanvas>
      <SceneLabel chapter="PIPELINE" title="How the request moves" />
      <div style={{ position: 'absolute', left: 150, top: 135, width: 1040 }}>
        <div style={{ fontSize: 57, lineHeight: 1.02, fontWeight: 760 }}>
          Save what happened first.
          <br />
          <span style={{ color: palette.brass }}>Then run the work safely.</span>
        </div>
        <div
          style={{ fontSize: 21, lineHeight: 1.5, color: palette.muted, marginTop: 20, width: 780 }}
        >
          Each component has one clear job, and every result stays connected to the request that
          created it.
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 188,
          right: 188,
          top: 344,
          height: 3,
          background: palette.rule,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 188,
          top: 344,
          height: 3,
          width: `${progress * 80.5}%`,
          maxWidth: 1544,
          background: `linear-gradient(90deg, ${palette.brass}, ${palette.proof})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: packetX,
          top: 335,
          width: 20,
          height: 20,
          rotate: '45deg',
          background: progress > 0.82 ? palette.proof : palette.brass,
          boxShadow: `0 0 30px ${progress > 0.82 ? palette.proof : palette.brass}`,
        }}
      />
      <PipelineNode
        index="01"
        title="Browser"
        body="Collects Omar's input and shows each status."
        x={150}
        active={activeIndex >= 0}
      />
      <PipelineNode
        index="02"
        title="QueueForge service"
        body="Checks who can act and locks the exact request version."
        x={510}
        active={activeIndex >= 1}
      />
      <PipelineNode
        index="03"
        title="Saved record"
        body="Keeps the request state and its next task together."
        x={870}
        active={activeIndex >= 2}
      />
      <PipelineNode
        index="04"
        title="Background worker"
        body="Retries the work while keeping every attempt."
        x={1230}
        active={activeIndex >= 3}
      />
      <PipelineNode
        index="05"
        title="Receiving system"
        body="Accepts the result and returns a signed receipt."
        x={1590}
        active={activeIndex >= 4}
      />
      <div
        style={{
          position: 'absolute',
          left: 360,
          right: 360,
          top: 690,
          minHeight: 150,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          background: 'rgba(13,26,32,0.92)',
          border: `1px solid ${palette.rule}`,
        }}
      >
        <div style={{ padding: '25px 28px', borderRight: `1px solid ${palette.rule}` }}>
          <div style={{ fontFamily: 'IBM Plex Mono', color: palette.proof, fontSize: 13 }}>
            PROOF SURFACE
          </div>
          <div style={{ fontSize: 23, fontWeight: 700, marginTop: 10 }}>Request detail</div>
        </div>
        <div style={{ padding: '25px 28px', borderRight: `1px solid ${palette.rule}` }}>
          <div style={{ fontFamily: 'IBM Plex Mono', color: palette.proof, fontSize: 13 }}>
            PROOF SURFACE
          </div>
          <div style={{ fontSize: 23, fontWeight: 700, marginTop: 10 }}>Notifications</div>
        </div>
        <div style={{ padding: '25px 28px' }}>
          <div style={{ fontFamily: 'IBM Plex Mono', color: palette.proof, fontSize: 13 }}>
            PROOF SURFACE
          </div>
          <div style={{ fontSize: 23, fontWeight: 700, marginTop: 10 }}>Activity log</div>
        </div>
      </div>
    </SceneCanvas>
  );
};
