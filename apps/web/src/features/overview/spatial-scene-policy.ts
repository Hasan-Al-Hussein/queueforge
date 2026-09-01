export const SPATIAL_SCENE_MIN_WIDTH = 768;
export const SPATIAL_SCENE_LOGIN_MIN_HEIGHT = 600;
export const SPATIAL_SCENE_MAX_DPR = 1.25;
export const SPATIAL_SCENE_TARGET_FPS = 30;
export const SPATIAL_SCENE_CYCLE_MS = 12_000;
export const SPATIAL_SCENE_RECEIPT_DWELL_MS = 1_080;
export const SPATIAL_SCENE_MAX_PARALLAX_DEGREES = 1.5;

export type SpatialScenePresentation = 'login' | 'overview';

const PROOF_STAGE_CHECKPOINTS = [0.2, 0.42, 0.67, 0.86] as const;

export type ProofCyclePhase =
  | 'billet-entry'
  | 'intake-stamp'
  | 'witness-sign'
  | 'retry-memory'
  | 'signed-delivery'
  | 'receipt-dwell'
  | 'cycle-reset';

export interface ProofCycleSnapshot {
  readonly cycleIndex: number;
  readonly elapsedInCycleMs: number;
  readonly phase: ProofCyclePhase;
  readonly progress: number;
  readonly receiptDwelling: boolean;
  readonly stageIndex: number;
}

export interface SpatialSceneCapabilities {
  readonly presentation: SpatialScenePresentation;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly prefersReducedMotion: boolean;
  readonly saveData: boolean;
  readonly webGlAvailable: boolean;
}

export function meetsSpatialSceneViewport(
  presentation: SpatialScenePresentation,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  if (viewportWidth < SPATIAL_SCENE_MIN_WIDTH) return false;
  return presentation === 'overview' || viewportHeight >= SPATIAL_SCENE_LOGIN_MIN_HEIGHT;
}

export function shouldLoadSpatialScene(capabilities: SpatialSceneCapabilities): boolean {
  return (
    meetsSpatialSceneViewport(
      capabilities.presentation,
      capabilities.viewportWidth,
      capabilities.viewportHeight,
    ) &&
    !capabilities.prefersReducedMotion &&
    !capabilities.saveData &&
    capabilities.webGlAvailable
  );
}

export function clampProofStageIndex(index: number, stageCount: number): number {
  if (!Number.isFinite(index) || stageCount <= 0) return 0;
  return Math.min(stageCount - 1, Math.max(0, Math.trunc(index)));
}

export function proofStageProgress(index: number, stageCount: number): number {
  if (stageCount <= 0) return 0;
  const normalizedIndex = clampProofStageIndex(index, stageCount);
  if (stageCount === PROOF_STAGE_CHECKPOINTS.length) {
    return PROOF_STAGE_CHECKPOINTS[normalizedIndex] ?? PROOF_STAGE_CHECKPOINTS[0];
  }
  return (normalizedIndex + 1) / stageCount;
}

export function proofCycleSnapshot(elapsedMs: number): ProofCycleSnapshot {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const cycleIndex = Math.floor(safeElapsedMs / SPATIAL_SCENE_CYCLE_MS);
  const elapsedInCycleMs = safeElapsedMs % SPATIAL_SCENE_CYCLE_MS;
  const progress = elapsedInCycleMs / SPATIAL_SCENE_CYCLE_MS;

  if (progress < 0.08) {
    return {
      cycleIndex,
      elapsedInCycleMs,
      phase: 'billet-entry',
      progress,
      receiptDwelling: false,
      stageIndex: 0,
    };
  }
  if (progress < 0.3) {
    return {
      cycleIndex,
      elapsedInCycleMs,
      phase: 'intake-stamp',
      progress,
      receiptDwelling: false,
      stageIndex: 0,
    };
  }
  if (progress < 0.52) {
    return {
      cycleIndex,
      elapsedInCycleMs,
      phase: 'witness-sign',
      progress,
      receiptDwelling: false,
      stageIndex: 1,
    };
  }
  if (progress < 0.75) {
    return {
      cycleIndex,
      elapsedInCycleMs,
      phase: 'retry-memory',
      progress,
      receiptDwelling: false,
      stageIndex: 2,
    };
  }
  if (progress < 0.9) {
    return {
      cycleIndex,
      elapsedInCycleMs,
      phase: 'signed-delivery',
      progress,
      receiptDwelling: false,
      stageIndex: 3,
    };
  }
  if (elapsedInCycleMs < SPATIAL_SCENE_CYCLE_MS - 120) {
    return {
      cycleIndex,
      elapsedInCycleMs,
      phase: 'receipt-dwell',
      progress,
      receiptDwelling: true,
      stageIndex: 3,
    };
  }
  return {
    cycleIndex,
    elapsedInCycleMs,
    phase: 'cycle-reset',
    progress,
    receiptDwelling: false,
    stageIndex: 3,
  };
}
