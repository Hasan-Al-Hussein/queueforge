import type { QueueRailItem } from '@queueforge/ui';

import styles from './proof-core-webgl.module.css';
import { clampProofStageIndex } from './spatial-scene-policy';

const PROOF_STAGES = [
  {
    accessibleAction: 'Schema and request hash locked',
    action: 'Schema locked',
    glyph: 'intake',
    name: 'Intake',
  },
  {
    accessibleAction: 'Independent witness signed',
    action: 'Witness signed',
    glyph: 'decision',
    name: 'Decision',
  },
  {
    accessibleAction: 'Failed retry attempts retained with the surviving attempt',
    action: 'Retries retained',
    glyph: 'process',
    name: 'Process',
  },
  {
    accessibleAction: 'Signed delivery receipt sealed',
    action: 'Receipt sealed',
    glyph: 'delivery',
    name: 'Delivery',
  },
] as const;

export interface ProofSpineProps {
  readonly items: readonly QueueRailItem[];
  readonly onReleaseStage?: () => void;
  readonly onSelectStage: (index: number) => void;
  readonly selectedStageIndex: number;
}

export function ProofSpine({
  items,
  onReleaseStage,
  onSelectStage,
  selectedStageIndex,
}: ProofSpineProps): React.JSX.Element {
  const visibleItems = items.slice(0, PROOF_STAGES.length);
  const safeSelectedIndex = clampProofStageIndex(selectedStageIndex, visibleItems.length);

  return (
    <>
      <div
        className={styles.fallback}
        aria-hidden="true"
        data-proof-scenario="illustrative-request"
        data-selected-stage={String(safeSelectedIndex)}
      >
        <span className={styles.registration} />
        <span className={styles.forgePoster} />
        <div className={styles.posterStages}>
          {visibleItems.map((item, index) => {
            const stage = PROOF_STAGES[index] ?? PROOF_STAGES[0];
            return (
              <span
                className={styles.posterStage}
                data-selected={safeSelectedIndex === index ? 'true' : 'false'}
                data-stage={stage.glyph}
                key={item.id}
              />
            );
          })}
        </div>
      </div>

      <ol
        className={styles.stageControls}
        aria-label="Illustrative proof cycle stages"
        data-proof-scenario="illustrative-request"
      >
        {visibleItems.map((item, index) => {
          const stage = PROOF_STAGES[index] ?? PROOF_STAGES[0];
          return (
            <li key={item.id}>
              <button
                aria-label={`${stage.name}: ${stage.accessibleAction}. Illustrative request transformation.`}
                aria-pressed={safeSelectedIndex === index}
                data-stage={stage.glyph}
                onBlur={onReleaseStage}
                onClick={() => onSelectStage(index)}
                onFocus={() => onSelectStage(index)}
                type="button"
              >
                <span className={styles.stageNumber}>{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.stageName}>{stage.name}</span>
                <span className={styles.stageState}>{stage.action}</span>
                <span className={styles.stageEvidence}>Illustrative request</span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}
