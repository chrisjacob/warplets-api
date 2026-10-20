// Shared by atomic write guards and the read-only operations view. These remain
// local technical limits, not production capacity or economic policy.
export const CONTENT_LIMITS = Object.freeze({
  open_campaigns: 10, campaigns_per_day: 20,
  submissions_per_day: 100, submissions_per_identity_day: 10, content_events_per_day: 300,
  reports_per_day: 30, reports_per_identity_day: 3, reports_per_submission: 10, report_events_per_day: 150,
  hold_reviews_per_day: 20, hold_reviews_per_identity_day: 3, hold_events_per_day: 100,
});
