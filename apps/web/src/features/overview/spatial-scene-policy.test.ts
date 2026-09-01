import { describe, expect, it } from 'vitest';

import {
  clampProofStageIndex,
  meetsSpatialSceneViewport,
  proofCycleSnapshot,
  proofStageProgress,
  shouldLoadSpatialScene,
  SPATIAL_SCENE_CYCLE_MS,
  SPATIAL_SCENE_MAX_DPR,
  SPATIAL_SCENE_MAX_PARALLAX_DEGREES,
  SPATIAL_SCENE_RECEIPT_DWELL_MS,
  type SpatialSceneCapabilities,
} from './spatial-scene-policy';

const supportedDesktop: SpatialSceneCapabilities = {
  presentation: 'overview',
  viewportHeight: 900,
  viewportWidth: 1_440,
  prefersReducedMotion: false,
  saveData: false,
  webGlAvailable: true,
};

describe('spatial scene loading policy', () => {
  it('loads only when the desktop capability gate is fully satisfied', () => {
    expect(shouldLoadSpatialScene(supportedDesktop)).toBe(true);
    expect(shouldLoadSpatialScene({ ...supportedDesktop, viewportWidth: 768 })).toBe(true);
  });

  it('keeps the Three.js chunk out of constrained sessions', () => {
    expect(shouldLoadSpatialScene({ ...supportedDesktop, viewportWidth: 767 })).toBe(false);
    expect(shouldLoadSpatialScene({ ...supportedDesktop, prefersReducedMotion: true })).toBe(false);
    expect(shouldLoadSpatialScene({ ...supportedDesktop, saveData: true })).toBe(false);
    expect(shouldLoadSpatialScene({ ...supportedDesktop, webGlAvailable: false })).toBe(false);
  });

  it('keeps the login scene static in a short viewport', () => {
    expect(
      shouldLoadSpatialScene({
        ...supportedDesktop,
        presentation: 'login',
        viewportHeight: 600,
        viewportWidth: 768,
      }),
    ).toBe(true);
    expect(
      shouldLoadSpatialScene({
        ...supportedDesktop,
        presentation: 'login',
        viewportHeight: 599,
      }),
    ).toBe(false);
    expect(meetsSpatialSceneViewport('overview', 768, 390)).toBe(true);
    expect(meetsSpatialSceneViewport('login', 844, 390)).toBe(false);
  });

  it('keeps the repeating attestation cycle inside the product budget', () => {
    expect(SPATIAL_SCENE_MAX_DPR).toBeLessThanOrEqual(1.25);
    expect(SPATIAL_SCENE_MAX_PARALLAX_DEGREES).toBeLessThanOrEqual(1.5);
    expect(SPATIAL_SCENE_CYCLE_MS).toBeGreaterThanOrEqual(10_000);
    expect(SPATIAL_SCENE_CYCLE_MS).toBeLessThanOrEqual(14_000);
    expect(SPATIAL_SCENE_RECEIPT_DWELL_MS).toBeGreaterThanOrEqual(800);
    expect(SPATIAL_SCENE_RECEIPT_DWELL_MS).toBeLessThanOrEqual(1_200);
  });
});

describe('proof stage scrubbing', () => {
  it('clamps keyboard-selected stages to the available proof spine', () => {
    expect(clampProofStageIndex(-2, 4)).toBe(0);
    expect(clampProofStageIndex(2.8, 4)).toBe(2);
    expect(clampProofStageIndex(9, 4)).toBe(3);
    expect(clampProofStageIndex(Number.NaN, 4)).toBe(0);
    expect(clampProofStageIndex(2, 0)).toBe(0);
  });

  it('maps four stages to authored cycle checkpoints', () => {
    expect(proofStageProgress(0, 4)).toBe(0.2);
    expect(proofStageProgress(2, 4)).toBe(0.67);
    expect(proofStageProgress(9, 4)).toBe(0.86);
    expect(proofStageProgress(0, 0)).toBe(0);
  });
});

describe('proof cycle measurement hooks', () => {
  it('makes capture checkpoints at four, eight, and twelve seconds visibly distinct', () => {
    expect(proofCycleSnapshot(4_000)).toMatchObject({
      cycleIndex: 0,
      phase: 'witness-sign',
      stageIndex: 1,
    });
    expect(proofCycleSnapshot(8_000)).toMatchObject({
      cycleIndex: 0,
      phase: 'retry-memory',
      stageIndex: 2,
    });
    expect(proofCycleSnapshot(12_000)).toMatchObject({
      cycleIndex: 1,
      phase: 'billet-entry',
      stageIndex: 0,
    });
  });

  it('replays the same semantic sequence in a second complete cycle', () => {
    expect(proofCycleSnapshot(4_000 + SPATIAL_SCENE_CYCLE_MS)).toMatchObject({
      cycleIndex: 1,
      phase: 'witness-sign',
      stageIndex: 1,
    });
    expect(proofCycleSnapshot(8_000 + SPATIAL_SCENE_CYCLE_MS)).toMatchObject({
      cycleIndex: 1,
      phase: 'retry-memory',
      stageIndex: 2,
    });
  });

  it('provides a readable receipt dwell without freezing the loop', () => {
    const dwell = proofCycleSnapshot(11_000);
    expect(dwell.phase).toBe('receipt-dwell');
    expect(dwell.receiptDwelling).toBe(true);
    expect(dwell.stageIndex).toBe(3);
    expect(proofCycleSnapshot(Number.NaN).phase).toBe('billet-entry');
  });
});
