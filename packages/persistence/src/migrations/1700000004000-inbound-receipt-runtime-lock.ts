import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InboundReceiptRuntimeLock1700000004000 implements MigrationInterface {
  public readonly name = 'InboundReceiptRuntimeLock1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.enforceAppendOnlyPrivileges(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.enforceAppendOnlyPrivileges(queryRunner);
  }

  private async enforceAppendOnlyPrivileges(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'queueforge_app') THEN
          REVOKE UPDATE, DELETE, TRUNCATE ON inbound_webhook_receipts FROM queueforge_app;
        END IF;
      END
      $$;
    `);
  }
}
