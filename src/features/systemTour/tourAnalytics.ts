import { TourModuleId } from './tourConfig';

/**
 * Frozen internal event taxonomy for the tour, decided ahead of picking any
 * telemetry provider. Nothing outside this file should construct these
 * event names as raw strings - call reportTourAnalyticsEvent instead, so
 * whichever provider gets chosen later is a pure adapter behind this one
 * function, not something threaded through the tour domain logic.
 *
 * Not wired to a provider yet - this project has no analytics/telemetry
 * pipeline configured. Do not add one without checking with the user first
 * (see CLAUDE.md: no new dependency without confirmation, and AI
 * Restrictions on what may leave the device). reportTourAnalyticsEvent is a
 * deliberate no-op (console-only in dev) until that decision is made.
 */
export type TourAnalyticsEvent =
  | 'tour_introduced'
  | 'tour_module_started'
  | 'tour_step_completed'
  | 'tour_module_completed'
  | 'tour_skipped'
  | 'tour_opted_out'
  | 'tour_completed'
  | 'tour_replayed';

export interface TourAnalyticsProperties {
  moduleId?: TourModuleId;
  stepId?: string;
  source?: 'auto' | 'home_progress' | 'profile_replay';
  /** The relevant module's config version, or 0 for tour-wide events not tied to one module. */
  version: number;
}

export function reportTourAnalyticsEvent(event: TourAnalyticsEvent, properties: TourAnalyticsProperties): void {
  if (__DEV__) {
    console.debug('[tourAnalytics]', event, properties);
  }
  // No provider wired yet - see the file-level note above.
}
