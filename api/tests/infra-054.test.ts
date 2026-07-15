/**
 * Unit tests for StorageClient S3 implementation (INFRA-054).
 *
 * Mocks the AWS SDK commands so no real S3 credentials are needed.
 * Tests cover all four methods:
 *   - upload: issues PutObjectCommand with correct params
 *   - download: returns body as Buffer; NoSuchKey maps to StorageNotFoundError
 *   - getSignedUrl: passes key and expiry through to the presigner
 *   - delete: issues DeleteObjectCommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

// Hoist mutable mock references so vi.mock factories can access them
const { mockSend, mockGetSignedUrl } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = mockSend;
  }
  class PutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class DeleteObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

// Stub config so StorageClient can initialise without a real .env
vi.mock('../src/lib/config.js', () => ({
  config: {
    S3_BUCKET: 'test-bucket',
    S3_REGION: 'us-east-1',
  },
}));

// Import AFTER mocks are declared
import { buildStorageClient, StorageNotFoundError } from '../src/lib/storage.js';

// Helper: create a Readable stream from a string
function makeReadable(data: string | Buffer): Readable {
  const r = new Readable({ read() {} });
  r.push(typeof data === 'string' ? Buffer.from(data) : data);
  r.push(null);
  return r;
}

describe('StorageClient — upload', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
  });

  it('issues PutObjectCommand with correct bucket, key, body, and contentType', async () => {
    mockSend.mockResolvedValue({});
    const client = buildStorageClient();
    const body = Buffer.from('hello world');
    await client.upload('path/to/file.jpg', body, 'image/jpeg');

    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmd.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'path/to/file.jpg',
      Body: body,
      ContentType: 'image/jpeg',
    });
  });
});

describe('StorageClient — download', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
  });

  it('returns the object body as a Buffer', async () => {
    const bodyStream = makeReadable('file contents');
    mockSend.mockResolvedValue({ Body: bodyStream });

    const client = buildStorageClient();
    const result = await client.download('docs/readme.txt');
    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe('file contents');
  });

  it('maps NoSuchKey error to StorageNotFoundError', async () => {
    const err = new Error('NoSuchKey') as Error & { name: string };
    err.name = 'NoSuchKey';
    mockSend.mockRejectedValue(err);

    const client = buildStorageClient();
    await expect(client.download('missing/key.txt')).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
  });

  it('maps HTTP 404 metadata error to StorageNotFoundError', async () => {
    const err = Object.assign(new Error('Not Found'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });
    mockSend.mockRejectedValue(err);

    const client = buildStorageClient();
    await expect(client.download('missing/key.txt')).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
  });

  it('re-throws unexpected errors unchanged', async () => {
    const err = new Error('Connection timeout');
    mockSend.mockRejectedValue(err);

    const client = buildStorageClient();
    await expect(client.download('some/key.txt')).rejects.toThrow(
      'Connection timeout',
    );
  });
});

describe('StorageClient — getSignedUrl', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
  });

  it('calls the presigner with the correct command and expiry, returns URL', async () => {
    const expectedUrl =
      'https://test-bucket.s3.amazonaws.com/my/key?X-Amz-Signature=abc';
    mockGetSignedUrl.mockResolvedValue(expectedUrl);

    const client = buildStorageClient();
    const url = await client.getSignedUrl('my/key', 3600);

    expect(mockGetSignedUrl).toHaveBeenCalledOnce();
    // Third arg should carry the expiresIn option
    expect(mockGetSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 3600 });
    // Second arg is the GetObjectCommand — inspect its input
    const cmd = mockGetSignedUrl.mock.calls[0][1] as {
      input: Record<string, unknown>;
    };
    expect(cmd.input).toMatchObject({ Bucket: 'test-bucket', Key: 'my/key' });
    expect(url).toBe(expectedUrl);
  });
});

describe('StorageClient — delete', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
  });

  it('issues DeleteObjectCommand with correct bucket and key', async () => {
    mockSend.mockResolvedValue({});
    const client = buildStorageClient();
    await client.delete('uploads/old-file.pdf');

    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmd.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'uploads/old-file.pdf',
    });
  });
});
