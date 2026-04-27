import { BadRequestException } from '@nestjs/common';

export const ALLOWED_BLOG_THUMBNAIL_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const createBlogThumbnailUploadOptions = (maxFileSizeBytes: number) => ({
  limits: {
    fileSize: maxFileSizeBytes,
    files: 1,
  },
  fileFilter: (
    _req: unknown,
    file: { mimetype: string },
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (ALLOWED_BLOG_THUMBNAIL_MIME_TYPES.includes(file.mimetype as never)) {
      callback(null, true);
      return;
    }

    callback(
      new BadRequestException(
        'Only JPEG, PNG, and WEBP thumbnails are allowed',
      ) as unknown as Error,
      false,
    );
  },
});
