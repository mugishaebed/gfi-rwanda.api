import { BadRequestException } from '@nestjs/common';

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const createDocumentUploadOptions = (maxFileSizeBytes: number) => ({
  limits: {
    fileSize: maxFileSizeBytes,
    files: 10,
  },
  fileFilter: (
    _req: unknown,
    file: { mimetype: string },
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype as never)) {
      callback(null, true);
      return;
    }

    callback(
      new BadRequestException(
        'Only PDF, JPEG, PNG, and WEBP documents are allowed',
      ) as unknown as Error,
      false,
    );
  },
});
