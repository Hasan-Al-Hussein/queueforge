import type { JSX } from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { clips, clipTrimBefore, fallbackScreens } from '../assets';
import { palette, RecordingFrame, SceneCanvas, SceneLabel } from '../shared';
import { CHAPTER_DURATIONS } from '../timing';

export const SolutionScene = (): JSX.Element => {
  const frame = useCurrentFrame();
  const plateOpacity = interpolate(frame, [8, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const proofProgress = interpolate(frame, [50, 300], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <SceneCanvas>
      <RecordingFrame
        clip={clips.overview}
        fallback={fallbackScreens.overview}
        durationInFrames={CHAPTER_DURATIONS.solution}
        label="Overview proof forge"
        trimBefore={clipTrimBefore.solution}
        playbackRate={0.25}
      />
      <SceneLabel chapter="01" title="The solution" />
      <div
        style={{
          position: 'absolute',
          left: 170,
          top: 150,
          zIndex: 12,
          width: 800,
          padding: '32px 34px 34px',
          background: '#050D11',
          border: `1px solid ${palette.rule}`,
          borderLeft: `4px solid ${palette.brass}`,
          boxShadow: '0 24px 70px rgba(0,0,0,0.35)',
          opacity: plateOpacity,
        }}
      >
        <div style={{ fontSize: 48, lineHeight: 1.03, fontWeight: 760 }}>
          QueueForge keeps the handoffs connected.
        </div>
        <div style={{ fontSize: 20, lineHeight: 1.5, color: palette.muted, marginTop: 18 }}>
          The request, independent decision, retained attempts, signed delivery, and audit evidence
          stay on one traceable record.
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 360,
          right: 360,
          bottom: 128,
          zIndex: 11,
          height: 78,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          background: 'rgba(5,13,17,0.93)',
          border: `1px solid ${palette.rule}`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 92,
            right: 92,
            top: 20,
            height: 2,
            background: palette.rule,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 92,
            top: 20,
            height: 2,
            width: `${proofProgress * 84}%`,
            maxWidth: 1004,
            background: `linear-gradient(90deg, ${palette.brass}, ${palette.proof})`,
          }}
        />
        {['Intake', 'Decision', 'Process', 'Delivery'].map((stage, index) => (
          <div
            key={stage}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              paddingBottom: 12,
              borderRight: index < 3 ? `1px solid ${palette.rule}` : undefined,
              fontSize: 17,
              fontWeight: 700,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 13,
                width: 14,
                height: 14,
                borderRadius: 999,
                background:
                  proofProgress >= index / 3
                    ? index === 3
                      ? palette.proof
                      : palette.brass
                    : palette.surface,
                border: `2px solid ${proofProgress >= index / 3 ? (index === 3 ? palette.proof : palette.brass) : palette.strongRule}`,
              }}
            />
            {stage}
          </div>
        ))}
      </div>
    </SceneCanvas>
  );
};
