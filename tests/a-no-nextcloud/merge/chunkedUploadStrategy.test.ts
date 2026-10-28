import { ChunkedUploadStrategy } from '../../../src/sync/upload/ChunkedUploadStrategy';
import { UploadConfig } from '../../../src/sync/upload/IUploadStrategy';
import { NetworkError } from '../../../src/types';
import { IWebDAVClient } from '../../../src/network/IWebDAVClient';

interface FakeClient {
  uploadFile: jest.Mock;
  uploadChunked: jest.Mock;
}

function fakeClient(): FakeClient {
  return {
    uploadFile: jest.fn().mockResolvedValue(undefined),
    uploadChunked: jest.fn().mockResolvedValue(undefined),
  };
}

function uploadConfig(over: Partial<UploadConfig>): UploadConfig {
  return { maxFileSizeMB: 0, uploadChunkThresholdMB: 50, ...over };
}

const data = new ArrayBuffer(10); // about 9.5e-6 MB

describe('ChunkedUploadStrategy', () => {
  it('skips files larger than maxFileSizeMB', async () => {
    const client = fakeClient();
    const s = new ChunkedUploadStrategy(uploadConfig({ maxFileSizeMB: 0.0000001 }));
    const outcome = await s.upload(client as unknown as IWebDAVClient, 'big.bin', data);
    expect(outcome).toBe('skipped');
    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(client.uploadChunked).not.toHaveBeenCalled();
  });

  it('uses chunked upload above the chunk threshold', async () => {
    const client = fakeClient();
    const s = new ChunkedUploadStrategy(uploadConfig({ uploadChunkThresholdMB: 0.0000001, maxFileSizeMB: 100 }));
    const outcome = await s.upload(client as unknown as IWebDAVClient, 'mid.bin', data);
    expect(outcome).toBe('uploaded');
    expect(client.uploadChunked).toHaveBeenCalledTimes(1);
    expect(client.uploadFile).not.toHaveBeenCalled();
  });

  it('uses a single PUT below the chunk threshold', async () => {
    const client = fakeClient();
    const s = new ChunkedUploadStrategy(uploadConfig({ uploadChunkThresholdMB: 100, maxFileSizeMB: 1000 }));
    const outcome = await s.upload(client as unknown as IWebDAVClient, 'small.md', data);
    expect(outcome).toBe('uploaded');
    expect(client.uploadFile).toHaveBeenCalledTimes(1);
    expect(client.uploadChunked).not.toHaveBeenCalled();
  });

  it('falls back to single PUT when chunked upload fails', async () => {
    const client = fakeClient();
    client.uploadChunked.mockRejectedValueOnce(new NetworkError(500, 'boom'));
    const s = new ChunkedUploadStrategy(uploadConfig({ uploadChunkThresholdMB: 0.0000001, maxFileSizeMB: 100 }));
    const outcome = await s.upload(client as unknown as IWebDAVClient, 'mid.bin', data);
    expect(outcome).toBe('uploaded');
    expect(client.uploadChunked).toHaveBeenCalledTimes(1);
    expect(client.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('[SPEC:CT-5] passes mtime and ctime to uploadChunked in the options', async () => {
    const client = fakeClient();
    const s = new ChunkedUploadStrategy(uploadConfig({ uploadChunkThresholdMB: 0.0000001, maxFileSizeMB: 100 }));
    await s.upload(client as unknown as IWebDAVClient, 'mid.bin', data, 1234, { ctime: 99, precomputedSha256: 'abc' });
    expect(client.uploadChunked).toHaveBeenCalledWith('mid.bin', data, 10 * 1024 * 1024, { ctime: 99, precomputedSha256: 'abc', mtime: 1234 });
  });

  it('[SPEC:CT-5] keeps ctime in the options when falling back to a single PUT', async () => {
    const client = fakeClient();
    client.uploadChunked.mockRejectedValueOnce(new NetworkError(500, 'boom'));
    const s = new ChunkedUploadStrategy(uploadConfig({ uploadChunkThresholdMB: 0.0000001, maxFileSizeMB: 100 }));
    await s.upload(client as unknown as IWebDAVClient, 'mid.bin', data, 1234, { ctime: 99 });
    expect(client.uploadFile).toHaveBeenCalledWith('mid.bin', data, 1234, { ctime: 99 });
  });

  it('[SPEC:CT-5] keeps ctime in the options for a single PUT below the threshold', async () => {
    const client = fakeClient();
    const s = new ChunkedUploadStrategy(uploadConfig({ uploadChunkThresholdMB: 100, maxFileSizeMB: 1000 }));
    await s.upload(client as unknown as IWebDAVClient, 'small.md', data, 1234, { ctime: 99 });
    expect(client.uploadFile).toHaveBeenCalledWith('small.md', data, 1234, { ctime: 99 });
  });
});
