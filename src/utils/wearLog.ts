export interface WearLogOutcome {
  succeeded: string[];
  failed: string[];
}

export interface WearLogSummary {
  /** True only when at least one wear was confirmed by the database. */
  recorded: boolean;
  kind: 'success' | 'error' | 'info';
  message: string;
}

/** Turns the RPC outcome into user feedback. Success is never claimed for a wear the database did not confirm. */
export function describeWearLogResult(outcome: WearLogOutcome, total: number): WearLogSummary {
  if (total === 0 || (outcome.succeeded.length === 0 && outcome.failed.length === 0)) {
    return { recorded: false, kind: 'error', message: 'Could not record wear.' };
  }
  if (outcome.failed.length === 0) {
    return { recorded: true, kind: 'success', message: 'Recorded as worn! Your stylist will remember your favorites.' };
  }
  if (outcome.succeeded.length === 0) {
    return { recorded: false, kind: 'error', message: 'Could not record wear. Please try again.' };
  }
  return {
    recorded: true,
    kind: 'info',
    message: `Recorded ${outcome.succeeded.length} of ${total} items. The rest could not be saved.`,
  };
}
