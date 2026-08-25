import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { PlatformRole, PrincipalKind, TenantRole } from '@queueforge/contracts';

import { TenantOwnedEntity } from './base.entity.js';

@Entity({ name: 'tenants' })
export class TenantEntity {
  @PrimaryColumn('uuid')
  public id!: string;

  @Column('text', { unique: true })
  public slug!: string;

  @Column('text')
  public name!: string;

  @Column('boolean', { default: true, name: 'is_active' })
  public isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryColumn('uuid')
  public id!: string;

  @Column('text')
  public email!: string;

  @Column('text', { name: 'display_name' })
  public displayName!: string;

  @Column('text', { name: 'password_hash', select: false })
  public passwordHash!: string;

  @Column('text', { name: 'platform_role', nullable: true })
  public platformRole!: PlatformRole | null;

  @Column('boolean', { default: true, name: 'is_active' })
  public isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'memberships' })
@Index(['tenantId', 'userId'])
export class MembershipEntity {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  public tenantId!: string;

  @PrimaryColumn('uuid', { name: 'user_id' })
  public userId!: string;

  @Column('text')
  public role!: TenantRole;

  @Column('boolean', { default: true, name: 'is_active' })
  public isActive!: boolean;

  @Column('boolean', { default: false, name: 'role_locked' })
  public roleLocked!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}

@Entity({ name: 'api_clients' })
@Index(['tenantId', 'keyId'], { unique: true })
export class ApiClientEntity extends TenantOwnedEntity {
  @Column('text', { name: 'key_id' })
  public keyId!: string;

  @Column('text')
  public name!: string;

  @Column('text', { name: 'secret_hash', select: false })
  public secretHash!: string;

  @Column('text')
  public role!: Extract<TenantRole, 'viewer' | 'operator'>;

  @Column('uuid', { name: 'created_by_user_id' })
  public createdByUserId!: string;

  @Column('timestamptz', { name: 'last_used_at', nullable: true })
  public lastUsedAt!: Date | null;

  @Column('timestamptz', { name: 'revoked_at', nullable: true })
  public revokedAt!: Date | null;
}

@Entity({ name: 'refresh_token_families' })
export class RefreshTokenFamilyEntity {
  @PrimaryColumn('uuid')
  public id!: string;

  @Column('uuid', { name: 'user_id' })
  public userId!: string;

  @Column('uuid', { name: 'selected_tenant_id' })
  public selectedTenantId!: string;

  @Column('text', { name: 'csrf_hash' })
  public csrfHash!: string;

  @Column('text', { name: 'user_agent_hash', nullable: true })
  public userAgentHash!: string | null;

  @Column('inet', { name: 'created_ip', nullable: true })
  public createdIp!: string | null;

  @Column('timestamptz', { name: 'expires_at' })
  public expiresAt!: Date;

  @Column('timestamptz', { name: 'revoked_at', nullable: true })
  public revokedAt!: Date | null;

  @Column('text', { name: 'revoke_reason', nullable: true })
  public revokeReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}

@Entity({ name: 'refresh_tokens' })
export class RefreshTokenEntity {
  @PrimaryColumn('uuid')
  public id!: string;

  @Column('uuid', { name: 'family_id' })
  public familyId!: string;

  @Column('text', { name: 'token_hash', select: false })
  public tokenHash!: string;

  @Column('uuid', { name: 'parent_token_id', nullable: true })
  public parentTokenId!: string | null;

  @Column('timestamptz', { name: 'expires_at' })
  public expiresAt!: Date;

  @Column('timestamptz', { name: 'consumed_at', nullable: true })
  public consumedAt!: Date | null;

  @Column('timestamptz', { name: 'revoked_at', nullable: true })
  public revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}

@Entity({ name: 'security_events' })
export class SecurityEventEntity {
  @PrimaryColumn('uuid')
  public id!: string;

  @Column('uuid', { name: 'user_id', nullable: true })
  public userId!: string | null;

  @Column('text', { name: 'event_type' })
  public eventType!: string;

  @Column('text', { name: 'principal_kind', nullable: true })
  public principalKind!: PrincipalKind | null;

  @Column('uuid', { name: 'correlation_id' })
  public correlationId!: string;

  @Column('inet', { name: 'source_ip', nullable: true })
  public sourceIp!: string | null;

  @Column('jsonb', { default: {}, name: 'safe_metadata' })
  public safeMetadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
