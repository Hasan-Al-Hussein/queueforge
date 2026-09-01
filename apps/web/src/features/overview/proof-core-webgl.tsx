'use client';

import { useEffect, useRef } from 'react';
import type { QueueRailItem } from '@queueforge/ui';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import {
  ATTESTATION_FORGE_ASSET_URL,
  ATTESTATION_FORGE_CLIP_NAME,
  AttestationForgeContractError,
  disposeAttestationForgeModel,
  loadAttestationForgeModel,
  type AttestationForgeModel,
  type AttestationForgeNodes,
} from './attestation-forge-model';
import { createDeferredResourceRelease } from './deferred-resource-release';
import styles from './proof-core-webgl.module.css';
import {
  clampProofStageIndex,
  proofCycleSnapshot,
  proofStageProgress,
  SPATIAL_SCENE_CYCLE_MS,
  SPATIAL_SCENE_MAX_DPR,
  SPATIAL_SCENE_MAX_PARALLAX_DEGREES,
  SPATIAL_SCENE_TARGET_FPS,
  type SpatialScenePresentation,
} from './spatial-scene-policy';

export interface ProofSpineWebglProps {
  readonly activeStageIndex: number;
  readonly heldStageIndex: number | null;
  readonly items: readonly QueueRailItem[];
  readonly onCycleStageChange: (index: number) => void;
  readonly onReady: () => void;
  readonly onUnavailable: (reason: SpatialSceneUnavailableReason) => void;
  readonly presentation: SpatialScenePresentation;
  readonly scrubRevision: number;
}

export type SpatialSceneUnavailableReason =
  | 'asset-contract'
  | 'asset-load'
  | 'context-lost'
  | 'empty-pipeline'
  | 'missing-observer'
  | 'renderer';

interface ProofSceneController {
  setStageHold(index: number | null): void;
}

interface ObjectTransform {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scale: THREE.Vector3;
}

interface ManualAnimationState {
  readonly stageAnchors: readonly THREE.Vector3[];
  readonly transforms: ReadonlyMap<THREE.Object3D, ObjectTransform>;
}

const TARGET_FRAME_MS = 1_000 / SPATIAL_SCENE_TARGET_FPS;
const MAX_STAGE_COUNT = 4;

function cssColor(
  computedStyles: CSSStyleDeclaration,
  property: string,
  fallback: THREE.ColorRepresentation,
): THREE.Color {
  const value = computedStyles.getPropertyValue(property).trim();
  if (value.length === 0 || value.includes('color-mix(') || value.includes('var(')) {
    return new THREE.Color(fallback);
  }

  try {
    return new THREE.Color(value);
  } catch {
    return new THREE.Color(fallback);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothStep(progress: number, start: number, end: number): number {
  const normalized = clamp01((progress - start) / Math.max(0.000_1, end - start));
  return normalized * normalized * (3 - 2 * normalized);
}

function pulse(progress: number, start: number, apex: number, end: number): number {
  if (progress <= start || progress >= end) return 0;
  if (progress <= apex) return smoothStep(progress, start, apex);
  return 1 - smoothStep(progress, apex, end);
}

function captureTransform(object: THREE.Object3D): ObjectTransform {
  return {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
  };
}

function restoreTransform(object: THREE.Object3D, transform: ObjectTransform): void {
  object.position.copy(transform.position);
  object.quaternion.copy(transform.quaternion);
  object.scale.copy(transform.scale);
}

function createManualAnimationState(nodes: AttestationForgeNodes): ManualAnimationState {
  const animatedNodes = [
    nodes.carrierRequest,
    nodes.deliveryGate,
    nodes.deliverySeal,
    nodes.intakePress,
    nodes.intakeStamp,
    nodes.processSurvivor,
    nodes.receiptCarrier,
    nodes.retryTray1,
    nodes.retryTray2,
    nodes.retryTray3,
    nodes.witnessDie,
    nodes.witnessLever,
    nodes.witnessRing,
  ] as const;
  const transforms = new Map<THREE.Object3D, ObjectTransform>();
  for (const object of animatedNodes) transforms.set(object, captureTransform(object));

  nodes.forgeRoot.updateWorldMatrix(true, true);
  const carrierParent = nodes.carrierRequest.parent ?? nodes.forgeRoot;
  const stageAnchors = [nodes.stage1, nodes.stage2, nodes.stage3, nodes.stage4].map((stage) => {
    const anchor = stage.getWorldPosition(new THREE.Vector3());
    return carrierParent.worldToLocal(anchor);
  });

  return { stageAnchors, transforms };
}

function transformOf(state: ManualAnimationState, object: THREE.Object3D): ObjectTransform {
  const transform = state.transforms.get(object);
  if (transform === undefined)
    throw new Error(`Missing manual animation transform for ${object.name}.`);
  return transform;
}

function interpolateCarrierPosition(
  progress: number,
  anchors: readonly THREE.Vector3[],
  target: THREE.Vector3,
): THREE.Vector3 {
  const intake = anchors[0] ?? new THREE.Vector3();
  const decision = anchors[1] ?? intake;
  const process = anchors[2] ?? decision;
  const delivery = anchors[3] ?? process;
  const entry = target.copy(intake).add(new THREE.Vector3(-1.4, 0, 0));

  if (progress < 0.08) return target.lerpVectors(entry, intake, smoothStep(progress, 0.01, 0.08));
  if (progress < 0.27) return target.copy(intake);
  if (progress < 0.32) {
    return target.lerpVectors(intake, decision, smoothStep(progress, 0.27, 0.32));
  }
  if (progress < 0.49) return target.copy(decision);
  if (progress < 0.54) {
    return target.lerpVectors(decision, process, smoothStep(progress, 0.49, 0.54));
  }
  if (progress < 0.72) return target.copy(process);
  if (progress < 0.77) {
    return target.lerpVectors(process, delivery, smoothStep(progress, 0.72, 0.77));
  }
  return target.copy(delivery);
}

function animateNamedPivots(
  nodes: AttestationForgeNodes,
  state: ManualAnimationState,
  progress: number,
  target: THREE.Vector3,
): void {
  for (const [object, transform] of state.transforms) restoreTransform(object, transform);

  const carrierBase = transformOf(state, nodes.carrierRequest);
  nodes.carrierRequest.position.copy(
    interpolateCarrierPosition(progress, state.stageAnchors, target),
  );
  nodes.carrierRequest.position.y += Math.sin(progress * Math.PI * 8) * 0.018;
  const carrierVisibility =
    smoothStep(progress, 0.005, 0.045) * (1 - smoothStep(progress, 0.982, 0.999));
  nodes.carrierRequest.scale
    .copy(carrierBase.scale)
    .multiplyScalar(Math.max(0.001, carrierVisibility));

  const intakeStrike = pulse(progress, 0.13, 0.205, 0.265);
  const intakePressBase = transformOf(state, nodes.intakePress);
  const intakeStampBase = transformOf(state, nodes.intakeStamp);
  nodes.intakePress.position.y = intakePressBase.position.y - intakeStrike * 0.48;
  nodes.intakeStamp.position.y = intakeStampBase.position.y - intakeStrike * 0.62;

  const witnessStrike = pulse(progress, 0.335, 0.425, 0.5);
  const witnessLeverBase = transformOf(state, nodes.witnessLever);
  const witnessRingBase = transformOf(state, nodes.witnessRing);
  const witnessDieBase = transformOf(state, nodes.witnessDie);
  nodes.witnessLever.rotateZ(witnessStrike * 0.78);
  nodes.witnessRing.rotateY(witnessStrike * 0.34 + Math.sin(progress * Math.PI * 2) * 0.025);
  nodes.witnessDie.position.y = witnessDieBase.position.y - witnessStrike * 0.16;
  nodes.witnessLever.position.copy(witnessLeverBase.position);
  nodes.witnessRing.position.copy(witnessRingBase.position);

  const retryProgress = smoothStep(progress, 0.54, 0.7);
  const retryNodes = [nodes.retryTray1, nodes.retryTray2, nodes.retryTray3] as const;
  retryNodes.forEach((tray, index) => {
    const base = transformOf(state, tray);
    tray.position.y = base.position.y - retryProgress * (0.1 + index * 0.06);
    tray.position.z = base.position.z - retryProgress * index * 0.035;
  });
  const survivorBase = transformOf(state, nodes.processSurvivor);
  nodes.processSurvivor.position.y = survivorBase.position.y + retryProgress * 0.2;

  const deliveryStrike = pulse(progress, 0.775, 0.845, 0.895);
  const deliveryGateBase = transformOf(state, nodes.deliveryGate);
  const receiptBase = transformOf(state, nodes.receiptCarrier);
  const sealBase = transformOf(state, nodes.deliverySeal);
  nodes.deliveryGate.position.y = deliveryGateBase.position.y - deliveryStrike * 0.25;
  const receiptArrival = smoothStep(progress, 0.76, 0.89);
  nodes.receiptCarrier.position.x = receiptBase.position.x + (1 - receiptArrival) * 0.34;
  nodes.receiptCarrier.scale.copy(receiptBase.scale).multiplyScalar(0.82 + receiptArrival * 0.18);
  nodes.deliverySeal.rotateZ(receiptArrival * Math.PI * 0.1);
  nodes.deliverySeal.scale
    .copy(sealBase.scale)
    .multiplyScalar(0.78 + receiptArrival * 0.22 + Math.sin(progress * Math.PI * 2) * 0.008);
}

function fitCamera(
  camera: THREE.PerspectiveCamera,
  container: HTMLElement,
  modelSize: THREE.Vector3,
  presentation: SpatialScenePresentation,
): void {
  const bounds = container.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  const aspect = width / height;
  camera.aspect = aspect;
  camera.fov = presentation === 'login' ? 31 : 27;

  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const fitHeightDistance = modelSize.y / (2 * Math.tan(verticalFov / 2));
  const fitWidthDistance = modelSize.x / (2 * Math.tan(verticalFov / 2) * aspect);
  const isLoginPresentation = presentation === 'login';
  const framing = isLoginPresentation ? 1.08 : 1.06;
  const distance = Math.max(fitHeightDistance, fitWidthDistance) * framing + modelSize.z * 0.42;
  const lookAtY = modelSize.y * (isLoginPresentation ? 0.025 : 0.035);
  const cameraX = isLoginPresentation ? -modelSize.x * 0.045 : 0;
  const cameraLift = modelSize.y * (isLoginPresentation ? 0.11 : 0.08);
  camera.position.set(cameraX, lookAtY + cameraLift, Math.max(1, distance));
  camera.near = Math.max(0.01, distance / 120);
  camera.far = Math.max(80, distance * 12);
  camera.lookAt(0, lookAtY, 0);
  camera.updateProjectionMatrix();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * A lazily loaded, asset-authored Attestation Forge. The canonical twelve-second
 * product timeline drives the GLB animation deterministically, while semantic
 * HTML controls remain the accessible source of truth outside this canvas.
 */
export function ProofSpineWebgl({
  activeStageIndex,
  heldStageIndex,
  items,
  onCycleStageChange,
  onReady,
  onUnavailable,
  presentation,
  scrubRevision,
}: ProofSpineWebglProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ProofSceneController | null>(null);
  const activeStageIndexRef = useRef(activeStageIndex);
  const heldStageIndexRef = useRef(heldStageIndex);
  const onCycleStageChangeRef = useRef(onCycleStageChange);
  const onReadyRef = useRef(onReady);
  const onUnavailableRef = useRef(onUnavailable);
  const stageCount = Math.min(items.length, MAX_STAGE_COUNT);

  useEffect(() => {
    activeStageIndexRef.current = activeStageIndex;
  }, [activeStageIndex]);

  useEffect(() => {
    heldStageIndexRef.current = heldStageIndex;
  }, [heldStageIndex]);

  useEffect(() => {
    onCycleStageChangeRef.current = onCycleStageChange;
  }, [onCycleStageChange]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;
    if (stageCount === 0) {
      onUnavailableRef.current('empty-pipeline');
      return;
    }
    if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') {
      onUnavailableRef.current('missing-observer');
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas,
        failIfMajorPerformanceCaveat: true,
        powerPreference: 'low-power',
      });
    } catch {
      onUnavailableRef.current('renderer');
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setClearColor(0x00_00_00, 0);

    const computedStyles = getComputedStyle(container);
    const brassColor = cssColor(computedStyles, '--proof-ember', '#e4a84b');
    const oxideColor = cssColor(computedStyles, '--proof-verified', '#42ceb5');
    const inkColor = cssColor(computedStyles, '--proof-ink', '#f3f1e9');
    const steelColor = cssColor(computedStyles, '--proof-steel', '#75878c');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
    const foundry = new THREE.Group();
    const modelCentering = new THREE.Group();
    foundry.add(modelCentering);
    scene.add(foundry);

    scene.add(new THREE.HemisphereLight(inkColor, new THREE.Color('#071216'), 1.45));
    const keyLight = new THREE.DirectionalLight(inkColor, 3.2);
    keyLight.position.set(-5.5, 7.5, 6.5);
    const fillLight = new THREE.DirectionalLight(steelColor, 1.7);
    fillLight.position.set(6, 2.5, 5);
    const brassRim = new THREE.PointLight(brassColor, 2.2, 18, 2);
    brassRim.position.set(-2.5, 3, 3.5);
    const oxideRim = new THREE.PointLight(oxideColor, 1.45, 16, 2);
    oxideRim.position.set(5.4, 2.1, 2.8);
    scene.add(keyLight, fillLight, brassRim, oxideRim);

    const environmentScene = new RoomEnvironment();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTarget = pmremGenerator.fromScene(environmentScene, 0.04);
    scene.environment = environmentTarget.texture;
    environmentScene.dispose();
    pmremGenerator.dispose();

    const abortController = new AbortController();
    const passivePointerOptions: AddEventListenerOptions = { passive: true };
    const modelSize = new THREE.Vector3(15, 5, 4);
    const scratchPosition = new THREE.Vector3();
    let animationFrame: number | null = null;
    let contextLost = false;
    let currentRotationX = 0;
    let currentRotationY = 0;
    let cycleStartedAt = performance.now();
    let heldElapsedMs = 0;
    let lastNotifiedCycleStage = -1;
    let lastRenderTime = 0;
    let mixer: THREE.AnimationMixer | null = null;
    let model: AttestationForgeModel | null = null;
    let manualAnimation: ManualAnimationState | null = null;
    let pausedAt: number | null = null;
    let readyNotified = false;
    let targetRotationX = 0;
    let targetRotationY = 0;
    let timelineHeld = false;
    let visible = true;
    let disposed = false;
    let resourcesReleased = false;

    const asyncWorkCancelled = (): boolean =>
      disposed || contextLost || abortController.signal.aborted;

    container.dataset.assetState = 'loading';
    container.dataset.assetUrl = ATTESTATION_FORGE_ASSET_URL;
    container.dataset.clipName = ATTESTATION_FORGE_CLIP_NAME;
    container.dataset.presentation = presentation;
    container.dataset.renderBudget = '30fps-continuous-semantic-loop';

    const resize = (): void => {
      const bounds = container.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      const devicePixelRatio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      renderer.setPixelRatio(Math.min(devicePixelRatio, SPATIAL_SCENE_MAX_DPR));
      renderer.setSize(width, height, false);
      fitCamera(camera, container, modelSize, presentation);
    };

    const renderScene = (elapsedMs: number): void => {
      if (model === null) return;
      const snapshot = proofCycleSnapshot(elapsedMs);
      const cycleStageIndex = clampProofStageIndex(snapshot.stageIndex, stageCount);
      if (cycleStageIndex !== lastNotifiedCycleStage) {
        lastNotifiedCycleStage = cycleStageIndex;
        onCycleStageChangeRef.current(cycleStageIndex);
      }

      if (model.clip !== null && mixer !== null) {
        mixer.setTime((snapshot.elapsedInCycleMs / SPATIAL_SCENE_CYCLE_MS) * model.clip.duration);
      } else if (manualAnimation !== null) {
        animateNamedPivots(model.nodes, manualAnimation, snapshot.progress, scratchPosition);
      }

      currentRotationX += (targetRotationX - currentRotationX) * 0.14;
      currentRotationY += (targetRotationY - currentRotationY) * 0.14;
      foundry.rotation.set(currentRotationX, currentRotationY, 0);

      // Keep the exposed budget measurement scoped to this frame. PMREM setup
      // and the async shader compilation can otherwise remain in renderer.info
      // and make a healthy model look as if it renders twice per frame.
      renderer.info.reset();
      renderer.render(scene, camera);
      const selectedStageIndex = timelineHeld
        ? clampProofStageIndex(activeStageIndexRef.current, stageCount)
        : cycleStageIndex;
      container.dataset.assetBytes = String(model.measurement.assetBytes);
      container.dataset.clipDurationSeconds = model.clip?.duration.toFixed(3) ?? '0';
      container.dataset.cycleDurationMs = String(SPATIAL_SCENE_CYCLE_MS);
      container.dataset.cycleElapsedMs = String(Math.round(snapshot.elapsedInCycleMs));
      container.dataset.cycleIndex = String(snapshot.cycleIndex);
      container.dataset.cyclePhase = snapshot.phase;
      container.dataset.cycleProgress = snapshot.progress.toFixed(4);
      container.dataset.cycleStage = String(cycleStageIndex);
      container.dataset.drawCalls = String(renderer.info.render.calls);
      container.dataset.materialCount = String(model.measurement.materialCount);
      container.dataset.meshCount = String(model.measurement.meshCount);
      container.dataset.modelDrawCalls = String(model.measurement.modelDrawCalls);
      container.dataset.nodeCount = String(model.measurement.nodeCount);
      container.dataset.pointCount = '0';
      container.dataset.receiptDwell = snapshot.receiptDwelling ? 'true' : 'false';
      container.dataset.replayCount = String(snapshot.cycleIndex);
      container.dataset.retainedProofMarks = String(
        snapshot.stageIndex === 3 ? 4 : Math.min(3, snapshot.stageIndex + 1),
      );
      container.dataset.selectedStage = String(selectedStageIndex);
      container.dataset.textureCount = String(model.measurement.textureCount);
      container.dataset.triangleCount = String(model.measurement.triangleCount);

      if (!readyNotified) {
        readyNotified = true;
        container.dataset.assetState = 'ready';
        onReadyRef.current();
      }
    };

    const requestRender = (): void => {
      if (
        animationFrame === null &&
        model !== null &&
        visible &&
        !document.hidden &&
        !contextLost
      ) {
        animationFrame = window.requestAnimationFrame(frameLoop);
      }
    };

    const frameLoop = (timestamp: number): void => {
      animationFrame = null;
      if (!visible || document.hidden || contextLost || model === null) return;
      if (lastRenderTime !== 0 && timestamp - lastRenderTime < TARGET_FRAME_MS) {
        requestRender();
        return;
      }

      lastRenderTime = timestamp;
      renderScene(timelineHeld ? heldElapsedMs : timestamp - cycleStartedAt);
      requestRender();
    };

    controllerRef.current = {
      setStageHold(index): void {
        if (index === null) {
          if (!timelineHeld) return;
          timelineHeld = false;
          cycleStartedAt = performance.now() - heldElapsedMs;
          container.dataset.stageHold = 'released';
        } else {
          const safeIndex = clampProofStageIndex(index, stageCount);
          heldElapsedMs = proofStageProgress(safeIndex, stageCount) * SPATIAL_SCENE_CYCLE_MS;
          timelineHeld = true;
          container.dataset.stageHold = String(safeIndex);
        }
        lastRenderTime = 0;
        requestRender();
      },
    };

    const pauseRendering = (): void => {
      if (pausedAt === null) pausedAt = performance.now();
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
      container.dataset.rendering = 'paused';
    };
    const resumeRendering = (): void => {
      if (pausedAt !== null) {
        if (!timelineHeld) cycleStartedAt += performance.now() - pausedAt;
        pausedAt = null;
      }
      lastRenderTime = 0;
      container.dataset.rendering = 'running';
      requestRender();
    };

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting === true;
        if (visible) resumeRendering();
        else pauseRendering();
      },
      { rootMargin: '80px' },
    );
    const resizeObserver = new ResizeObserver(() => {
      resize();
      lastRenderTime = 0;
      requestRender();
    });
    const handleVisibilityChange = (): void => {
      if (document.hidden) pauseRendering();
      else if (visible) resumeRendering();
    };
    const handlePointerMove = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      const bounds = container.getBoundingClientRect();
      const normalizedX =
        clamp01((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
      const normalizedY =
        clamp01((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 - 1;
      const maxParallax = THREE.MathUtils.degToRad(SPATIAL_SCENE_MAX_PARALLAX_DEGREES);
      targetRotationY = normalizedX * maxParallax;
      targetRotationX = -normalizedY * maxParallax * 0.58;
      lastRenderTime = 0;
      requestRender();
    };
    const handlePointerLeave = (): void => {
      targetRotationX = 0;
      targetRotationY = 0;
      lastRenderTime = 0;
      requestRender();
    };
    const handleContextLost = (event: Event): void => {
      event.preventDefault();
      contextLost = true;
      abortController.abort();
      pauseRendering();
      onUnavailableRef.current('context-lost');
    };

    const releaseResources = (): void => {
      if (resourcesReleased) return;
      resourcesReleased = true;
      if (mixer !== null && model !== null) {
        mixer.stopAllAction();
        mixer.uncacheRoot(model.gltfScene);
      }
      if (model !== null) disposeAttestationForgeModel(model);
      scene.environment = null;
      environmentTarget.dispose();
      scene.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
    };
    const deferredResourceRelease = createDeferredResourceRelease(releaseResources);

    resize();
    intersectionObserver.observe(container);
    resizeObserver.observe(container);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    container.addEventListener('pointermove', handlePointerMove, passivePointerOptions);
    container.addEventListener('pointerleave', handlePointerLeave, passivePointerOptions);
    canvas.addEventListener('webglcontextlost', handleContextLost);

    void loadAttestationForgeModel(abortController.signal)
      .then(async (loadedModel) => {
        if (asyncWorkCancelled()) {
          disposeAttestationForgeModel(loadedModel);
          return;
        }

        model = loadedModel;
        const target = loadedModel.nodes.cameraTarget.getWorldPosition(new THREE.Vector3());
        modelCentering.position.copy(target).multiplyScalar(-1);
        modelCentering.add(loadedModel.gltfScene);
        modelCentering.updateMatrixWorld(true);
        new THREE.Box3().setFromObject(modelCentering).getSize(modelSize);
        if (modelSize.lengthSq() === 0) modelSize.set(15, 5, 4);

        if (loadedModel.clip !== null) {
          mixer = new THREE.AnimationMixer(loadedModel.gltfScene);
          const action = mixer.clipAction(loadedModel.clip);
          action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
          action.play();
        } else {
          manualAnimation = createManualAnimationState(loadedModel.nodes);
        }

        container.dataset.animationSource =
          loadedModel.clip === null ? 'named-pivots' : 'gltf-clip';
        container.dataset.assetState = 'compiling';
        resize();
        await deferredResourceRelease.hold(renderer.compileAsync(scene, camera));
        if (asyncWorkCancelled()) return;
        lastRenderTime = 0;
        requestRender();
      })
      .catch((error: unknown) => {
        if (disposed || isAbortError(error)) return;
        container.dataset.assetState = 'failed';
        onUnavailableRef.current(
          error instanceof AttestationForgeContractError ? 'asset-contract' : 'asset-load',
        );
      });

    return () => {
      disposed = true;
      abortController.abort();
      controllerRef.current = null;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      container.removeEventListener('pointermove', handlePointerMove, passivePointerOptions);
      container.removeEventListener('pointerleave', handlePointerLeave, passivePointerOptions);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      // Three's compileAsync() polls material programs until they report ready.
      // Disposing the renderer or model while that poll is active clears the
      // program it still owns and makes the poll read `undefined.isReady`.
      // Stop observable work immediately, but retain GPU ownership until the
      // non-cancellable compile settles, then release exactly once.
      deferredResourceRelease.request();
    };
  }, [presentation, stageCount]);

  useEffect(() => {
    if (scrubRevision === 0 && heldStageIndexRef.current === null) return;
    controllerRef.current?.setStageHold(heldStageIndexRef.current);
  }, [heldStageIndex, scrubRevision]);

  return (
    <div
      className={styles.spatial}
      data-presentation={presentation}
      data-proof-spine-renderer="webgl-gltf"
      data-render-budget="30fps-continuous-semantic-loop"
      ref={containerRef}
    >
      <canvas className={styles.canvas} aria-hidden="true" ref={canvasRef} />
    </div>
  );
}
