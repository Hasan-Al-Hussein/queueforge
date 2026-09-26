import type { JSX } from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { palette, SceneCanvas } from '../shared';

export const CloseScene = (): JSX.Element => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [0, 28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const proof = interpolate(frame, [18, 125], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <SceneCanvas>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 50% 43%, rgba(228,168,75,0.18), transparent 32%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 330,
          right: 330,
          top: 270,
          textAlign: 'center',
          opacity: reveal,
          scale: interpolate(reveal, [0, 1], [0.985, 1], { output: 'perceptual-scale' }),
        }}
      >
        <div
          style={{
            fontFamily: 'IBM Plex Mono',
            color: palette.proof,
            fontSize: 16,
            letterSpacing: '0.13em',
          }}
        >
          QUEUEFORGE · LOCAL DEMONSTRATION
        </div>
        <div style={{ fontSize: 94, lineHeight: 0.98, fontWeight: 780, marginTop: 24 }}>
          Every handoff
          <br />
          <span style={{ color: palette.brass }}>leaves proof.</span>
        </div>
        <div style={{ position: 'relative', height: 44, margin: '42px auto 0', width: 840 }}>
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 20,
              height: 2,
              background: palette.rule,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 20,
              width: `${proof * 100}%`,
              height: 2,
              background: `linear-gradient(90deg, ${palette.brass}, ${palette.proof})`,
            }}
          />
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              style={{
                position: 'absolute',
                left: `${item * 33.333}%`,
                top: 13,
                width: 16,
                height: 16,
                rotate: '45deg',
                background:
                  proof >= item / 3
                    ? item === 3
                      ? palette.proof
                      : palette.brass
                    : palette.surface,
                border: `1px solid ${palette.strongRule}`,
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 17, color: palette.muted, marginTop: 12 }}>
          A clear request · a separate decision · a result anyone can trace
        </div>
      </div>
    </SceneCanvas>
  );
};
