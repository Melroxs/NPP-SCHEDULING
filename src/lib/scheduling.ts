import { isAfter, isBefore } from 'date-fns';

export interface BusySlot {
  start: Date;
  end: Date;
}

/**
 * True when [start, end) intersects any busy interval. Half-open comparison:
 * a slot ending exactly when another begins is not a conflict.
 */
export function overlapsAnyBusySlot(busySlots: BusySlot[], start: Date, end: Date): boolean {
  return busySlots.some((busy) => isBefore(start, busy.end) && isAfter(end, busy.start));
}
