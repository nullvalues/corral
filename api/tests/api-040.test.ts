/**
 * Unit tests for GET /api/mentor/impact (API-040).
 *
 * Unit project — no DATABASE_URL_TEST required. The DB is mocked so no live
 * connection is needed (mirrors the mock style of mentor-grants.test.ts).
 *
 * Coverage:
 *   computeStreakDays (pure):
 *   - empty / today-only / today+yesterday / no-today / gap-breaks-run
 *   getMentorImpact (DB mocked):
 *   - shapes numbers from aggregate rows, rounds avgTurnaround to 1 decimal
 *   - maps SQL null avgTurnaround → JS null
 *   route:
 *   - 401 when unauthenticated
 *   - 200 with a schema-valid object when authenticated
 *
 * DB-backed ABAC / counter-math assertions live in TEST-051 (integration).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted result queue: getMentorImpact runs three sequential awaited queries
// (agg, streak-days, pending). Each terminal await shifts the next queued
// result. setResults(...) loads the queue in call order.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const state = { queue: [] as unknown[] };
  return {
    state,
    setResults: (...results: unknown[]) => {
      state.queue = [...results];
    },
  };
});

vi.mock('../src/db/index.js', () => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder['from'] = chain;
  builder['where'] = chain;
  builder['groupBy'] = chain;
  builder['orderBy'] = chain;
  builder['innerJoin'] = chain;
  builder['limit'] = chain;
  builder['then'] = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(h.state.queue.shift() ?? []).then(resolve, reject);
  return {
    db: {
      select: () => builder,
      insert: () => ({ values: () => ({ catch: () => undefined }) }),
    },
  };
});

vi.mock('../src/services/auth/index.js', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
  setMailer: vi.fn(),
}));

import { buildApp } from '../src/app.js';
import { auth } from '../src/services/auth/index.js';
import { getMentorImpact, computeStreakDays } from '../src/services/mentor-impact.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MENTOR_USER_ID = 'mentor-user-1';

function utcDayString(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// computeStreakDays — pure unit
// ---------------------------------------------------------------------------

describe('computeStreakDays', () => {
  const today = new Date('2026-06-15T12:00:00Z');

  it('returns 0 for no verification days', () => {
    expect(computeStreakDays([], today)).toBe(0);
  });

  it('returns 1 when only today has a verification', () => {
    expect(computeStreakDays(['2026-06-15'], today)).toBe(1);
  });

  it('counts consecutive days ending today', () => {
    expect(computeStreakDays(['2026-06-15', '2026-06-14', '2026-06-13'], today)).toBe(3);
  });

  it('returns 0 when today has no verification (run must end today)', () => {
    expect(computeStreakDays(['2026-06-14', '2026-06-13'], today)).toBe(0);
  });

  it('breaks at the first missing day', () => {
    // today + day-before-yesterday, but yesterday is missing → run is just today
    expect(computeStreakDays(['2026-06-15', '2026-06-13'], today)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getMentorImpact — service shape (DB mocked)
// ---------------------------------------------------------------------------

describe('getMentorImpact — unit', () => {
  beforeEach(() => {
    h.setResults();
  });

  it('shapes numeric fields and rounds avgTurnaround to one decimal', async () => {
    h.setResults(
      [{ monthHours: '40', lifetimeHours: '120', applicants: '3', avgTurnaround: '24.34' }],
      [{ day: utcDayString(0) }, { day: utcDayString(-1) }],
      [{ count: '5' }],
    );

    const result = await getMentorImpact(MENTOR_USER_ID);

    expect(result.monthHoursVerified).toBe(40);
    expect(result.lifetimeHoursVerified).toBe(120);
    expect(result.applicantsMentored).toBe(3);
    expect(result.avgTurnaroundHours).toBe(24.3);
    expect(result.streakDays).toBe(2);
    expect(result.pendingVerifications).toBe(5);
  });

  it('maps a SQL null avgTurnaround to JS null and yields a 0 streak when no days', async () => {
    h.setResults(
      [{ monthHours: '0', lifetimeHours: '0', applicants: '0', avgTurnaround: null }],
      [],
      [{ count: '0' }],
    );

    const result = await getMentorImpact(MENTOR_USER_ID);

    expect(result.avgTurnaroundHours).toBeNull();
    expect(result.monthHoursVerified).toBe(0);
    expect(result.lifetimeHoursVerified).toBe(0);
    expect(result.applicantsMentored).toBe(0);
    expect(result.streakDays).toBe(0);
    expect(result.pendingVerifications).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/mentor/impact — route
// ---------------------------------------------------------------------------

describe('GET /api/mentor/impact — route', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    h.setResults();
  });

  it('returns 401 when no session is provided', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/mentor/impact' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with a schema-valid impact object when authenticated', async () => {
    const fakeUser = {
      id: MENTOR_USER_ID,
      name: 'Mentor User',
      email: 'mentor@example.com',
      twoFactorEnabled: true,
    };
    const fakeSession = { id: 'sess-mentor', userId: MENTOR_USER_ID, token: 'tok-mentor' };
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: fakeUser as never,
      session: fakeSession as never,
    });
    h.setResults(
      [{ monthHours: '12', lifetimeHours: '88', applicants: '2', avgTurnaround: '18.0' }],
      [{ day: utcDayString(0) }],
      [{ count: '4' }],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mentor/impact',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        monthHoursVerified: number;
        lifetimeHoursVerified: number;
        applicantsMentored: number;
        avgTurnaroundHours: number | null;
        streakDays: number;
        pendingVerifications: number;
      };
      expect(body.monthHoursVerified).toBe(12);
      expect(body.lifetimeHoursVerified).toBe(88);
      expect(body.applicantsMentored).toBe(2);
      expect(body.avgTurnaroundHours).toBe(18);
      expect(body.streakDays).toBe(1);
      expect(body.pendingVerifications).toBe(4);
    } finally {
      await app.close();
    }
  });
});
