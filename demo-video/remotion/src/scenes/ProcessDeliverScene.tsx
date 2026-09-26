import type { JSX } from 'react';
import { Sequence } from 'remotion';
import { clips, clipTrimBefore, fallbackScreens } from '../assets';
import { palette, RecordingFrame, SceneCanvas, StepBadge } from '../shared';
import { CHAPTER_DURATIONS } from '../timing';

const PROCESSING_FRAMES = 510;
const DELIVERY_FRAMES = CHAPTER_DURATIONS['process-deliver'] - PROCESSING_FRAMES;

export const ProcessDeliverScene = (): JSX.Element => (
  <SceneCanvas>
    <Sequence
      from={0}
      durationInFrames={PROCESSING_FRAMES}
      name="Observe retained processing history"
    >
      <RecordingFrame
        clip={clips.processing}
        fallback={fallbackScreens.processing}
        durationInFrames={PROCESSING_FRAMES}
        label="Request processing"
        trimBefore={clipTrimBefore.processing}
        playbackRate={0.52}
      />
    </Sequence>
    <Sequence
      from={PROCESSING_FRAMES}
      durationInFrames={DELIVERY_FRAMES}
      name="Inspect signed delivery receipt"
    >
      <RecordingFrame
        clip={clips.delivery}
        fallback={fallbackScreens.delivery}
        durationInFrames={DELIVERY_FRAMES}
        label="Signed delivery receipt"
        trimBefore={90}
        playbackRate={0.43}
        animateIn={false}
      />
      <div
        style={{
          position: 'absolute',
          left: 562,
          top: 232,
          width: 700,
          minHeight: 80,
          padding: '3px 0 6px',
          background: '#F8F7F2',
          color: palette.canvas,
        }}
      >
        <div style={{ fontSize: 17, lineHeight: 1.45 }}>
          See where completed results are sent and confirm that they arrived.
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: 'IBM Plex Mono',
            fontSize: 13,
            lineHeight: 1.4,
            color: '#586970',
          }}
        >
          Destination · delivery status · attempt history
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 570,
          top: 592,
          width: 610,
          minHeight: 88,
          padding: '4px 0 6px',
          background: '#E4E8E6',
          color: palette.canvas,
        }}
      >
        <div
          style={{
            fontFamily: 'IBM Plex Mono',
            fontSize: 12,
            lineHeight: 1.4,
            color: '#586970',
            letterSpacing: '0.04em',
          }}
        >
          DELIVERY HISTORY
        </div>
        <div style={{ marginTop: 2, fontSize: 19, lineHeight: 1.35, fontWeight: 700 }}>
          Completed deliveries
        </div>
        <div style={{ marginTop: 2, fontSize: 15, lineHeight: 1.45, color: '#586970' }}>
          Each row shows where the result went and whether it arrived.
        </div>
      </div>
      <Sequence
        from={0}
        durationInFrames={DELIVERY_FRAMES}
        name="Translate receiver response into plain language"
      >
        <div
          style={{
            position: 'absolute',
            left: 1060,
            top: 700,
            width: 190,
            height: 278,
            padding: 0,
            backgroundColor: '#F8F7F2',
            backgroundImage:
              'linear-gradient(to bottom, #E4E8E6 0, #E4E8E6 47px, #9EAAA7 47px, #9EAAA7 48px, transparent 48px, transparent 132px, #C3CCC9 132px, #C3CCC9 133px, transparent 133px, transparent 217px, #C3CCC9 217px, #C3CCC9 218px, transparent 218px)',
            borderLeft: `1px solid ${palette.strongRule}`,
            borderRight: `1px solid ${palette.strongRule}`,
            color: palette.canvas,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 14,
              top: 13,
              fontSize: 13,
              lineHeight: 1.3,
              color: '#506167',
              fontWeight: 700,
            }}
          >
            Result
          </div>
          <div
            style={{
              position: 'absolute',
              left: 14,
              top: 65,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '6px 9px',
              border: `1px solid ${palette.proof}`,
              color: '#087967',
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 999, background: palette.proof }} />
            Accepted
          </div>
        </div>
      </Sequence>
    </Sequence>
    <StepBadge step="STEP 3" title="Process and deliver" role="Automated processing" />
  </SceneCanvas>
);
