/**
 * Resolves what text a send action should use: an explicit string override
 * (e.g. a starter chip's text) takes priority, otherwise the live input
 * value. Guards against a caller accidentally passing something else --
 * React Native's onPress/onSubmitEditing pass an event object as the first
 * argument, and without this check that object would get treated as the
 * message text instead of falling back to inputText.
 */
export function resolveOutgoingText(overrideText: unknown, inputText: string): string {
  return (typeof overrideText === 'string' ? overrideText : inputText).trim();
}
