export const LIVE_CLIPS_ENABLED = true;
export const TOUR_CLIPS_ENABLED = true;

export const clips = {
  overview: 'clips/00-overview-proof-forge.mp4',
  login: 'clips-v3/14-role-operator-login.mp4',
  submit: 'clips-v3/02-operator-submit.mp4',
  approve: 'clips-v3/03-approver-decide.mp4',
  processing: 'clips-v3/04-request-processing.mp4',
  delivery: 'clips-v3/05-delivery-receipt.mp4',
  audit: 'clips-v3/06-audit-proof.mp4',
} as const;

// Recording contract for the v3 navigation tour. Keep the flag disabled until
// every file is delivered so a partial handoff never breaks the composition.
export const tourClips = {
  home: 'clips-v3/07-tour-home.mp4',
  requestTypes: 'clips-v3/08-tour-request-types.mp4',
  deliveryConnections: 'clips-v3/09-tour-delivery-connections.mp4',
  peopleAccess: 'clips-v3/10-tour-people-access.mp4',
  processingHealth: 'clips-v3/11-tour-processing-health.mp4',
  activityLog: 'clips-v3/12-tour-activity-log.mp4',
  notifications: 'clips-v3/13-tour-notifications.mp4',
} as const;

export const tourFallbackScreens = {
  home: 'screenshots/light/01-admin-overview.png',
  requestTypes: 'screenshots/light/04-published-request-type.png',
  deliveryConnections: 'screenshots/light/03-delivery-connection.png',
  peopleAccess: 'screenshots/light/02-role-boundaries.png',
  processingHealth: 'screenshots/light/14-processing-recovery.png',
  activityLog: 'screenshots/light/12-correlated-activity.png',
  notifications: 'screenshots/light/11-requester-notifications.png',
} as const;

// The selected proxies preserve the complete browser takes. These offsets keep
// each Remotion chapter on the useful, already-reviewed part of its take.
export const clipTrimBefore = {
  problem: 90,
  solution: 495,
  login: 0,
  submit: 0,
  approve: 0,
  processing: 0,
  delivery: 0,
  result: 0,
} as const;

export const fallbackScreens = {
  overview: 'screenshots/dark/01-admin-overview.png',
  login: 'screenshots/mobile/01-login-light-390x844.png',
  submit: 'screenshots/light/05-submit-expense-review.png',
  approve: 'screenshots/light/07-approver-review.png',
  processing: 'screenshots/light/08-processing-completed.png',
  delivery: 'screenshots/light/10-receiver-accepted.png',
  audit: 'screenshots/light/12-correlated-activity.png',
} as const;
