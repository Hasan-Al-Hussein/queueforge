import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ATTESTATION_FORGE_CLIP_NAME,
  ATTESTATION_FORGE_REQUIRED_NODE_NAMES,
  disposeAttestationForgeModel,
  loadAttestationForgeModel,
} from './attestation-forge-model';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Attestation Forge GLB contract', () => {
  it('loads the shipped asset with its named pivots, canonical clip, and runtime budget', async () => {
    const asset = await readFile(
      resolve(process.cwd(), 'public/3d/queueforge/attestation-forge-v1.glb'),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(asset, {
          headers: { 'content-type': 'model/gltf-binary' },
          status: 200,
        }),
      ),
    );

    const model = await loadAttestationForgeModel(new AbortController().signal);

    expect(model.clip?.name).toBe(ATTESTATION_FORGE_CLIP_NAME);
    expect(model.clip?.duration).toBeCloseTo(12, 3);
    expect(Object.values(model.nodes).map((node) => node.name)).toEqual(
      expect.arrayContaining([...ATTESTATION_FORGE_REQUIRED_NODE_NAMES]),
    );
    expect(model.measurement.assetBytes).toBeLessThanOrEqual(2 * 1_024 * 1_024);
    expect(model.measurement.materialCount).toBeLessThanOrEqual(12);
    expect(model.measurement.modelDrawCalls).toBeLessThanOrEqual(80);
    expect(model.measurement.triangleCount).toBeLessThanOrEqual(40_000);

    disposeAttestationForgeModel(model);
  });
});
