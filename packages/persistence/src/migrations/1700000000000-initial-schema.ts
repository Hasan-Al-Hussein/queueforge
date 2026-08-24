import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  public readonly name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await queryRunner.query(`
      CREATE TABLE tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,78}$'),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
        password_hash TEXT NOT NULL,
        platform_role TEXT CHECK (platform_role IS NULL OR platform_role = 'platform_admin'),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

      CREATE TABLE memberships (
        tenant_id UUID NOT NULL,
        user_id UUID NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('viewer','approver','operator','tenant_admin')),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, user_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
      );
      CREATE INDEX memberships_user_idx ON memberships (user_id, tenant_id);

      CREATE TABLE api_clients (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        key_id TEXT NOT NULL CHECK (length(key_id) BETWEEN 8 AND 100),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
        secret_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('viewer','operator')),
        created_by_user_id UUID NOT NULL,
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, key_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, created_by_user_id)
          REFERENCES memberships(tenant_id, user_id) ON DELETE RESTRICT
      );

      CREATE TABLE refresh_token_families (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        selected_tenant_id UUID NOT NULL,
        csrf_hash TEXT NOT NULL,
        user_agent_hash TEXT,
        created_ip INET,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoke_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (selected_tenant_id, user_id)
          REFERENCES memberships(tenant_id, user_id) ON DELETE RESTRICT,
        CHECK (expires_at > created_at)
      );
      CREATE INDEX refresh_families_user_idx ON refresh_token_families (user_id, created_at DESC);

      CREATE TABLE refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        family_id UUID NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        parent_token_id UUID UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        FOREIGN KEY (family_id) REFERENCES refresh_token_families(id) ON DELETE RESTRICT,
        FOREIGN KEY (parent_token_id) REFERENCES refresh_tokens(id) ON DELETE RESTRICT,
        CHECK (expires_at > created_at)
      );
      CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id, created_at DESC);

      CREATE TABLE security_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 3 AND 160),
        principal_kind TEXT CHECK (principal_kind IS NULL OR principal_kind IN ('user','api_client','system')),
        source_ip INET,
        safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_metadata) = 'object'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
      );
      CREATE INDEX security_events_created_idx ON security_events (created_at DESC);
    `);

    await queryRunner.query(`
      CREATE TABLE workflow_templates (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        stable_key TEXT NOT NULL CHECK (stable_key ~ '^[a-z0-9][a-z0-9_-]{1,99}$'),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
        description TEXT CHECK (description IS NULL OR length(description) <= 2000),
        is_archived BOOLEAN NOT NULL DEFAULT false,
        is_enabled BOOLEAN NOT NULL DEFAULT true,
        created_by_principal_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, stable_key),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
      );

      CREATE TABLE workflow_versions (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        template_id UUID NOT NULL,
        version_no INTEGER NOT NULL CHECK (version_no > 0),
        status TEXT NOT NULL CHECK (status IN ('draft','active','retired')),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
        description TEXT CHECK (description IS NULL OR length(description) <= 2000),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        request_schema JSONB NOT NULL CHECK (jsonb_typeof(request_schema) = 'object'),
        requires_approval BOOLEAN NOT NULL,
        prevent_self_approval BOOLEAN NOT NULL,
        processing_config JSONB NOT NULL CHECK (jsonb_typeof(processing_config) = 'object'),
        content_hash TEXT CHECK (content_hash IS NULL OR length(content_hash) = 64),
        created_by_principal_id UUID NOT NULL,
        activated_at TIMESTAMPTZ,
        retired_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, template_id, version_no),
        UNIQUE (tenant_id, id, template_id),
        FOREIGN KEY (tenant_id, template_id)
          REFERENCES workflow_templates(tenant_id, id) ON DELETE RESTRICT,
        CHECK ((status = 'draft' AND content_hash IS NULL AND activated_at IS NULL)
          OR (status IN ('active','retired') AND content_hash IS NOT NULL AND activated_at IS NOT NULL)),
        CHECK (NOT prevent_self_approval OR requires_approval)
      );
      CREATE UNIQUE INDEX workflow_versions_one_draft_uq
        ON workflow_versions (tenant_id, template_id) WHERE status = 'draft';
      CREATE UNIQUE INDEX workflow_versions_one_active_uq
        ON workflow_versions (tenant_id, template_id) WHERE status = 'active';
      CREATE INDEX workflow_versions_template_idx
        ON workflow_versions (tenant_id, template_id, version_no DESC);

      CREATE TABLE workflow_targets (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        workflow_version_id UUID NOT NULL,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('processor','webhook','notification')),
        position INTEGER NOT NULL CHECK (position >= 0),
        config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, workflow_version_id, position),
        FOREIGN KEY (tenant_id, workflow_version_id)
          REFERENCES workflow_versions(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE INDEX workflow_targets_version_idx ON workflow_targets (tenant_id, workflow_version_id);
    `);

    await queryRunner.query(`
      CREATE TABLE workflow_requests (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        workflow_template_id UUID NOT NULL,
        workflow_version_id UUID NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'received','validation_failed','pending_approval','approved','rejected','queued',
          'processing','succeeded','failed','dead_lettered','cancelled'
        )),
        source TEXT NOT NULL CHECK (source IN ('rest','graphql','inbound_webhook','system')),
        payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
        payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
        correlation_id UUID NOT NULL,
        submitted_by_principal_id UUID NOT NULL,
        submitted_by_principal_kind TEXT NOT NULL CHECK (submitted_by_principal_kind IN ('user','api_client','system')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_error_code TEXT,
        last_error_message TEXT CHECK (last_error_message IS NULL OR length(last_error_message) <= 2000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, id, workflow_version_id, payload_hash),
        FOREIGN KEY (tenant_id, workflow_version_id, workflow_template_id)
          REFERENCES workflow_versions(tenant_id, id, template_id) ON DELETE RESTRICT
      );
      CREATE INDEX workflow_requests_status_idx
        ON workflow_requests (tenant_id, status, submitted_at DESC, id DESC);
      CREATE INDEX workflow_requests_correlation_idx ON workflow_requests (tenant_id, correlation_id);
      CREATE INDEX workflow_requests_workflow_idx
        ON workflow_requests (tenant_id, workflow_template_id, submitted_at DESC);

      CREATE TABLE request_transitions (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        request_id UUID NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        actor_principal_id UUID,
        actor_principal_kind TEXT NOT NULL CHECK (actor_principal_kind IN ('user','api_client','system')),
        reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
        safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_metadata) = 'object'),
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id, request_id) REFERENCES workflow_requests(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE INDEX request_transitions_request_idx
        ON request_transitions (tenant_id, request_id, occurred_at, id);

      CREATE TABLE request_attempts (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        request_id UUID NOT NULL,
        attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
        outcome TEXT NOT NULL CHECK (outcome IN ('processing','succeeded','failed','timed_out')),
        worker_id TEXT,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        error_code TEXT,
        error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 2000),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, request_id, attempt_no),
        FOREIGN KEY (tenant_id, request_id)
          REFERENCES workflow_requests(tenant_id, id) ON DELETE RESTRICT,
        CHECK ((outcome = 'processing' AND finished_at IS NULL)
          OR (outcome <> 'processing' AND finished_at IS NOT NULL))
      );

      CREATE TABLE approval_tasks (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        request_id UUID NOT NULL,
        workflow_version_id UUID NOT NULL,
        payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        prevent_self_approval BOOLEAN NOT NULL,
        requester_principal_id UUID NOT NULL,
        requester_principal_kind TEXT NOT NULL CHECK (requester_principal_kind IN ('user','api_client','system')),
        decided_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, request_id),
        UNIQUE (tenant_id, id, request_id, workflow_version_id, payload_hash),
        FOREIGN KEY (tenant_id, request_id, workflow_version_id, payload_hash)
          REFERENCES workflow_requests(tenant_id, id, workflow_version_id, payload_hash) ON DELETE RESTRICT,
        CHECK ((status = 'pending' AND decided_at IS NULL) OR (status <> 'pending' AND decided_at IS NOT NULL))
      );
      CREATE INDEX approval_tasks_pending_idx
        ON approval_tasks (tenant_id, created_at, id) WHERE status = 'pending';

      CREATE TABLE approval_decisions (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        approval_task_id UUID NOT NULL,
        request_id UUID NOT NULL,
        workflow_version_id UUID NOT NULL,
        payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
        decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
        note TEXT CHECK (note IS NULL OR length(note) <= 2000),
        actor_principal_id UUID NOT NULL,
        actor_principal_kind TEXT NOT NULL CHECK (actor_principal_kind IN ('user','api_client','system')),
        decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, approval_task_id),
        FOREIGN KEY (tenant_id, approval_task_id, request_id, workflow_version_id, payload_hash)
          REFERENCES approval_tasks(tenant_id, id, request_id, workflow_version_id, payload_hash) ON DELETE RESTRICT
      );

      CREATE TABLE idempotency_records (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        endpoint_scope TEXT NOT NULL CHECK (length(endpoint_scope) BETWEEN 2 AND 160),
        key_hash TEXT NOT NULL CHECK (length(key_hash) = 64),
        request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
        principal_id UUID NOT NULL,
        principal_kind TEXT NOT NULL CHECK (principal_kind IN ('user','api_client','system')),
        status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed')),
        response_status INTEGER CHECK (response_status BETWEEN 100 AND 599),
        response_body JSONB CHECK (response_body IS NULL OR jsonb_typeof(response_body) = 'object'),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, endpoint_scope, key_hash),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CHECK ((status = 'processing' AND response_status IS NULL AND response_body IS NULL)
          OR (status = 'completed' AND response_status IS NOT NULL AND response_body IS NOT NULL))
      );
      CREATE INDEX idempotency_expiry_idx ON idempotency_records (tenant_id, expires_at);
    `);

    await queryRunner.query(`
      CREATE TABLE outbox_events (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 3 AND 160),
        aggregate_type TEXT NOT NULL CHECK (length(aggregate_type) BETWEEN 1 AND 80),
        aggregate_id UUID NOT NULL,
        correlation_id UUID NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
        payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','publishing','retry','published','dead')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 10 CHECK (max_attempts > 0),
        available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        lease_owner TEXT,
        lease_until TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 2000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CHECK ((status = 'publishing' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
          OR (status <> 'publishing' AND lease_owner IS NULL AND lease_until IS NULL)),
        CHECK ((status = 'published' AND published_at IS NOT NULL) OR status <> 'published')
      );
      CREATE INDEX outbox_ready_idx ON outbox_events (available_at, created_at, tenant_id, id)
        WHERE status IN ('pending','retry');
      CREATE INDEX outbox_expired_lease_idx ON outbox_events (lease_until, tenant_id, id)
        WHERE status = 'publishing';
      CREATE INDEX outbox_aggregate_idx ON outbox_events (tenant_id, aggregate_type, aggregate_id, created_at);

      CREATE TABLE outbox_attempts (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        outbox_event_id UUID NOT NULL,
        attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
        outcome TEXT NOT NULL CHECK (outcome IN ('claimed','published','failed','lease_expired')),
        worker_id TEXT NOT NULL,
        error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 2000),
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, outbox_event_id, attempt_no, outcome),
        FOREIGN KEY (tenant_id, outbox_event_id) REFERENCES outbox_events(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE INDEX outbox_attempts_event_idx ON outbox_attempts (tenant_id, outbox_event_id, occurred_at);

      CREATE TABLE processed_events (
        tenant_id UUID NOT NULL,
        consumer TEXT NOT NULL CHECK (length(consumer) BETWEEN 1 AND 160),
        event_id UUID NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, consumer, event_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
      );

      CREATE TABLE audit_events (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 3 AND 160),
        actor_principal_id UUID,
        actor_principal_kind TEXT NOT NULL CHECK (actor_principal_kind IN ('user','api_client','system')),
        resource_type TEXT NOT NULL CHECK (length(resource_type) BETWEEN 1 AND 100),
        resource_id UUID,
        correlation_id UUID NOT NULL,
        safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_metadata) = 'object'),
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
      );
      CREATE INDEX audit_events_time_idx ON audit_events (tenant_id, occurred_at DESC, id DESC);
      CREATE INDEX audit_events_correlation_idx ON audit_events (tenant_id, correlation_id, occurred_at);

      CREATE TABLE dead_letters (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        resource_kind TEXT NOT NULL CHECK (resource_kind IN ('request','webhook','notification','outbox')),
        resource_id UUID NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','requeued','resolved')),
        reason_code TEXT NOT NULL,
        reason_message TEXT NOT NULL CHECK (length(reason_message) <= 2000),
        attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
        requeued_by_principal_id UUID,
        requeued_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CHECK ((status = 'requeued' AND requeued_by_principal_id IS NOT NULL AND requeued_at IS NOT NULL)
          OR status <> 'requeued')
      );
      CREATE UNIQUE INDEX dead_letters_one_open_uq
        ON dead_letters (tenant_id, resource_kind, resource_id) WHERE status = 'open';
      CREATE INDEX dead_letters_open_idx ON dead_letters (tenant_id, created_at, id) WHERE status = 'open';
    `);

    await queryRunner.query(`
      CREATE TABLE webhook_endpoints (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
        url TEXT NOT NULL CHECK (url ~ '^https?://'),
        is_enabled BOOLEAN NOT NULL DEFAULT true,
        created_by_principal_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, name),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
      );

      CREATE TABLE webhook_secrets (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        endpoint_id UUID NOT NULL,
        key_id TEXT NOT NULL CHECK (length(key_id) BETWEEN 1 AND 100),
        ciphertext BYTEA NOT NULL,
        iv BYTEA NOT NULL CHECK (octet_length(iv) = 12),
        auth_tag BYTEA NOT NULL CHECK (octet_length(auth_tag) = 16),
        master_key_version INTEGER NOT NULL CHECK (master_key_version > 0),
        status TEXT NOT NULL CHECK (status IN ('active','retiring','revoked')),
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, endpoint_id, key_id),
        FOREIGN KEY (tenant_id, endpoint_id) REFERENCES webhook_endpoints(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE UNIQUE INDEX webhook_secrets_one_active_uq
        ON webhook_secrets (tenant_id, endpoint_id) WHERE status = 'active';

      CREATE TABLE inbound_webhook_replay_keys (
        tenant_id UUID NOT NULL,
        endpoint_id UUID NOT NULL,
        nonce TEXT NOT NULL CHECK (length(nonce) BETWEEN 16 AND 200),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, endpoint_id, nonce),
        FOREIGN KEY (tenant_id, endpoint_id) REFERENCES webhook_endpoints(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE INDEX inbound_replay_expiry_idx ON inbound_webhook_replay_keys (expires_at);

      CREATE TABLE inbound_webhook_receipts (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        endpoint_id UUID NOT NULL,
        external_event_id TEXT NOT NULL CHECK (length(external_event_id) BETWEEN 1 AND 200),
        idempotency_key_hash TEXT NOT NULL CHECK (length(idempotency_key_hash) = 64),
        payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
        request_id UUID,
        signature_key_id TEXT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, endpoint_id, external_event_id),
        UNIQUE (tenant_id, endpoint_id, idempotency_key_hash),
        FOREIGN KEY (tenant_id, endpoint_id) REFERENCES webhook_endpoints(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, request_id) REFERENCES workflow_requests(tenant_id, id) ON DELETE RESTRICT
      );

      CREATE TABLE webhook_deliveries (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        endpoint_id UUID NOT NULL,
        event_id UUID NOT NULL,
        generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
        target_url TEXT NOT NULL CHECK (target_url ~ '^https?://'),
        payload_snapshot JSONB NOT NULL CHECK (jsonb_typeof(payload_snapshot) = 'object'),
        key_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivering','retry','delivered','dead')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        delivered_at TIMESTAMPTZ,
        lease_owner TEXT,
        lease_until TIMESTAMPTZ,
        last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 2000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, event_id, generation),
        FOREIGN KEY (tenant_id, endpoint_id) REFERENCES webhook_endpoints(tenant_id, id) ON DELETE RESTRICT,
        CHECK ((status = 'delivered' AND delivered_at IS NOT NULL) OR status <> 'delivered'),
        CHECK ((status = 'delivering' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
          OR (status <> 'delivering' AND lease_owner IS NULL AND lease_until IS NULL))
      );
      CREATE INDEX webhook_deliveries_ready_idx
        ON webhook_deliveries (tenant_id, next_attempt_at, id) WHERE status IN ('pending','retry');
      CREATE INDEX webhook_deliveries_expired_lease_idx
        ON webhook_deliveries (lease_until, tenant_id, id) WHERE status = 'delivering';

      CREATE TABLE webhook_delivery_attempts (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        delivery_id UUID NOT NULL,
        attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
        response_status INTEGER CHECK (response_status BETWEEN 100 AND 599),
        response_body_excerpt TEXT CHECK (response_body_excerpt IS NULL OR length(response_body_excerpt) <= 2000),
        error_code TEXT,
        error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 2000),
        duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, delivery_id, attempt_no),
        FOREIGN KEY (tenant_id, delivery_id) REFERENCES webhook_deliveries(tenant_id, id) ON DELETE RESTRICT
      );
    `);

    await queryRunner.query(`
      CREATE TABLE notifications (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        request_id UUID,
        recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('user','role')),
        recipient_ref TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, request_id) REFERENCES workflow_requests(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE INDEX notifications_recipient_idx
        ON notifications (tenant_id, recipient_kind, recipient_ref, created_at DESC);

      CREATE TABLE notification_deliveries (
        tenant_id UUID NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        notification_id UUID NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('in_app','console')),
        status TEXT NOT NULL CHECK (status IN ('delivered','failed')),
        error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 2000),
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, id),
        UNIQUE (tenant_id, notification_id, provider),
        FOREIGN KEY (tenant_id, notification_id) REFERENCES notifications(tenant_id, id) ON DELETE RESTRICT
      );

      CREATE TABLE worker_nodes (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
        service TEXT NOT NULL CHECK (length(service) BETWEEN 1 AND 100),
        version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 100),
        started_at TIMESTAMPTZ NOT NULL,
        heartbeat_at TIMESTAMPTZ NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
      );
      CREATE INDEX worker_nodes_heartbeat_idx ON worker_nodes (heartbeat_at);
    `);

    await queryRunner.query(`
      CREATE FUNCTION qf_reject_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
      END;
      $$;

      CREATE FUNCTION qf_protect_workflow_version() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'activated workflow versions are immutable' USING ERRCODE = '55000';
          END IF;
          RETURN OLD;
        END IF;

        IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
          OR OLD.id IS DISTINCT FROM NEW.id
          OR OLD.template_id IS DISTINCT FROM NEW.template_id
          OR OLD.version_no IS DISTINCT FROM NEW.version_no
          OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
          RAISE EXCEPTION 'workflow version identity is immutable' USING ERRCODE = '55000';
        END IF;

        IF OLD.status <> 'draft' THEN
          IF NOT (
            OLD.status = 'active' AND NEW.status = 'retired'
            AND OLD.name IS NOT DISTINCT FROM NEW.name
            AND OLD.description IS NOT DISTINCT FROM NEW.description
            AND OLD.request_schema IS NOT DISTINCT FROM NEW.request_schema
            AND OLD.requires_approval IS NOT DISTINCT FROM NEW.requires_approval
            AND OLD.prevent_self_approval IS NOT DISTINCT FROM NEW.prevent_self_approval
            AND OLD.processing_config IS NOT DISTINCT FROM NEW.processing_config
            AND OLD.content_hash IS NOT DISTINCT FROM NEW.content_hash
            AND OLD.created_by_principal_id IS NOT DISTINCT FROM NEW.created_by_principal_id
            AND OLD.activated_at IS NOT DISTINCT FROM NEW.activated_at
          ) THEN
            RAISE EXCEPTION 'activated workflow content is immutable' USING ERRCODE = '55000';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE FUNCTION qf_protect_workflow_target() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        old_status TEXT;
        new_status TEXT;
      BEGIN
        IF TG_OP IN ('UPDATE','DELETE') THEN
          SELECT status INTO old_status FROM workflow_versions
          WHERE tenant_id = OLD.tenant_id AND id = OLD.workflow_version_id;
          IF old_status IS DISTINCT FROM 'draft' THEN
            RAISE EXCEPTION 'targets of activated workflow versions are immutable' USING ERRCODE = '55000';
          END IF;
        END IF;
        IF TG_OP IN ('INSERT','UPDATE') THEN
          SELECT status INTO new_status FROM workflow_versions
          WHERE tenant_id = NEW.tenant_id AND id = NEW.workflow_version_id;
          IF new_status IS DISTINCT FROM 'draft' THEN
            RAISE EXCEPTION 'targets may only be changed for draft workflow versions' USING ERRCODE = '55000';
          END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE FUNCTION qf_protect_request_identity() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
          OR OLD.id IS DISTINCT FROM NEW.id
          OR OLD.workflow_template_id IS DISTINCT FROM NEW.workflow_template_id
          OR OLD.workflow_version_id IS DISTINCT FROM NEW.workflow_version_id
          OR OLD.source IS DISTINCT FROM NEW.source
          OR OLD.payload IS DISTINCT FROM NEW.payload
          OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
          OR OLD.correlation_id IS DISTINCT FROM NEW.correlation_id
          OR OLD.submitted_by_principal_id IS DISTINCT FROM NEW.submitted_by_principal_id
          OR OLD.submitted_by_principal_kind IS DISTINCT FROM NEW.submitted_by_principal_kind
          OR OLD.submitted_at IS DISTINCT FROM NEW.submitted_at THEN
          RAISE EXCEPTION 'workflow request identity is immutable' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER workflow_versions_immutable
        BEFORE UPDATE OR DELETE ON workflow_versions FOR EACH ROW EXECUTE FUNCTION qf_protect_workflow_version();
      CREATE TRIGGER workflow_targets_draft_only
        BEFORE INSERT OR UPDATE OR DELETE ON workflow_targets FOR EACH ROW EXECUTE FUNCTION qf_protect_workflow_target();
      CREATE TRIGGER workflow_requests_identity_immutable
        BEFORE UPDATE ON workflow_requests FOR EACH ROW EXECUTE FUNCTION qf_protect_request_identity();

      CREATE TRIGGER request_transitions_append_only
        BEFORE UPDATE OR DELETE ON request_transitions FOR EACH ROW EXECUTE FUNCTION qf_reject_mutation();
      CREATE TRIGGER request_transitions_no_truncate
        BEFORE TRUNCATE ON request_transitions FOR EACH STATEMENT EXECUTE FUNCTION qf_reject_mutation();
      CREATE TRIGGER request_attempts_append_only
        BEFORE UPDATE OR DELETE ON request_attempts FOR EACH ROW EXECUTE FUNCTION qf_reject_mutation();
      CREATE TRIGGER approval_decisions_append_only
        BEFORE UPDATE OR DELETE ON approval_decisions FOR EACH ROW EXECUTE FUNCTION qf_reject_mutation();
      CREATE TRIGGER outbox_attempts_append_only
        BEFORE UPDATE OR DELETE ON outbox_attempts FOR EACH ROW EXECUTE FUNCTION qf_reject_mutation();
      CREATE TRIGGER processed_events_append_only
        BEFORE UPDATE OR DELETE ON processed_events FOR EACH ROW EXECUTE FUNCTION qf_reject_mutation();
      CREATE TRIGGER webhook_attempts_append_only
        BEFORE UPDATE OR DELETE ON webhook_delivery_attempts FOR EACH ROW EXECUTE FUNCTION qf_reject_mutation();
      CREATE TRIGGER inbound_webhook_receipts_append_only
        BEFORE UPDATE OR DELETE ON inbound_webhook_receipts FOR EACH ROW EXECUTE FUNCTION qf_reject_mutation();
      CREATE TRIGGER audit_events_append_only
        BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION qf_reject_mutation();
      CREATE TRIGGER audit_events_no_truncate
        BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION qf_reject_mutation();
      CREATE TRIGGER security_events_append_only
        BEFORE UPDATE OR DELETE ON security_events FOR EACH ROW EXECUTE FUNCTION qf_reject_mutation();
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'queueforge_app') THEN
          GRANT USAGE ON SCHEMA public TO queueforge_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO queueforge_app;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO queueforge_app;
          GRANT EXECUTE ON FUNCTION qf_reject_mutation() TO queueforge_app;
          GRANT EXECUTE ON FUNCTION qf_protect_workflow_version() TO queueforge_app;
          GRANT EXECUTE ON FUNCTION qf_protect_workflow_target() TO queueforge_app;
          GRANT EXECUTE ON FUNCTION qf_protect_request_identity() TO queueforge_app;
          REVOKE UPDATE, DELETE, TRUNCATE ON
            request_transitions, request_attempts, approval_decisions, outbox_attempts,
            processed_events, webhook_delivery_attempts, inbound_webhook_receipts,
            audit_events, security_events
          FROM queueforge_app;
        END IF;
      END;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS worker_nodes;
      DROP TABLE IF EXISTS notification_deliveries;
      DROP TABLE IF EXISTS notifications;
      DROP TABLE IF EXISTS webhook_delivery_attempts;
      DROP TABLE IF EXISTS webhook_deliveries;
      DROP TABLE IF EXISTS inbound_webhook_receipts;
      DROP TABLE IF EXISTS inbound_webhook_replay_keys;
      DROP TABLE IF EXISTS webhook_secrets;
      DROP TABLE IF EXISTS webhook_endpoints;
      DROP TABLE IF EXISTS dead_letters;
      DROP TABLE IF EXISTS audit_events;
      DROP TABLE IF EXISTS processed_events;
      DROP TABLE IF EXISTS outbox_attempts;
      DROP TABLE IF EXISTS outbox_events;
      DROP TABLE IF EXISTS idempotency_records;
      DROP TABLE IF EXISTS approval_decisions;
      DROP TABLE IF EXISTS approval_tasks;
      DROP TABLE IF EXISTS request_attempts;
      DROP TABLE IF EXISTS request_transitions;
      DROP TABLE IF EXISTS workflow_requests;
      DROP TABLE IF EXISTS workflow_targets;
      DROP TABLE IF EXISTS workflow_versions;
      DROP TABLE IF EXISTS workflow_templates;
      DROP TABLE IF EXISTS security_events;
      DROP TABLE IF EXISTS refresh_tokens;
      DROP TABLE IF EXISTS refresh_token_families;
      DROP TABLE IF EXISTS api_clients;
      DROP TABLE IF EXISTS memberships;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS tenants;
      DROP FUNCTION IF EXISTS qf_protect_request_identity();
      DROP FUNCTION IF EXISTS qf_protect_workflow_version();
      DROP FUNCTION IF EXISTS qf_protect_workflow_target();
      DROP FUNCTION IF EXISTS qf_reject_mutation();
    `);
  }
}
