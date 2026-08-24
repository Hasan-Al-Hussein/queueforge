export * from './1700000000000-initial-schema.js';
export * from './1700000001000-notification-reads.js';
export * from './1700000002000-approval-decision-command.js';
export * from './1700000003000-security-event-correlation.js';
export * from './1700000004000-inbound-receipt-runtime-lock.js';

import { InitialSchema1700000000000 } from './1700000000000-initial-schema.js';
import { NotificationReads1700000001000 } from './1700000001000-notification-reads.js';
import { ApprovalDecisionCommand1700000002000 } from './1700000002000-approval-decision-command.js';
import { SecurityEventCorrelation1700000003000 } from './1700000003000-security-event-correlation.js';
import { InboundReceiptRuntimeLock1700000004000 } from './1700000004000-inbound-receipt-runtime-lock.js';

export const persistenceMigrations = [
  InitialSchema1700000000000,
  NotificationReads1700000001000,
  ApprovalDecisionCommand1700000002000,
  SecurityEventCorrelation1700000003000,
  InboundReceiptRuntimeLock1700000004000,
] as const;
