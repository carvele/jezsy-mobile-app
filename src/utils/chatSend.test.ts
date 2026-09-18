import { resolveOutgoingText } from './chatSend';

describe('resolveOutgoingText', () => {
  test('a string override wins over the live input', () => {
    expect(resolveOutgoingText('Hi! Starter text.', 'whatever is typed')).toBe('Hi! Starter text.');
  });

  test('trims the override', () => {
    expect(resolveOutgoingText('  padded  ', '')).toBe('padded');
  });

  test('falls back to inputText when no override is given', () => {
    expect(resolveOutgoingText(undefined, '  typed text  ')).toBe('typed text');
  });

  test('a non-string override (RN event object) is ignored, falling back to inputText', () => {
    const fakeEvent = { nativeEvent: { text: 'typed text' } };
    expect(resolveOutgoingText(fakeEvent, 'typed text')).toBe('typed text');
  });

  test('empty/whitespace-only resolves to an empty string, which callers treat as "nothing to send"', () => {
    expect(resolveOutgoingText(undefined, '   ')).toBe('');
    expect(resolveOutgoingText('   ', 'typed text')).toBe('');
  });
});
