import { describe, expect, it } from 'vitest';
import { overlapsAnyBusySlot } from '@/lib/scheduling';

const at = (hours: number, minutes = 0) => new Date(2026, 2, 4, hours, minutes, 0, 0);

const busy = (startHour: number, endHour: number) => ({
  start: at(startHour),
  end: at(endHour),
});

describe('overlapsAnyBusySlot', () => {
  it('returns false when the technician has no commitments', () => {
    expect(overlapsAnyBusySlot([], at(10), at(11))).toBe(false);
  });

  it('detects a slot starting inside a busy block', () => {
    expect(overlapsAnyBusySlot([busy(9, 12)], at(11), at(12))).toBe(true);
  });

  it('detects a slot ending inside a busy block', () => {
    expect(overlapsAnyBusySlot([busy(9, 12)], at(8), at(10))).toBe(true);
  });

  it('detects a slot that fully contains a busy block', () => {
    expect(overlapsAnyBusySlot([busy(10, 11)], at(9), at(12))).toBe(true);
  });

  it('detects a slot fully inside a busy block', () => {
    expect(overlapsAnyBusySlot([busy(9, 17)], at(10), at(11))).toBe(true);
  });

  it('allows back-to-back appointments', () => {
    expect(overlapsAnyBusySlot([busy(9, 10)], at(10), at(11))).toBe(false);
    expect(overlapsAnyBusySlot([busy(11, 13)], at(10), at(11))).toBe(false);
  });

  it('checks every busy block, not just the first', () => {
    const slots = [busy(8, 9), busy(13, 14), busy(16, 17)];
    expect(overlapsAnyBusySlot(slots, at(14), at(15))).toBe(false);
    expect(overlapsAnyBusySlot(slots, at(13, 30), at(15))).toBe(true);
  });

  it('is not fooled by a zero-length busy block', () => {
    const zeroLength = { start: at(10), end: at(10) };
    expect(overlapsAnyBusySlot([zeroLength], at(10), at(11))).toBe(false);
  });
});
