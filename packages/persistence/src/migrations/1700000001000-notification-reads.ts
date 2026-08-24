import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationReads1700000001000 implements MigrationInterface {
  public readonly name = 'NotificationReads1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notification_reads (
        tenant_id UUID NOT NULL,
        notification_id UUID NOT NULL,
        user_id UUID NOT NULL,
        read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, notification_id, user_id),
        FOREIGN KEY (tenant_id, notification_id)
          REFERENCES notifications(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, user_id)
          REFERENCES memberships(tenant_id, user_id) ON DELETE RESTRICT
      );
      CREATE INDEX notification_reads_user_idx
        ON notification_reads (tenant_id, user_id, read_at DESC);

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'queueforge_app') THEN
          GRANT SELECT, INSERT, UPDATE ON notification_reads TO queueforge_app;
        END IF;
      END;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS notification_reads;');
  }
}
