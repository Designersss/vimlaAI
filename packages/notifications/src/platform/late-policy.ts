export function isPastMaxLateness(input: {
  scheduledFor: Date;
  now: Date;
  maxLatenessMinutes: number;
}): boolean {
  const ageMs = input.now.getTime() - input.scheduledFor.getTime();
  return ageMs > input.maxLatenessMinutes * 60_000;
}
