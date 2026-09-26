import type { JSX } from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { palette } from './shared';

export const QueueForgePoster = (): JSX.Element => (
  <AbsoluteFill
    style={{
      background: palette.canvas,
      color: palette.ink,
      fontFamily: 'Plus Jakarta Sans',
      overflow: 'hidden',
    }}
  >
    <Img
      src={staticFile('screenshots/dark/01-admin-overview.png')}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        scale: 1.12,
        filter: 'brightness(0.42) saturate(0.9)',
      }}
    />
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background:
          'linear-gradient(90deg, rgba(5,13,17,0.98) 0%, rgba(5,13,17,0.8) 48%, rgba(5,13,17,0.2) 100%)',
      }}
    />
    <div style={{ position: 'absolute', left: 112, top: 110, width: 980 }}>
      <div
        style={{
          fontFamily: 'IBM Plex Mono',
          fontSize: 18,
          color: palette.proof,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        QueueForge guided product demo · 1:52
      </div>
      <div style={{ fontSize: 112, lineHeight: 0.94, fontWeight: 790, marginTop: 34 }}>
        Every handoff
        <br />
        <span style={{ color: palette.brass }}>leaves proof.</span>
      </div>
      <div
        style={{ fontSize: 28, lineHeight: 1.45, color: palette.muted, marginTop: 34, width: 850 }}
      >
        Follow one live Expense review from validated input to independent approval, durable
        processing, signed delivery, and correlated evidence.
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 42 }}>
        {['Intake', 'Decision', 'Process', 'Delivery'].map((label, index) => (
          <div
            key={label}
            style={{
              padding: '12px 18px',
              border: `1px solid ${index === 3 ? palette.proof : palette.rule}`,
              background: palette.surface,
              fontFamily: 'IBM Plex Mono',
              color: index === 3 ? palette.proof : palette.ink,
            }}
          >
            <span style={{ color: palette.brass }}>0{index + 1}</span> {label}
          </div>
        ))}
      </div>
    </div>
    <div
      style={{
        position: 'absolute',
        right: 170,
        top: 410,
        width: 180,
        height: 180,
        borderRadius: 999,
        background: palette.brass,
        boxShadow: '0 30px 90px rgba(228,168,75,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 0,
          height: 0,
          borderTop: '34px solid transparent',
          borderBottom: '34px solid transparent',
          borderLeft: '54px solid #071216',
          marginLeft: 14,
        }}
      />
    </div>
    <div
      style={{
        position: 'absolute',
        left: 112,
        right: 112,
        bottom: 70,
        borderTop: `1px solid ${palette.rule}`,
        paddingTop: 20,
        display: 'flex',
        justifyContent: 'space-between',
        color: palette.muted,
        fontSize: 18,
      }}
    >
      <span>Synthetic local demonstration</span>
      <span>Request → decision → durable work → signed receipt</span>
    </div>
  </AbsoluteFill>
);
