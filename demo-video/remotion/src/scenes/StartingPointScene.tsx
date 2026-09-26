import type { JSX } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { clips, clipTrimBefore, fallbackScreens } from '../assets';
import { palette, RecordingFrame, SceneCanvas, SceneLabel } from '../shared';
import { CHAPTER_DURATIONS } from '../timing';

export const RolesScene = (): JSX.Element => {
  const frame = useCurrentFrame();
  const responsibilityOpacity = interpolate(frame, [0, 12, 720, 780], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <SceneCanvas>
      <RecordingFrame
        clip={clips.login}
        fallback={fallbackScreens.login}
        durationInFrames={CHAPTER_DURATIONS.roles}
        label="Operator sign in and workspace orientation"
        trimBefore={clipTrimBefore.login}
        playbackRate={0.84}
      />
      <SceneLabel chapter="02" title="People and roles" />
      <div
        style={{
          position: 'absolute',
          right: 292,
          top: 156,
          zIndex: 12,
          padding: '10px 14px',
          background: 'rgba(5,13,17,0.94)',
          border: `1px solid ${palette.rule}`,
          borderLeft: `3px solid ${palette.proof}`,
          color: palette.ink,
          fontSize: 15,
          fontWeight: 650,
        }}
      >
        <span style={{ color: palette.muted, fontSize: 13, marginRight: 9 }}>Example shown</span>
        Omar · Operator
      </div>
      <div
        style={{
          position: 'absolute',
          left: 170,
          bottom: 132,
          zIndex: 12,
          width: 660,
          padding: '24px 26px',
          background: 'rgba(5,13,17,0.94)',
          border: `1px solid ${palette.rule}`,
          borderLeft: `4px solid ${palette.proof}`,
          opacity: responsibilityOpacity,
        }}
      >
        <div style={{ fontSize: 17, color: palette.proof, fontWeight: 700 }}>
          Three separate responsibilities
        </div>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}
        >
          {[
            'Operator · Omar submits',
            'Approver · Amina decides',
            'Administrator · configures',
          ].map((item) => (
            <div
              key={item}
              style={{
                padding: '12px 10px',
                textAlign: 'center',
                background: palette.raised,
                border: `1px solid ${palette.rule}`,
                fontSize: 16,
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </SceneCanvas>
  );
};
