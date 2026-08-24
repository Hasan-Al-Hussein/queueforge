import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ApprovalDecisionCommand1700000002000 implements MigrationInterface {
  public readonly name = 'ApprovalDecisionCommand1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE approval_decisions
        ADD COLUMN expected_revision INTEGER NOT NULL DEFAULT 1
          CHECK (expected_revision > 0);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE approval_decisions DROP COLUMN expected_revision;');
  }
}
