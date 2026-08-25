import type { MigrationInterface, QueryRunner } from 'typeorm';

export class OutboxAttemptSequence1700000007000 implements MigrationInterface {
  public readonly name = 'OutboxAttemptSequence1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE outbox_events
        ADD COLUMN attempt_sequence INTEGER NOT NULL DEFAULT 0
          CHECK (attempt_sequence >= 0);

      UPDATE outbox_events event
      SET attempt_sequence = GREATEST(
        event.attempt_count,
        COALESCE((
          SELECT max(attempt.attempt_no)
          FROM outbox_attempts attempt
          WHERE attempt.tenant_id = event.tenant_id
            AND attempt.outbox_event_id = event.id
        ), 0)
      );

      ALTER TABLE outbox_events
        ADD CONSTRAINT outbox_events_attempt_budget_check
          CHECK (attempt_count <= attempt_sequence);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE outbox_events
        DROP CONSTRAINT outbox_events_attempt_budget_check,
        DROP COLUMN attempt_sequence;
    `);
  }
}
