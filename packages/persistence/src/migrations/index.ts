export * from './1700000000000-initial-schema.js';
export * from './1700000001000-notification-reads.js';
export * from './1700000002000-approval-decision-command.js';
export * from './1700000003000-security-event-correlation.js';
export * from './1700000004000-inbound-receipt-runtime-lock.js';
export * from './1700000005000-membership-role-lock.js';
export * from './1700000006000-request-attempt-sequence.js';
export * from './1700000007000-outbox-attempt-sequence.js';

import { InitialSchema1700000000000 } from './1700000000000-initial-schema.js';
import { NotificationReads1700000001000 } from './1700000001000-notification-reads.js';
import { ApprovalDecisionCommand1700000002000 } from './1700000002000-approval-decision-command.js';
import { SecurityEventCorrelation1700000003000 } from './1700000003000-security-event-correlation.js';
import { InboundReceiptRuntimeLock1700000004000 } from './1700000004000-inbound-receipt-runtime-lock.js';
import { MembershipRoleLock1700000005000 } from './1700000005000-membership-role-lock.js';
import { RequestAttemptSequence1700000006000 } from './1700000006000-request-attempt-sequence.js';
import { OutboxAttemptSequence1700000007000 } from './1700000007000-outbox-attempt-sequence.js';

export const persistenceMigrations = [
  InitialSchema1700000000000,
  NotificationReads1700000001000,
  ApprovalDecisionCommand1700000002000,
  SecurityEventCorrelation1700000003000,
  InboundReceiptRuntimeLock1700000004000,
  MembershipRoleLock1700000005000,
  RequestAttemptSequence1700000006000,
  OutboxAttemptSequence1700000007000,
] as const;
