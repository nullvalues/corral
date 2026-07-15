/**
 * Unit tests for API-065 — upload, read, and delete endpoints for headshots
 * and resumes, plus the mentor-scoped resume read.
 *
 * Routes under test:
 *   POST   /api/me/headshot
 *   GET    /api/me/headshot
 *   POST   /api/me/resume
 *   GET    /api/me/resume
 *   DELETE /api/me/resume
 *   GET    /api/mentor/applicants/:id/resume
 *
 * All S3 / DB calls are mocked. Multipart bodies are constructed manually so
 * the real @fastify/multipart plugin can parse them — this avoids the fragile
 * per-request decoration mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StorageClient } from '../src/lib/storage.js';

// ---------------------------------------------------------------------------
// Hoist mutable mock references
// ---------------------------------------------------------------------------

const { mockGetSession, mockGetProfileKeys, mockUpdateProfileKeys, mockHasMentorGrant } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn().mockResolvedValue(null),
    mockGetProfileKeys: vi.fn(),
    mockUpdateProfileKeys: vi.fn().mockResolvedValue(undefined),
    mockHasMentorGrant: vi.fn().mockResolvedValue(false),
  }));

vi.mock('../src/services/auth/index.js', () => ({
  auth: { api: { getSession: mockGetSession } },
  setMailer: vi.fn(),
}));

vi.mock('../src/services/profile.js', () => ({
  getMyProfile: vi.fn().mockResolvedValue(null),
  updateMyProfile: vi.fn().mockResolvedValue(null),
  getApplicantProfileForMentor: vi.fn().mockResolvedValue(null),
  getProfileKeys: mockGetProfileKeys,
  updateProfileKeys: mockUpdateProfileKeys,
}));

vi.mock('../src/services/auth/abacPredicates.js', () => ({
  isOwner: vi.fn().mockReturnValue(false),
  hasMentorGrant: mockHasMentorGrant,
}));

// DB mock — needed by system_roles / requireAuth chain
vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnValue({
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve([]).then(resolve),
      catch: (reject: (e: unknown) => unknown) =>
        Promise.resolve([]).catch(reject),
      limit: vi.fn().mockResolvedValue([]),
    }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
}));

import { buildApp } from '../src/app.js';
import { auth } from '../src/services/auth/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-api065-1';
const APPLICANT_ID = 'applicant-api065-2';
const BOUNDARY = '----TestBoundary1234';

function mockSession(userId = USER_ID) {
  const fakeUser = {
    id: userId,
    name: 'Test User',
    email: 'test@example.com',
    twoFactorEnabled: true,
  };
  const fakeSession = { id: 'sess-065', userId, token: 'tok-065' };
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: fakeUser as never,
    session: fakeSession as never,
  });
}

function makeStorageClient(overrides: Partial<StorageClient> = {}): StorageClient {
  return {
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(Buffer.from('')),
    getSignedUrl: vi.fn().mockResolvedValue('https://example.s3.amazonaws.com/presigned'),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Build a raw multipart/form-data body as a Buffer.
 * Used to feed real multipart bodies to the @fastify/multipart plugin.
 */
function buildMultipartBody(
  fieldname: string,
  filename: string,
  contentType: string,
  data: Buffer,
): { body: Buffer; contentType: string } {
  const header = [
    `--${BOUNDARY}`,
    `Content-Disposition: form-data; name="${fieldname}"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    '',
    '',
  ].join('\r\n');
  const footer = `\r\n--${BOUNDARY}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(header),
    data,
    Buffer.from(footer),
  ]);
  return {
    body,
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

// A tiny fake JPEG (just enough bytes for the test — not a valid image)
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const FAKE_PDF = Buffer.from('%PDF-1.4 test pdf content');

// ---------------------------------------------------------------------------
// POST /api/me/headshot
// ---------------------------------------------------------------------------

describe('POST /api/me/headshot', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    mockGetProfileKeys.mockResolvedValue({ headshotKey: null, resumeKey: null });
    mockUpdateProfileKeys.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    const app = await buildApp({ storageClient: makeStorageClient() });
    try {
      const { body, contentType } = buildMultipartBody('file', 'test.jpg', 'image/jpeg', FAKE_JPEG);
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/headshot',
        headers: { 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('stores jpeg under headshots/<userId>.jpg and returns presigned url', async () => {
    const storageClient = makeStorageClient();
    mockSession();
    const { body, contentType } = buildMultipartBody('file', 'photo.jpg', 'image/jpeg', FAKE_JPEG);

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/headshot',
        headers: { cookie: 'session=fake', 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      const resBody = JSON.parse(res.body) as { url: string };
      expect(resBody.url).toContain('presigned');
      expect(vi.mocked(storageClient.upload)).toHaveBeenCalledWith(
        `headshots/${USER_ID}.jpg`,
        expect.any(Buffer),
        'image/jpeg',
      );
      expect(mockUpdateProfileKeys).toHaveBeenCalledWith(USER_ID, {
        headshotKey: `headshots/${USER_ID}.jpg`,
      });
    } finally {
      await app.close();
    }
  });

  it('stores webp under headshots/<userId>.webp', async () => {
    const storageClient = makeStorageClient();
    mockSession();
    const { body, contentType } = buildMultipartBody(
      'file', 'photo.webp', 'image/webp', Buffer.from('webp-data'),
    );

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/headshot',
        headers: { cookie: 'session=fake', 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(vi.mocked(storageClient.upload)).toHaveBeenCalledWith(
        `headshots/${USER_ID}.webp`,
        expect.any(Buffer),
        'image/webp',
      );
    } finally {
      await app.close();
    }
  });

  it('returns 415 for unsupported type (gif)', async () => {
    const storageClient = makeStorageClient();
    mockSession();
    const { body, contentType } = buildMultipartBody(
      'file', 'anim.gif', 'image/gif', Buffer.from('gif-data'),
    );

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/headshot',
        headers: { cookie: 'session=fake', 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(415);
      expect(vi.mocked(storageClient.upload)).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('deletes old key best-effort when extension changes (jpg → webp)', async () => {
    const storageClient = makeStorageClient();
    mockSession();
    // Existing key is .jpg, now uploading .webp
    mockGetProfileKeys.mockResolvedValue({
      headshotKey: `headshots/${USER_ID}.jpg`,
      resumeKey: null,
    });
    const { body, contentType } = buildMultipartBody(
      'file', 'photo.webp', 'image/webp', Buffer.from('webp-data'),
    );

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/headshot',
        headers: { cookie: 'session=fake', 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(vi.mocked(storageClient.delete)).toHaveBeenCalledWith(
        `headshots/${USER_ID}.jpg`,
      );
    } finally {
      await app.close();
    }
  });

  it('does not delete old key when same extension is re-uploaded', async () => {
    const storageClient = makeStorageClient();
    mockSession();
    mockGetProfileKeys.mockResolvedValue({
      headshotKey: `headshots/${USER_ID}.jpg`,
      resumeKey: null,
    });
    const { body, contentType } = buildMultipartBody(
      'file', 'photo.jpg', 'image/jpeg', FAKE_JPEG,
    );

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/headshot',
        headers: { cookie: 'session=fake', 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      // key is the same — no delete call
      expect(vi.mocked(storageClient.delete)).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/me/headshot
// ---------------------------------------------------------------------------

describe('GET /api/me/headshot', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    mockGetProfileKeys.mockResolvedValue({ headshotKey: null, resumeKey: null });
  });

  it('returns 401 when unauthenticated', async () => {
    const app = await buildApp({ storageClient: makeStorageClient() });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/me/headshot' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when no headshot key is stored', async () => {
    mockSession();
    const app = await buildApp({ storageClient: makeStorageClient() });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me/headshot',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns { url } with presigned URL when key exists', async () => {
    mockSession();
    mockGetProfileKeys.mockResolvedValue({
      headshotKey: `headshots/${USER_ID}.jpg`,
      resumeKey: null,
    });
    const storageClient = makeStorageClient();

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me/headshot',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const resBody = JSON.parse(res.body) as { url: string };
      expect(resBody.url).toBe('https://example.s3.amazonaws.com/presigned');
      expect(vi.mocked(storageClient.getSignedUrl)).toHaveBeenCalledWith(
        `headshots/${USER_ID}.jpg`,
        1800,
      );
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/me/resume
// ---------------------------------------------------------------------------

describe('POST /api/me/resume', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    mockGetProfileKeys.mockResolvedValue({ headshotKey: null, resumeKey: null });
    mockUpdateProfileKeys.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    const app = await buildApp({ storageClient: makeStorageClient() });
    try {
      const { body, contentType } = buildMultipartBody(
        'file', 'resume.pdf', 'application/pdf', FAKE_PDF,
      );
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/resume',
        headers: { 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('accepts PDF and stores under resumes/<userId>.pdf', async () => {
    const storageClient = makeStorageClient();
    mockSession();
    const { body, contentType } = buildMultipartBody(
      'file', 'resume.pdf', 'application/pdf', FAKE_PDF,
    );

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/resume',
        headers: { cookie: 'session=fake', 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      const resBody = JSON.parse(res.body) as { url: string };
      expect(resBody.url).toContain('presigned');
      expect(vi.mocked(storageClient.upload)).toHaveBeenCalledWith(
        `resumes/${USER_ID}.pdf`,
        expect.any(Buffer),
        'application/pdf',
      );
      expect(mockUpdateProfileKeys).toHaveBeenCalledWith(USER_ID, {
        resumeKey: `resumes/${USER_ID}.pdf`,
      });
    } finally {
      await app.close();
    }
  });

  it('returns 415 for wrong type (image/jpeg)', async () => {
    const storageClient = makeStorageClient();
    mockSession();
    const { body, contentType } = buildMultipartBody(
      'file', 'photo.jpg', 'image/jpeg', FAKE_JPEG,
    );

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/resume',
        headers: { cookie: 'session=fake', 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(415);
      expect(vi.mocked(storageClient.upload)).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('stores png headshot under headshots/<userId>.png', async () => {
    const storageClient = makeStorageClient();
    mockSession();
    const { body, contentType } = buildMultipartBody(
      'file', 'avatar.png', 'image/png', FAKE_PNG,
    );

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/headshot',
        headers: { cookie: 'session=fake', 'content-type': contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(vi.mocked(storageClient.upload)).toHaveBeenCalledWith(
        `headshots/${USER_ID}.png`,
        expect.any(Buffer),
        'image/png',
      );
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/me/resume
// ---------------------------------------------------------------------------

describe('DELETE /api/me/resume', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    mockGetProfileKeys.mockResolvedValue({ headshotKey: null, resumeKey: null });
    mockUpdateProfileKeys.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    const app = await buildApp({ storageClient: makeStorageClient() });
    try {
      const res = await app.inject({ method: 'DELETE', url: '/api/me/resume' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when no resume is stored', async () => {
    mockSession();
    const app = await buildApp({ storageClient: makeStorageClient() });
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/me/resume',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('deletes the S3 object and nulls the key, returns 204', async () => {
    const storageClient = makeStorageClient();
    mockSession();
    mockGetProfileKeys.mockResolvedValue({
      headshotKey: null,
      resumeKey: `resumes/${USER_ID}.pdf`,
    });

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/me/resume',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(204);
      expect(vi.mocked(storageClient.delete)).toHaveBeenCalledWith(
        `resumes/${USER_ID}.pdf`,
      );
      expect(mockUpdateProfileKeys).toHaveBeenCalledWith(USER_ID, { resumeKey: null });
    } finally {
      await app.close();
    }
  });

  it('still nulls the DB key even if S3 delete fails', async () => {
    const storageClient = makeStorageClient({
      delete: vi.fn().mockRejectedValue(new Error('S3 error')),
    });
    mockSession();
    mockGetProfileKeys.mockResolvedValue({
      headshotKey: null,
      resumeKey: `resumes/${USER_ID}.pdf`,
    });

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/me/resume',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(204);
      expect(mockUpdateProfileKeys).toHaveBeenCalledWith(USER_ID, { resumeKey: null });
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/me/resume
// ---------------------------------------------------------------------------

describe('GET /api/me/resume', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    mockGetProfileKeys.mockResolvedValue({ headshotKey: null, resumeKey: null });
  });

  it('returns 401 when unauthenticated', async () => {
    const app = await buildApp({ storageClient: makeStorageClient() });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/me/resume' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when no resume key is stored', async () => {
    mockSession();
    const app = await buildApp({ storageClient: makeStorageClient() });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me/resume',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns { url } with presigned URL when resume key exists', async () => {
    mockSession();
    mockGetProfileKeys.mockResolvedValue({
      headshotKey: null,
      resumeKey: `resumes/${USER_ID}.pdf`,
    });
    const storageClient = makeStorageClient();

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me/resume',
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const resBody = JSON.parse(res.body) as { url: string };
      expect(resBody.url).toBe('https://example.s3.amazonaws.com/presigned');
      expect(vi.mocked(storageClient.getSignedUrl)).toHaveBeenCalledWith(
        `resumes/${USER_ID}.pdf`,
        1800,
      );
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/mentor/applicants/:id/resume
// ---------------------------------------------------------------------------

describe('GET /api/mentor/applicants/:id/resume', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    mockHasMentorGrant.mockResolvedValue(false);
    mockGetProfileKeys.mockResolvedValue({ headshotKey: null, resumeKey: null });
  });

  it('returns 401 when unauthenticated', async () => {
    const app = await buildApp({ storageClient: makeStorageClient() });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/mentor/applicants/${APPLICANT_ID}/resume`,
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 when caller has no mentor grant', async () => {
    mockSession();
    mockHasMentorGrant.mockResolvedValue(false);

    const app = await buildApp({ storageClient: makeStorageClient() });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/mentor/applicants/${APPLICANT_ID}/resume`,
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when grant exists but applicant has no resume', async () => {
    mockSession();
    mockHasMentorGrant.mockResolvedValue(true);
    mockGetProfileKeys.mockResolvedValue({ headshotKey: null, resumeKey: null });

    const app = await buildApp({ storageClient: makeStorageClient() });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/mentor/applicants/${APPLICANT_ID}/resume`,
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns { url } with presigned URL when grant exists and resume is stored', async () => {
    mockSession();
    mockHasMentorGrant.mockResolvedValue(true);
    mockGetProfileKeys.mockResolvedValue({
      headshotKey: null,
      resumeKey: `resumes/${APPLICANT_ID}.pdf`,
    });
    const storageClient = makeStorageClient();

    const app = await buildApp({ storageClient });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/mentor/applicants/${APPLICANT_ID}/resume`,
        headers: { cookie: 'session=fake' },
      });
      expect(res.statusCode).toBe(200);
      const resBody = JSON.parse(res.body) as { url: string };
      expect(resBody.url).toBe('https://example.s3.amazonaws.com/presigned');
      expect(vi.mocked(storageClient.getSignedUrl)).toHaveBeenCalledWith(
        `resumes/${APPLICANT_ID}.pdf`,
        1800,
      );
      expect(mockHasMentorGrant).toHaveBeenCalledWith(USER_ID, APPLICANT_ID, 'read');
    } finally {
      await app.close();
    }
  });
});
