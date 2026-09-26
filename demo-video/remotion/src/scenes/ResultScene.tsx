import type { JSX } from 'react';
import { Sequence } from 'remotion';
import { clips, clipTrimBefore, fallbackScreens } from '../assets';
import { ActionCue, palette, RecordingFrame, SceneCanvas, SceneLabel } from '../shared';
import { CHAPTER_DURATIONS } from '../timing';

export const ResultScene = (): JSX.Element => (
  <SceneCanvas>
    <Sequence from={0} durationInFrames={96} name="Completion notification">
      <RecordingFrame
        clip={clips.audit}
        fallback={fallbackScreens.audit}
        durationInFrames={96}
        label="Completion notification"
        trimBefore={clipTrimBefore.result}
        playbackRate={2.1}
      />
    </Sequence>
    <Sequence from={96} durationInFrames={264} name="Search correlated audit evidence">
      <RecordingFrame
        clip={clips.audit}
        fallback={fallbackScreens.audit}
        durationInFrames={264}
        label="Search correlated audit evidence"
        trimBefore={201}
        playbackRate={0.556}
        animateIn={false}
      />
    </Sequence>
    <Sequence
      from={360}
      durationInFrames={CHAPTER_DURATIONS.result - 360}
      name="Open retained activity details"
    >
      <RecordingFrame
        clip={clips.audit}
        fallback={fallbackScreens.audit}
        durationInFrames={CHAPTER_DURATIONS.result - 360}
        label="Open retained activity details"
        trimBefore={351}
        playbackRate={0.31}
        animateIn={false}
      />
    </Sequence>
    <Sequence
      from={560}
      durationInFrames={CHAPTER_DURATIONS.result - 560}
      name="Beginner-friendly retained evidence summary"
    >
      <div
        style={{
          position: 'absolute',
          left: 600,
          top: 662,
          width: 720,
          minHeight: 180,
          padding: '18px 20px',
          background: 'rgba(248,247,242,0.985)',
          border: `1px solid ${palette.strongRule}`,
          borderLeft: `4px solid ${palette.brass}`,
          boxShadow: '0 12px 30px rgba(5,13,17,0.18)',
          color: palette.canvas,
        }}
      >
        <div style={{ fontSize: 14, lineHeight: 1.3, color: '#526269' }}>
          Retained outcome evidence
        </div>
        <div style={{ marginTop: 8, fontSize: 22, lineHeight: 1.25, fontWeight: 750 }}>
          The request completed on attempt 2.
        </div>
        <div
          style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}
        >
          {['Retry recorded', 'Notification created', 'Delivery created'].map((item) => (
            <div
              key={item}
              style={{
                padding: '10px 11px',
                border: '1px solid #B7C2C3',
                background: '#EEF0EC',
                fontSize: 14,
                lineHeight: 1.3,
                fontWeight: 650,
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </Sequence>
    <ActionCue
      from={20}
      duration={65}
      x={710}
      y={710}
      label="Omar sees the completed result"
      accent={palette.proof}
    />
    <ActionCue
      from={340}
      duration={55}
      x={1570}
      y={585}
      label="Newest completion · 12:42 AM"
      side="left"
      accent={palette.proof}
    />
    <SceneLabel chapter="RESULT" title="One request, one explainable record" />
  </SceneCanvas>
);
