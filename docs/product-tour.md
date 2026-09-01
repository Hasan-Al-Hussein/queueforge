# QueueForge product tour

QueueForge follows a request from intake to an independent decision, durable processing, signed delivery, and retained proof. This tour uses one synthetic Expense review in a loopback-only workspace.

## The workflow

1. [Admin overview](media/screenshots/final-e4de0d2-b17918e5/light/desktop/01-admin-overview.png): the Proof Spine and current operational priority.
2. [People and role boundaries](media/screenshots/final-e4de0d2-b17918e5/light/desktop/02-role-boundaries.png): separate administrator, operator, and approver responsibilities.
3. [Signed delivery connection](media/screenshots/final-e4de0d2-b17918e5/light/desktop/03-delivery-connection.png): configured local receiver and retained delivery activity.
4. [Published request type](media/screenshots/final-e4de0d2-b17918e5/light/desktop/04-published-request-type.png): human-readable input, decision, processing, and delivery stages.
5. [Operator submits the request](media/screenshots/final-e4de0d2-b17918e5/light/desktop/05-submit-expense-review.png).
6. [Request waits for approval](media/screenshots/final-e4de0d2-b17918e5/light/desktop/06-waiting-for-approval.png).
7. [Separate approver reviews it](media/screenshots/final-e4de0d2-b17918e5/light/desktop/07-approver-review.png).
8. [Durable processing completes](media/screenshots/final-e4de0d2-b17918e5/light/desktop/08-processing-completed.png).
9. [Delivery history retains the attempt](media/screenshots/final-e4de0d2-b17918e5/light/desktop/09-delivery-history.png).
10. [The local receiver accepts the result](media/screenshots/final-e4de0d2-b17918e5/light/desktop/10-receiver-accepted.png).
11. [The requester receives an update](media/screenshots/final-e4de0d2-b17918e5/light/desktop/11-requester-notifications.png).
12. [Correlated activity explains the change](media/screenshots/final-e4de0d2-b17918e5/light/desktop/12-correlated-activity.png).
13. [Cross-tenant access is blocked](media/screenshots/final-e4de0d2-b17918e5/light/desktop/13-cross-tenant-blocked.png).
14. [Processing health exposes recovery](media/screenshots/final-e4de0d2-b17918e5/light/desktop/14-processing-recovery.png).

Matched dark-mode captures and mobile views are indexed in [the screenshot manifest](media/screenshots/manifest.md). QueueForge implements at-least-once delivery; receivers must handle repeated delivery idempotently.
