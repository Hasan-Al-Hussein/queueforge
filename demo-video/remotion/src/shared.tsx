import { Video } from '@remotion/media';
import type { Caption } from '@remotion/captions';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from 'remotion';
import { LIVE_CLIPS_ENABLED } from './assets';
import { formatCaptionText } from './caption-display';
import { CAPTION_SOURCES } from './timing';

export const palette = {
  canvas: '#071216',
  shell: '#0B181D',
  surface: '#0D1A20',
  raised: '#14242B',
  rule: '#294047',
  strongRule: '#3A555D',
  ink: '#F3F1E9',
  muted: '#A4B2B5',
  brass: '#E4A84B',
  copper: '#A76524',
  proof: '#42CEB5',
  danger: '#FF8798',
  paper: '#F8F7F2',
};

export const gridBackground: CSSProperties = {
  backgroundColor: palette.canvas,
  backgroundImage:
    'linear-gradient(rgba(66,206,181,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(66,206,181,0.035) 1px, transparent 1px), radial-gradient(circle at 78% 16%, rgba(228,168,75,0.1), transparent 32%)',
  backgroundSize: '72px 72px, 72px 72px, 100% 100%',
};

export const SceneCanvas = ({ children }: { children: ReactNode }): JSX.Element => (
  <AbsoluteFill
    style={{
      ...gridBackground,
      color: palette.ink,
      fontFamily: 'Plus Jakarta Sans',
      overflow: 'hidden',
    }}
  >
    {children}
  </AbsoluteFill>
);

export const RecordingFrame = ({
  clip,
  fallback,
  durationInFrames,
  label,
  trimBefore = 0,
  dim = 0,
  objectFit = 'fill',
  playbackRate = 1,
  animateIn = true,
  live = LIVE_CLIPS_ENABLED,
}: {
  clip: string;
  fallback: string;
  durationInFrames: number;
  label: string;
  trimBefore?: number;
  dim?: number;
  objectFit?: 'contain' | 'cover' | 'fill';
  playbackRate?: number;
  animateIn?: boolean;
  live?: boolean;
}): JSX.Element => {
  const frame = useCurrentFrame();
  const reveal = animateIn
    ? interpolate(frame, [0, 14], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      })
    : 1;
  const scale = animateIn
    ? interpolate(frame, [0, 18], [0.992, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        output: 'perceptual-scale',
      })
    : 1;

  return (
    <div
      style={{
        position: 'absolute',
        left: 192,
        top: 18,
        width: 1536,
        height: 960,
        overflow: 'hidden',
        background: palette.surface,
        border: `1px solid ${palette.strongRule}`,
        boxShadow: '0 32px 100px rgba(0,0,0,0.38), inset 0 1px rgba(255,255,255,0.05)',
        opacity: reveal,
        scale,
      }}
    >
      {live ? (
        <Video
          name={label}
          src={staticFile(clip)}
          trimBefore={trimBefore}
          durationInFrames={durationInFrames}
          playbackRate={playbackRate}
          objectFit={objectFit}
          muted
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        <>
          <Img
            src={staticFile(fallback)}
            style={{ width: '100%', height: '100%', objectFit, objectPosition: 'center top' }}
          />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(5,13,17,0.18)' }} />
          <div
            style={{
              position: 'absolute',
              right: 22,
              bottom: 22,
              padding: '9px 13px',
              border: `1px solid ${palette.brass}`,
              background: 'rgba(5,13,17,0.9)',
              color: palette.brass,
              fontFamily: 'IBM Plex Mono',
              fontSize: 14,
            }}
          >
            LIVE CLIP PENDING · {label}
          </div>
        </>
      )}
      {dim > 0 ? (
        <div style={{ position: 'absolute', inset: 0, background: `rgba(5,13,17,${dim})` }} />
      ) : null}
    </div>
  );
};

export const SceneLabel = ({
  chapter,
  title,
  align = 'left',
}: {
  chapter: string;
  title: string;
  align?: 'left' | 'right';
}): JSX.Element => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [4, 18, 96, 116], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: align === 'left' ? 150 : undefined,
        right: align === 'right' ? 150 : undefined,
        top: 38,
        zIndex: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 15px',
        background: 'rgba(5,13,17,0.92)',
        border: `1px solid ${palette.rule}`,
        borderLeft: `3px solid ${palette.brass}`,
        boxShadow: '0 10px 34px rgba(0,0,0,0.24)',
        opacity: reveal,
        translate: `${align === 'left' ? (1 - reveal) * -14 : (1 - reveal) * 14}px 0px`,
      }}
    >
      <span
        style={{
          fontFamily: 'IBM Plex Mono',
          color: palette.brass,
          fontSize: 13,
          letterSpacing: '0.08em',
        }}
      >
        {chapter}
      </span>
      <span style={{ fontSize: 20, fontWeight: 700 }}>{title}</span>
    </div>
  );
};

export const StepBadge = ({
  step,
  title,
  role,
}: {
  step: string;
  title: string;
  role: string;
}): JSX.Element => {
  const frame = useCurrentFrame();
  const contextOpacity = interpolate(frame, [4, 18, 96, 116], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <>
      <SceneLabel chapter={step} title={title} />
      <div
        style={{
          position: 'absolute',
          right: 192,
          top: 38,
          zIndex: 12,
          padding: '10px 15px',
          background: 'rgba(5,13,17,0.92)',
          border: `1px solid ${palette.rule}`,
          color: palette.muted,
          fontSize: 16,
          opacity: contextOpacity,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            marginRight: 10,
            background: palette.proof,
            rotate: '45deg',
          }}
        />
        {role}
      </div>
    </>
  );
};

export const ActionCue = ({
  from,
  duration,
  x,
  y,
  label,
  accent = palette.brass,
  side = 'right',
}: {
  from: number;
  duration: number;
  x: number;
  y: number;
  label: string;
  accent?: string;
  side?: 'left' | 'right';
}): JSX.Element | null => {
  const frame = useCurrentFrame();
  const localFrame = frame - from;
  if (localFrame < 0 || localFrame >= duration) return null;
  const reveal = interpolate(localFrame, [0, 8, duration - 10, duration], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const pointerOffset = interpolate(localFrame, [0, 14], [34, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const clickAt = Math.min(18, Math.max(10, Math.floor(duration * 0.18)));
  const clickOpacity = interpolate(
    localFrame,
    [clickAt - 2, clickAt + 3, clickAt + 14],
    [0, 0.85, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const clickScale = interpolate(localFrame, [clickAt - 2, clickAt + 14], [0.55, 1.75], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    output: 'perceptual-scale',
  });
  const labelReveal = interpolate(localFrame, [8, 16, duration - 10, duration], [0, 1, 1, 0], {
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
        zIndex: 14,
        opacity: reveal,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -18,
          top: -18,
          width: 36,
          height: 36,
          borderRadius: 999,
          border: `2px solid ${accent}`,
          scale: clickScale,
          opacity: clickOpacity,
        }}
      />
      <svg
        aria-hidden
        viewBox="0 0 30 38"
        width="30"
        height="38"
        style={{
          position: 'absolute',
          left: -24 + pointerOffset,
          top: -31 + pointerOffset,
          filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.55))',
        }}
      >
        <path
          d="M2 2L27 21H16L11 35L5 32L10 19H2Z"
          fill={palette.paper}
          stroke={palette.canvas}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: side === 'right' ? 32 : undefined,
          right: side === 'left' ? 32 : undefined,
          top: -24,
          width: 'max-content',
          maxWidth: 300,
          padding: '9px 12px 10px',
          background: 'rgba(5,13,17,0.94)',
          border: `1px solid ${palette.rule}`,
          borderLeft: side === 'right' ? `3px solid ${accent}` : undefined,
          borderRight: side === 'left' ? `3px solid ${accent}` : undefined,
          color: palette.ink,
          fontSize: 16,
          lineHeight: 1.3,
          fontWeight: 650,
          opacity: labelReveal,
        }}
      >
        {label}
      </div>
    </div>
  );
};

const wrapCaption = (text: string, maxCharacters = 34): string => {
  const words = text.trim().split(/\s+/u);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxCharacters || current.length === 0) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current.length > 0) lines.push(current);
  return lines.join('\n');
};

export const CaptionLayer = (): JSX.Element | null => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender('Loading final narration captions'));
  const loadCaptions = useCallback(async (): Promise<void> => {
    try {
      const groups = await Promise.all(
        CAPTION_SOURCES.map(async (source) => {
          const response = await fetch(staticFile(source.src));
          if (!response.ok)
            throw new Error(`Could not load ${source.src}: HTTP ${response.status}`);
          const localCaptions = (await response.json()) as Caption[];
          return localCaptions.map((caption) => ({
            ...caption,
            startMs: caption.startMs + source.offsetMs,
            endMs: caption.endMs + source.offsetMs,
          }));
        }),
      );
      setCaptions(groups.flat().sort((left, right) => left.startMs - right.startMs));
      continueRender(handle);
    } catch (error) {
      cancelRender(error);
    }
  }, [cancelRender, continueRender, handle]);

  useEffect(() => {
    void loadCaptions();
  }, [loadCaptions]);

  if (captions === null) return null;
  const now = (frame / fps) * 1000;
  const caption = captions.find((item) => now >= item.startMs && now < item.endMs);
  if (caption === undefined) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 320,
        right: 320,
        bottom: 26,
        zIndex: 30,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: 'max-content',
          maxWidth: 980,
          padding: '10px 18px 12px',
          background: 'rgba(5,13,17,0.93)',
          border: `1px solid ${palette.strongRule}`,
          borderTop: `2px solid ${palette.brass}`,
          color: '#FFFFFF',
          boxShadow: '0 12px 34px rgba(0,0,0,0.28)',
          fontFamily: 'Plus Jakarta Sans',
          fontSize: 26,
          lineHeight: 1.25,
          fontWeight: 650,
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
        }}
      >
        {wrapCaption(formatCaptionText(caption.text))}
      </div>
    </div>
  );
};
