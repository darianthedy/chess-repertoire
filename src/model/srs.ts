import type { CardState } from './types';

export const DAY = 86_400_000;

/**
 * Binary grading, not SM-2's 0–5 self-rating: self-rating is slow and easy to
 * cheat. Correct maps to 4 (which leaves ease untouched under the standard
 * formula) and wrong maps to 2 (which drops ease and resets the interval).
 */
export const CORRECT = 4;
export const WRONG = 2;

const MIN_EASE = 1.3;

export function newCard(now: number): CardState {
  return { ease: 2.5, interval: 0, reps: 0, dueAt: now, lapses: 0 };
}

export function cardKey(repertoireId: string, fen: string): string {
  return `${repertoireId}:${fen}`;
}

/**
 * Standard SM-2. A failed card returns to a one-day interval rather than being
 * dropped from the session — the drill loop re-queues it separately.
 */
export function schedule(
  card: CardState,
  quality: number,
  now: number,
): CardState {
  const ease = Math.max(
    MIN_EASE,
    card.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  if (quality < 3) {
    return {
      ease,
      interval: 1,
      reps: 0,
      dueAt: now + DAY,
      lapses: card.lapses + 1,
    };
  }

  const reps = card.reps + 1;
  const interval =
    reps === 1 ? 1 : reps === 2 ? 6 : Math.round(card.interval * ease);

  return { ease, interval, reps, dueAt: now + interval * DAY, lapses: card.lapses };
}

export function isDue(card: CardState | undefined, now: number): boolean {
  return !card || card.dueAt <= now;
}

/** Local YYYY-MM-DD, used for streak bookkeeping. */
export function dayStamp(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function bumpStreak(
  streak: { count: number; lastDate: string } | null,
  now: number,
): { count: number; lastDate: string } {
  const today = dayStamp(now);
  if (streak?.lastDate === today) return streak;
  const yesterday = dayStamp(now - DAY);
  return {
    count: streak?.lastDate === yesterday ? streak.count + 1 : 1,
    lastDate: today,
  };
}
