import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MembershipRoleLock1700000005000 implements MigrationInterface {
  public readonly name = 'MembershipRoleLock1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE memberships
        ADD COLUMN role_locked BOOLEAN NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE memberships DROP COLUMN role_locked;
    `);
  }
}
