import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const ATTESTATION_FORGE_ASSET_URL = '/3d/queueforge/attestation-forge-v1.glb';
export const ATTESTATION_FORGE_CLIP_NAME = 'ProofCycle';

const NODE_NAMES = {
  auditConduit: 'QF_Audit_Conduit',
  cameraTarget: 'QF_Camera_Target',
  carrierRequest: 'QF_Carrier_Request',
  decisionIsland: 'QF_Decision_Island',
  deliveryGate: 'QF_Delivery_Gate',
  deliveryHousing: 'QF_Delivery_Housing',
  deliverySeal: 'QF_Delivery_Seal',
  forgeBed: 'QF_Forge_Bed',
  forgeRoot: 'QF_Forge_Root',
  intakeFrame: 'QF_Intake_Frame',
  intakePress: 'QF_Intake_Press',
  intakeStamp: 'QF_Intake_Stamp',
  processHousing: 'QF_Process_Housing',
  processSurvivor: 'QF_Process_Survivor',
  receiptCarrier: 'QF_Receipt_Carrier',
  retryTray1: 'QF_Retry_Tray_01',
  retryTray2: 'QF_Retry_Tray_02',
  retryTray3: 'QF_Retry_Tray_03',
  stage1: 'QF_Stage_01',
  stage2: 'QF_Stage_02',
  stage3: 'QF_Stage_03',
  stage4: 'QF_Stage_04',
  witnessDie: 'QF_Witness_Die',
  witnessLever: 'QF_Witness_Lever',
  witnessRing: 'QF_Witness_Ring',
} as const;

type AttestationForgeNodeKey = keyof typeof NODE_NAMES;

export type AttestationForgeNodes = Readonly<Record<AttestationForgeNodeKey, THREE.Object3D>>;

export interface AttestationForgeMeasurement {
  readonly assetBytes: number;
  readonly materialCount: number;
  readonly meshCount: number;
  readonly modelDrawCalls: number;
  readonly nodeCount: number;
  readonly textureCount: number;
  readonly triangleCount: number;
}

export interface AttestationForgeModel {
  readonly clip: THREE.AnimationClip | null;
  readonly gltfScene: THREE.Group;
  readonly measurement: AttestationForgeMeasurement;
  readonly nodes: AttestationForgeNodes;
}

export class AttestationForgeContractError extends Error {
  readonly missingNodeNames: readonly string[];

  constructor(missingNodeNames: readonly string[]) {
    super(`Attestation Forge asset is missing nodes: ${missingNodeNames.join(', ')}`);
    this.name = 'AttestationForgeContractError';
    this.missingNodeNames = missingNodeNames;
  }
}

function resolveNodes(scene: THREE.Object3D): AttestationForgeNodes {
  const resolved = {} as Record<AttestationForgeNodeKey, THREE.Object3D>;
  const missingNodeNames: string[] = [];

  for (const [key, nodeName] of Object.entries(NODE_NAMES) as Array<
    [AttestationForgeNodeKey, string]
  >) {
    const node = scene.getObjectByName(nodeName);
    if (node === undefined) missingNodeNames.push(nodeName);
    else resolved[key] = node;
  }

  if (missingNodeNames.length > 0) throw new AttestationForgeContractError(missingNodeNames);
  return resolved;
}

function isTexture(value: unknown): value is THREE.Texture {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'isTexture') === true;
}

function materialTextures(material: THREE.Material): THREE.Texture[] {
  const textures: THREE.Texture[] = [];
  for (const key of Object.keys(material)) {
    const value: unknown = Reflect.get(material, key);
    if (isTexture(value)) textures.push(value);
  }
  return textures;
}

type ForgeMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;

function forgeMesh(object: THREE.Object3D): ForgeMesh | null {
  return object instanceof THREE.Mesh ? (object as ForgeMesh) : null;
}

function measureModel(scene: THREE.Object3D, assetBytes: number): AttestationForgeMeasurement {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let meshCount = 0;
  let modelDrawCalls = 0;
  let nodeCount = 0;
  let triangleCount = 0;

  scene.traverse((object) => {
    nodeCount += 1;
    const mesh = forgeMesh(object);
    if (mesh === null) return;

    meshCount += 1;
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    modelDrawCalls += Math.max(1, meshMaterials.length);
    for (const material of meshMaterials) {
      materials.add(material);
      for (const texture of materialTextures(material)) textures.add(texture);
    }

    const geometry = mesh.geometry;
    const triangleFactor = object instanceof THREE.InstancedMesh ? object.count : 1;
    const index = geometry.getIndex();
    const vertexCount = index === null ? geometry.getAttribute('position').count : index.count;
    triangleCount += Math.floor(vertexCount / 3) * triangleFactor;
  });

  return {
    assetBytes,
    materialCount: materials.size,
    meshCount,
    modelDrawCalls,
    nodeCount,
    textureCount: textures.size,
    triangleCount,
  };
}

function assetBasePath(assetUrl: URL): string {
  return assetUrl.href.slice(0, assetUrl.href.lastIndexOf('/') + 1);
}

export async function loadAttestationForgeModel(
  signal: AbortSignal,
  assetPath = ATTESTATION_FORGE_ASSET_URL,
): Promise<AttestationForgeModel> {
  const assetUrl = new URL(assetPath, document.baseURI);
  const response = await fetch(assetUrl, {
    cache: 'force-cache',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) throw new Error(`Attestation Forge asset returned HTTP ${response.status}.`);

  const buffer = await response.arrayBuffer();
  signal.throwIfAborted();

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf: GLTF = await loader.parseAsync(buffer, assetBasePath(assetUrl));
  try {
    signal.throwIfAborted();
    const nodes = resolveNodes(gltf.scene);
    const clip =
      THREE.AnimationClip.findByName(gltf.animations, ATTESTATION_FORGE_CLIP_NAME) ?? null;

    return {
      clip,
      gltfScene: gltf.scene,
      measurement: measureModel(gltf.scene, buffer.byteLength),
      nodes,
    };
  } catch (error) {
    disposeSceneResources(gltf.scene);
    throw error;
  }
}

function disposeSceneResources(scene: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  scene.traverse((object) => {
    const mesh = forgeMesh(object);
    if (mesh === null) return;
    geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const texture of materialTextures(material)) textures.add(texture);
    }
  });

  for (const texture of textures) {
    const sourceData: unknown = texture.source.data;
    if (typeof ImageBitmap !== 'undefined' && sourceData instanceof ImageBitmap) sourceData.close();
    texture.dispose();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

export function disposeAttestationForgeModel(model: AttestationForgeModel): void {
  disposeSceneResources(model.gltfScene);
}

export const ATTESTATION_FORGE_REQUIRED_NODE_NAMES = Object.freeze(Object.values(NODE_NAMES));
