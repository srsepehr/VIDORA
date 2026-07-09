export interface UploadObjectInput {
  bucket: string;
  key: string;
  file: File;
  contentType: string;
}

export interface StoredObject {
  bucket: string;
  key: string;
}

export interface VidoraStorageAdapter {
  createUpload(input: UploadObjectInput): Promise<StoredObject>;
  getPublicUrl(bucket: string, key: string): string;
}

export class StorageNotConfiguredAdapter implements VidoraStorageAdapter {
  async createUpload(): Promise<StoredObject> {
    throw new Error("Storage upload adapter is not wired in this frontend-only phase.");
  }

  getPublicUrl(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }
}
