import { Column, Entity, Index } from 'typeorm';

import type { JsonObject, WorkflowVersionStatus } from '@queueforge/contracts';

import { TenantOwnedEntity } from './base.entity.js';

@Entity({ name: 'workflow_templates' })
@Index(['tenantId', 'stableKey'], { unique: true })
export class WorkflowTemplateEntity extends TenantOwnedEntity {
  @Column('text', { name: 'stable_key' })
  public stableKey!: string;

  @Column('text')
  public name!: string;

  @Column('text', { nullable: true })
  public description!: string | null;

  @Column('boolean', { default: false, name: 'is_archived' })
  public isArchived!: boolean;

  @Column('boolean', { default: true, name: 'is_enabled' })
  public isEnabled!: boolean;

  @Column('uuid', { name: 'created_by_principal_id' })
  public createdByPrincipalId!: string;
}

@Entity({ name: 'workflow_versions' })
@Index(['tenantId', 'templateId', 'versionNo'], { unique: true })
export class WorkflowVersionEntity extends TenantOwnedEntity {
  @Column('uuid', { name: 'template_id' })
  public templateId!: string;

  @Column('integer', { name: 'version_no' })
  public versionNo!: number;

  @Column('text')
  public status!: WorkflowVersionStatus;

  @Column('text')
  public name!: string;

  @Column('text', { nullable: true })
  public description!: string | null;

  @Column('integer', { default: 1 })
  public revision!: number;

  @Column('jsonb', { name: 'request_schema' })
  public requestSchema!: JsonObject;

  @Column('boolean', { name: 'requires_approval' })
  public requiresApproval!: boolean;

  @Column('boolean', { name: 'prevent_self_approval' })
  public preventSelfApproval!: boolean;

  @Column('jsonb', { name: 'processing_config' })
  public processingConfig!: JsonObject;

  @Column('text', { name: 'content_hash', nullable: true })
  public contentHash!: string | null;

  @Column('uuid', { name: 'created_by_principal_id' })
  public createdByPrincipalId!: string;

  @Column('timestamptz', { name: 'activated_at', nullable: true })
  public activatedAt!: Date | null;

  @Column('timestamptz', { name: 'retired_at', nullable: true })
  public retiredAt!: Date | null;
}

@Entity({ name: 'workflow_targets' })
@Index(['tenantId', 'workflowVersionId'])
export class WorkflowTargetEntity extends TenantOwnedEntity {
  @Column('uuid', { name: 'workflow_version_id' })
  public workflowVersionId!: string;

  @Column('text', { name: 'target_kind' })
  public targetKind!: 'processor' | 'webhook' | 'notification';

  @Column('integer', { name: 'position' })
  public position!: number;

  @Column('jsonb')
  public config!: JsonObject;
}
