/**
 * StorageClient — single-seam interface to the object store (S3-compatible).
 *
 * This module is the ONLY place in `@asp/api` permitted to import the AWS
 * SDK (`@aws-sdk/*`). Route handlers, services, and agents must depend on the
 * `StorageClient` interface and receive a concrete implementation via
 * `fastify.storageClient` (see `src/plugins/storage.ts`). The ESLint
 * `no-restricted-imports` rule in `api/eslint.config.js` enforces this
 * containment.
 *
 * INFRA-054 implements the four methods against S3 using `@aws-sdk/client-s3`
 * and `@aws-sdk/s3-request-presigner`. The S3 client is constructed lazily
 * (on first call) so local dev without S3 configured still boots cleanly.
 *
 * The `upload` body type is `Buffer | Readable` where `Readable` is the
 * Node-side `node:stream` Readable, NOT the Web Streams `ReadableStream`.
 * This seam runs in the API process — the browser never imports it. UI uploads
 * cross the wire to an API route, which decodes the request body (Buffer or
 * a Node Readable) before invoking `StorageClient.upload(...)`.
 */

import type { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

/**
 * Thrown by `download()` when the requested key does not exist in the bucket.
 * Routes should map this to a 404 response.
 */
export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}

/**
 * Configuration handle passed to `buildStorageClient()`.
 * Kept opaque — the factory reads from `config` directly (INFRA-054).
 */
export type StorageClientConfig = Record<string, never>;

export interface StorageClient {
  /**
   * Upload an object to the configured bucket under `key`.
   *
   * @param key         destination object key (no leading slash)
   * @param body        Buffer or Node `Readable` stream — NOT a Web ReadableStream
   * @param contentType MIME content type to store on the object
   */
  upload(
    key: string,
    body: Buffer | Readable,
    contentType: string,
  ): Promise<void>;

  /**
   * Download an object by key and return its content as a Buffer.
   * Throws `StorageNotFoundError` if the key does not exist.
   *
   * @param key object key to download
   */
  download(key: string): Promise<Buffer>;

  /**
   * Mint a presigned URL the client can use to GET the object directly.
   *
   * @param key              object key to sign
   * @param expiresInSeconds presigned URL lifetime in seconds
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;

  /**
   * Delete an object by key. Missing keys are treated as a no-op by S3
   * (DELETE is idempotent in S3; no error is thrown for non-existent keys).
   */
  delete(key: string): Promise<void>;
}

/** Lazily-constructed S3Client singleton — built on first use. */
let _s3: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: config.S3_REGION ?? 'us-east-1',
    });
  }
  return _s3;
}

/**
 * Collect an SDK body stream into a Node Buffer.
 * The `Body` from `GetObjectCommand` is typed as `StreamingBlobPayloadOutputTypes`
 * in the SDK; at runtime in Node it is a `Readable`.
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Default factory. Returns an S3-backed `StorageClient`. The S3 client is
 * constructed lazily on first call so local dev without S3 configured boots
 * cleanly (errors surface at runtime only when a storage route is invoked).
 *
 * The `_cfg` parameter is accepted for forward compatibility.
 */
export function buildStorageClient(
  _cfg?: StorageClientConfig,
): StorageClient {
  const bucket = (): string => {
    const b = config.S3_BUCKET;
    if (!b) throw new Error('S3_BUCKET is not configured');
    return b;
  };

  return {
    async upload(
      key: string,
      body: Buffer | Readable,
      contentType: string,
    ): Promise<void> {
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    async download(key: string): Promise<Buffer> {
      let resp;
      try {
        resp = await getS3Client().send(
          new GetObjectCommand({
            Bucket: bucket(),
            Key: key,
          }),
        );
      } catch (err) {
        // Map S3 NoSuchKey (and its HTTP 404 variant) to a typed error.
        if (
          err instanceof Error &&
          (err.name === 'NoSuchKey' ||
            ('$metadata' in err &&
              (err as { $metadata: { httpStatusCode?: number } }).$metadata
                .httpStatusCode === 404))
        ) {
          throw new StorageNotFoundError(key);
        }
        throw err;
      }
      if (!resp.Body) {
        throw new StorageNotFoundError(key);
      }
      return streamToBuffer(resp.Body as Readable);
    },

    async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
      const command = new GetObjectCommand({
        Bucket: bucket(),
        Key: key,
      });
      return awsGetSignedUrl(getS3Client(), command, {
        expiresIn: expiresInSeconds,
      });
    },

    async delete(key: string): Promise<void> {
      await getS3Client().send(
        new DeleteObjectCommand({
          Bucket: bucket(),
          Key: key,
        }),
      );
    },
  };
}
