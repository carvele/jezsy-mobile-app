export interface StylistRunCallbacks<T> {
  onStart: () => void;
  /** Returns undefined to abandon the run (for example when the request was superseded mid-way). */
  run: (isCurrent: () => boolean) => Promise<T | undefined>;
  onSuccess: (result: T) => void;
  onError: (err: unknown) => void;
  onSettled: () => void;
}

/**
 * Runs one stylist analysis request where only the latest request may touch the UI. A failure is always
 * reported to onError (never left as an unhandled rejection), and superseded or cancelled requests are silent.
 */
export async function runStylistRequest<T>(
  idRef: { current: number },
  { onStart, run, onSuccess, onError, onSettled }: StylistRunCallbacks<T>
): Promise<void> {
  const requestId = ++idRef.current;
  const isCurrent = () => requestId === idRef.current;
  onStart();
  try {
    const result = await run(isCurrent);
    if (!isCurrent() || result === undefined) return;
    onSuccess(result);
  } catch (err) {
    if (isCurrent()) onError(err);
  } finally {
    if (isCurrent()) onSettled();
  }
}
