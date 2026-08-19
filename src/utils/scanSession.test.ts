import { createScanSession, consumeScanSession } from '@/src/utils/scanSession';

describe('scan sessions', () => {
  it('stores results behind an opaque id and consumes them once', () => {
    const id = createScanSession({
      measurements: { waist: 80 },
      height: 170,
      weight: 60,
      gender: 'non-binary',
    });

    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(consumeScanSession(id)?.measurements).toEqual({ waist: 80 });
    expect(consumeScanSession(id)).toBeNull();
  });
});
