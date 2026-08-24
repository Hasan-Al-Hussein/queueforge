import { CreateDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export abstract class TenantOwnedEntity {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  public tenantId!: string;

  @PrimaryColumn('uuid')
  public id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
