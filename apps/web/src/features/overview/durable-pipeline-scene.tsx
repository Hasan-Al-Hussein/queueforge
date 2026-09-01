'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { QueueRailItem } from '@queueforge/ui';

import { useTheme } from '../../providers/theme-provider';
import styles from './proof-core-webgl.module.css';
import { ProofSpine } from './proof-spine';
import type { SpatialSceneUnavailableReason } from './proof-core-webgl';
import {
  clampProofStageIndex,
  meetsSpatialSceneViewport,
  shouldLoadSpatialScene,
  SPATIAL_SCENE_LOGIN_MIN_HEIGHT,
  SPATIAL_SCENE_MIN_WIDTH,
  type SpatialScenePresentation,
} from './spatial-scene-policy';

export interface DurablePipelineSceneProps {
  readonly items: readonly QueueRailItem[];
  readonly presentation?: SpatialScenePresentation;
}

interface NetworkInformationLike {
  readonly saveData?: boolean;
  addEventListener?(type: 'change', listener: EventListener): void;
  removeEventListener?(type: 'change', listener: EventListener): void;
}

const ProofSpineWebgl = dynamic(
  () => import('./proof-core-webgl').then((module) => module.ProofSpineWebgl),
  { loading: () => null, ssr: false },
);

function networkInformation(): NetworkInformationLike | undefined {
  return (navigator as Navigator & { readonly connection?: NetworkInformationLike }).connection;
}

function supportsWebGl(): boolean {
  const canvas = document.createElement('canvas');
  const options: WebGLContextAttributes = {
    alpha: true,
    failIfMajorPerformanceCaveat: true,
    powerPreference: 'low-power',
  };

  try {
    const context = canvas.getContext('webgl2', options) ?? canvas.getContext('webgl', options);
    if (context === null) return false;
    const vertexPrecision = context.getShaderPrecisionFormat(
      context.VERTEX_SHADER,
      context.HIGH_FLOAT,
    );
    const fragmentPrecision = context.getShaderPrecisionFormat(
      context.FRAGMENT_SHADER,
      context.HIGH_FLOAT,
    );
    if (vertexPrecision === null || fragmentPrecision === null) return false;
    // Losing this probe context immediately can also invalidate the renderer
    // created in the same browser GPU share-group. The detached canvas is left
    // for the browser to collect after this one-time capability check.
    return true;
  } catch {
    return false;
  }
}

export function DurablePipelineScene({
  items,
  presentation = 'overview',
}: DurablePipelineSceneProps): React.JSX.Element {
  const [eligible, setEligible] = useState(false);
  const [runtimeFailureState, setRuntimeFailureState] = useState<{
    readonly identity: string;
    readonly reason: SpatialSceneUnavailableReason;
  } | null>(null);
  const [readyIdentity, setReadyIdentity] = useState<string | null>(null);
  const [stageSelection, setStageSelection] = useState<{
    readonly heldIndex: number | null;
    readonly index: number;
    readonly revision: number;
  }>({ heldIndex: null, index: 0, revision: 0 });
  const { theme } = useTheme();
  const renderIdentity = `${presentation}:${theme}`;
  const runtimeFailure =
    runtimeFailureState?.identity === renderIdentity ? runtimeFailureState.reason : null;
  const webglReady = readyIdentity === renderIdentity;
  const visibleStageCount = Math.min(items.length, 4);
  const safeSelectedStageIndex = clampProofStageIndex(stageSelection.index, visibleStageCount);

  useEffect(() => {
    const widthMedia = window.matchMedia(`(min-width: ${SPATIAL_SCENE_MIN_WIDTH}px)`);
    const heightMedia = window.matchMedia(`(min-height: ${SPATIAL_SCENE_LOGIN_MIN_HEIGHT}px)`);
    const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = networkInformation();
    let webGlAvailable: boolean | null = null;

    const updateEligibility = (): void => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const saveData = connection?.saveData === true;
      const passesCheapGates =
        widthMedia.matches &&
        (presentation === 'overview' || heightMedia.matches) &&
        !motionMedia.matches &&
        !saveData &&
        meetsSpatialSceneViewport(presentation, viewportWidth, viewportHeight);

      if (!passesCheapGates) {
        setReadyIdentity(null);
        setRuntimeFailureState(null);
        setEligible(false);
        return;
      }

      webGlAvailable ??= supportsWebGl();
      setEligible(
        shouldLoadSpatialScene({
          presentation,
          viewportHeight,
          viewportWidth,
          prefersReducedMotion: motionMedia.matches,
          saveData,
          webGlAvailable,
        }),
      );
    };

    const handleCapabilityChange: EventListener = () => {
      updateEligibility();
    };

    updateEligibility();
    widthMedia.addEventListener('change', handleCapabilityChange);
    heightMedia.addEventListener('change', handleCapabilityChange);
    motionMedia.addEventListener('change', handleCapabilityChange);
    connection?.addEventListener?.('change', handleCapabilityChange);

    return () => {
      widthMedia.removeEventListener('change', handleCapabilityChange);
      heightMedia.removeEventListener('change', handleCapabilityChange);
      motionMedia.removeEventListener('change', handleCapabilityChange);
      connection?.removeEventListener?.('change', handleCapabilityChange);
    };
  }, [presentation]);

  const handleUnavailable = useCallback(
    (reason: SpatialSceneUnavailableReason): void => {
      setRuntimeFailureState({ identity: renderIdentity, reason });
    },
    [renderIdentity],
  );
  const handleReady = useCallback((): void => {
    setReadyIdentity(renderIdentity);
  }, [renderIdentity]);
  const handleSelectStage = useCallback((index: number): void => {
    setStageSelection((current) => ({
      heldIndex: index,
      index,
      revision: current.revision + 1,
    }));
  }, []);
  const handleReleaseStage = useCallback((): void => {
    setStageSelection((current) =>
      current.heldIndex === null
        ? current
        : { heldIndex: null, index: current.index, revision: current.revision + 1 },
    );
  }, []);
  const handleCycleStageChange = useCallback((index: number): void => {
    setStageSelection((current) =>
      current.heldIndex !== null || current.index === index
        ? current
        : { heldIndex: null, index, revision: current.revision },
    );
  }, []);
  const rendererMounted = eligible && runtimeFailure === null;
  const active = rendererMounted && webglReady;

  return (
    <div
      className={`qf-durable-scene ${styles.shell}`}
      data-spatial-active={active ? 'true' : 'false'}
      data-spatial-eligible={eligible ? 'true' : 'false'}
      data-spatial-mode={active ? 'webgl' : 'fallback'}
      data-spatial-runtime={runtimeFailure ?? 'ready'}
      data-proof-scenario="illustrative-request"
      data-presentation={presentation}
      data-theme-surface={theme}
    >
      <ProofSpine
        items={items}
        onReleaseStage={handleReleaseStage}
        onSelectStage={handleSelectStage}
        selectedStageIndex={safeSelectedStageIndex}
      />
      {rendererMounted ? (
        <ProofSpineWebgl
          activeStageIndex={safeSelectedStageIndex}
          heldStageIndex={stageSelection.heldIndex}
          items={items}
          key={renderIdentity}
          onCycleStageChange={handleCycleStageChange}
          onReady={handleReady}
          onUnavailable={handleUnavailable}
          presentation={presentation}
          scrubRevision={stageSelection.revision}
        />
      ) : null}
    </div>
  );
}
