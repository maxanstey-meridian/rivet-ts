import type { Clock } from "../../src/modules/quotes/application/ports/clock.js";

export class FixedClock implements Clock {
  public constructor(private readonly fixedAt = new Date("2026-01-01T00:00:00.000Z")) {}

  public now(): Date {
    return this.fixedAt;
  }
}
