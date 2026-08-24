import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import type { JsonObject } from '@queueforge/contracts';

import { TenantOwnedEntity } from './base.entity.js';

@Entity({ name: 'webhook_endpoints' })
@Index(['tenantId', 'name'], { unique: true })
export class WebhookEndpointEntity extends TenantOwnedEntity {
  @Column('text')
  public name!: string;

  @Column('text')
  public url!: string;

  @Column('boolean', { default: true, name: 'is_enabled' })
  public isEnabled!: boolean;

  @Column('uuid', { name: 'created_by_principal_id' })
  public createdByPrincipalId!: string;
}

@Entity({ name: 'webhook_secrets' })
@Index(['tenantId', 'endpointId', 'keyId'], { unique: true })
export class WebhookSecretEntity extends TenantOwnedEntity {
  @Column('uuid', { name: 'endpoint_id' })
  public endpointId!: string;

  @Column('text', { name: 'key_id' })
  public keyId!: string;

  @Column('bytea')
  public ciphertext!: Buffer;

  @Column('bytea')
  public iv!: Buffer;

  @Column('bytea', { name: 'auth_tag' })
  public authTag!: Buffer;

  @Column('integer', { name: 'master_key_version' })
  public masterKeyVersion!: number;

  @Column('text')
  public status!: 'active' | 'retiring' | 'revoked';

  @Column('timestamptz', { name: 'expires_at', nullable: true })
  public expiresAt!: Date | null;
}

@Entity({ name: 'inbound_webhook_replay_keys' })
export class InboundWebhookReplayKeyEntity {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  public tenantId!: string;

  @PrimaryColumn('uuid', { name: 'endpoint_id' })
  public endpointId!: string;

  @PrimaryColumn('text')
  public nonce!: string;

  @Column('timestamptz', { name: 'expires_at' })
  public expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}

@Entity({ name: 'inbound_webhook_receipts' })
@Index(['tenantId', 'endpointId', 'externalEventId'], { unique: true })
export class InboundWebhookReceiptEntity extends TenantOwnedEntity {
  @Column('uuid', { name: 'endpoint_id' })
  public endpointId!: string;

  @Column('text', { name: 'external_event_id' })
  public externalEventId!: string;

  @Column('text', { name: 'idempotency_key_hash' })
  public idempotencyKeyHash!: string;

  @Column('text', { name: 'payload_hash' })
  public payloadHash!: string;

  @Column('uuid', { name: 'request_id', nullable: true })
  public requestId!: string | null;

  @Column('text', { name: 'signature_key_id' })
  public signatureKeyId!: string;

  @Column('timestamptz', { name: 'received_at' })
  public receivedAt!: Date;
}

@Entity({ name: 'webhook_deliveries' })
@Index(['tenantId', 'status', 'nextAttemptAt'])
export class WebhookDeliveryEntity extends TenantOwnedEntity {
  @Column('uuid', { name: 'endpoint_id' })
  public endpointId!: string;

  @Column('uuid', { name: 'event_id' })
  public eventId!: string;

  @Column('integer', { default: 1 })
  public generation!: number;

  @Column('text', { name: 'target_url' })
  public targetUrl!: string;

  @Column('jsonb', { name: 'payload_snapshot' })
  public payloadSnapshot!: JsonObject;

  @Column('text', { name: 'key_id' })
  public keyId!: string;

  @Column('text', { default: 'pending' })
  public status!: 'pending' | 'delivering' | 'retry' | 'delivered' | 'dead';

  @Column('integer', { default: 0, name: 'attempt_count' })
  public attemptCount!: number;

  @Column('integer', { default: 5, name: 'max_attempts' })
  public maxAttempts!: number;

  @Column('timestamptz', { name: 'next_attempt_at' })
  public nextAttemptAt!: Date;

  @Column('timestamptz', { name: 'delivered_at', nullable: true })
  public deliveredAt!: Date | null;

  @Column('text', { name: 'lease_owner', nullable: true })
  public leaseOwner!: string | null;

  @Column('timestamptz', { name: 'lease_until', nullable: true })
  public leaseUntil!: Date | null;

  @Column('text', { name: 'last_error', nullable: true })
  public lastError!: string | null;
}

@Entity({ name: 'webhook_delivery_attempts' })
@Index(['tenantId', 'deliveryId', 'attemptNo'], { unique: true })
export class WebhookDeliveryAttemptEntity {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  public tenantId!: string;

  @PrimaryColumn('uuid')
  public id!: string;

  @Column('uuid', { name: 'delivery_id' })
  public deliveryId!: string;

  @Column('integer', { name: 'attempt_no' })
  public attemptNo!: number;

  @Column('integer', { name: 'response_status', nullable: true })
  public responseStatus!: number | null;

  @Column('text', { name: 'response_body_excerpt', nullable: true })
  public responseBodyExcerpt!: string | null;

  @Column('text', { name: 'error_code', nullable: true })
  public errorCode!: string | null;

  @Column('text', { name: 'error_message', nullable: true })
  public errorMessage!: string | null;

  @Column('integer', { name: 'duration_ms' })
  public durationMs!: number;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  public occurredAt!: Date;
}
