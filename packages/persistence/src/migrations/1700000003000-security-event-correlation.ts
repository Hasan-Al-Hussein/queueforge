import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SecurityEventCorrelation1700000003000 implements MigrationInterface {
  public readonly name = 'SecurityEventCorrelation1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE security_events
        ADD COLUMN correlation_id UUID NOT NULL DEFAULT gen_random_uuid();

      ALTER TABLE security_events
        ALTER COLUMN correlation_id DROP DEFAULT;

      CREATE INDEX security_events_correlation_idx
        ON security_events (correlation_id, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS security_events_correlation_idx;
      ALTER TABLE security_events DROP COLUMN IF EXISTS correlation_id;
    `);
  }
}
