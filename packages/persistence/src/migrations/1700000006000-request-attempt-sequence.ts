import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RequestAttemptSequence1700000006000 implements MigrationInterface {
  public readonly name = 'RequestAttemptSequence1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE workflow_requests
        ADD COLUMN attempt_sequence INTEGER NOT NULL DEFAULT 0
          CHECK (attempt_sequence >= 0);

      UPDATE workflow_requests request
      SET attempt_sequence = GREATEST(
        request.attempt_count,
        COALESCE((
          SELECT max(attempt.attempt_no)
          FROM request_attempts attempt
          WHERE attempt.tenant_id = request.tenant_id
            AND attempt.request_id = request.id
        ), 0)
      );

      ALTER TABLE workflow_requests
        ADD CONSTRAINT workflow_requests_attempt_budget_check
          CHECK (attempt_count <= attempt_sequence);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE workflow_requests
        DROP CONSTRAINT workflow_requests_attempt_budget_check,
        DROP COLUMN attempt_sequence;
    `);
  }
}
