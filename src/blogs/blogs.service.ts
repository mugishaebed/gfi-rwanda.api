import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { PrismaService } from '../prisma.service';
import { sanitizeBlogHtml } from './blog-html-sanitizer';
import { CreateBlogDto } from './dto/create-blog.dto';

type UploadedFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

type PreparedStoredFile = {
  storageDriver: string;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  absolutePath: string;
};

type SerializedBlogContent = {
  id: string;
  blogId: string;
  position: number;
  header: string | null;
  body: string;
  imageStorageDriver: string | null;
  imageStorageKey: string | null;
  imageOriginalFileName: string | null;
  imageMimeType: string | null;
  imageSize: number | null;
  createdAt: Date;
  updatedAt: Date;
  imageUrl: string | null;
};

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Injectable()
export class BlogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async create(data: CreateBlogDto, author: string) {
    const blogId = randomUUID();
    const preparedFiles: PreparedStoredFile[] = [];

    try {
      const preparedThumbnail = data.thumbnail
        ? await this.prepareImageFromDataUrl(
            blogId,
            ['thumbnail'],
            data.thumbnail,
            'thumbnail',
            preparedFiles,
          )
        : null;

      const preparedContentImages = await Promise.all(
        data.contents.map(async (content, index) => {
          if (!content.image) {
            return null;
          }

          return this.prepareImageFromDataUrl(
            blogId,
            ['contents', String(index + 1)],
            content.image,
            `content-${index + 1}`,
            preparedFiles,
          );
        }),
      );

      const blog = await this.prisma.blog.create({
        data: {
          id: blogId,
          title: data.title,
          shortDescription: data.shortDescription ?? null,
          author,
          thumbnailStorageDriver: preparedThumbnail?.storageDriver,
          thumbnailStorageKey: preparedThumbnail?.storageKey,
          thumbnailOriginalFileName: preparedThumbnail?.originalFileName,
          thumbnailMimeType: preparedThumbnail?.mimeType,
          thumbnailSize: preparedThumbnail?.size,
          contents: {
            create: data.contents.map((content, index) => ({
              position: index,
              header: content.header ?? null,
              body: sanitizeBlogHtml(content.body),
              imageStorageDriver: preparedContentImages[index]?.storageDriver,
              imageStorageKey: preparedContentImages[index]?.storageKey,
              imageOriginalFileName:
                preparedContentImages[index]?.originalFileName,
              imageMimeType: preparedContentImages[index]?.mimeType,
              imageSize: preparedContentImages[index]?.size,
            })),
          },
        },
        include: {
          contents: {
            orderBy: {
              position: 'asc',
            },
          },
        },
      });

      return this.serializeBlog(blog);
    } catch (error) {
      await this.cleanupPreparedFiles(preparedFiles);
      throw error;
    }
  }

  async findAll(page = 1, limit = 10) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const [blogs, total] = await Promise.all([
      this.prisma.blog.findMany({
        skip,
        take: safeLimit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          contents: {
            orderBy: {
              position: 'asc',
            },
          },
        },
      }),
      this.prisma.blog.count(),
    ]);

    return {
      data: blogs.map((blog) => this.serializeBlog(blog)),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async findOne(id: string) {
    const blog = await this.prisma.blog.findUnique({
      where: { id },
      include: {
        contents: {
          orderBy: {
            position: 'asc',
          },
        },
      },
    });

    if (!blog) {
      throw new NotFoundException('Blog not found');
    }

    return this.serializeBlog(blog);
  }

  async getThumbnailForDownload(id: string) {
    const blog = await this.prisma.blog.findUnique({ where: { id } });

    if (!blog) {
      throw new NotFoundException('Blog not found');
    }

    if (!blog.thumbnailStorageKey || !blog.thumbnailStorageDriver) {
      throw new NotFoundException('Thumbnail not found');
    }

    if (blog.thumbnailStorageDriver !== 'local') {
      throw new BadRequestException(
        'Only local thumbnails can be downloaded through this endpoint',
      );
    }

    return {
      stream: createReadStream(
        join(this.getStorageRoot(), blog.thumbnailStorageKey),
      ),
      mimeType: blog.thumbnailMimeType ?? 'application/octet-stream',
      originalFileName:
        blog.thumbnailOriginalFileName ?? basename(blog.thumbnailStorageKey),
    };
  }

  async getContentImageForDownload(blogId: string, contentId: string) {
    const content = await this.prisma.blogContent.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        blogId: true,
        imageStorageDriver: true,
        imageStorageKey: true,
        imageMimeType: true,
        imageOriginalFileName: true,
      },
    });

    if (!content || content.blogId !== blogId) {
      throw new NotFoundException('Blog content not found');
    }

    if (!content.imageStorageKey || !content.imageStorageDriver) {
      throw new NotFoundException('Content image not found');
    }

    if (content.imageStorageDriver !== 'local') {
      throw new BadRequestException(
        'Only local content images can be downloaded through this endpoint',
      );
    }

    return {
      stream: createReadStream(
        join(this.getStorageRoot(), content.imageStorageKey),
      ),
      mimeType: content.imageMimeType ?? 'application/octet-stream',
      originalFileName:
        content.imageOriginalFileName ?? basename(content.imageStorageKey),
    };
  }

  private async prepareImageFromDataUrl(
    blogId: string,
    pathSegments: string[],
    dataUrl: string,
    fallbackFileName: string,
    cleanupBucket: PreparedStoredFile[],
  ) {
    const uploadedFile = this.decodeImageDataUrl(dataUrl, fallbackFileName);
    const prepared = await this.prepareStoredFile(
      blogId,
      pathSegments,
      uploadedFile,
    );
    cleanupBucket.push(prepared);
    return prepared;
  }

  private decodeImageDataUrl(
    dataUrl: string,
    fallbackFileName: string,
  ): UploadedFile {
    const match = dataUrl.match(
      /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i,
    );

    if (!match) {
      throw new BadRequestException(
        'Images must be base64 data URLs using JPEG, PNG, or WEBP MIME type',
      );
    }

    const mimeType = match[1].toLowerCase();
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        'Only JPEG, PNG, and WEBP images are allowed',
      );
    }

    const base64Data = match[2].replace(/\s+/g, '');
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length === 0) {
      throw new BadRequestException('Provided image data is empty');
    }

    const maxFileSizeBytes = this.getBlogImageMaxFileSizeBytes();
    if (buffer.length > maxFileSizeBytes) {
      throw new BadRequestException(
        `Image exceeds max size of ${maxFileSizeBytes} bytes`,
      );
    }

    const extension = MIME_EXTENSION_MAP[mimeType] ?? '';

    return {
      buffer,
      originalname: `${fallbackFileName}${extension}`,
      mimetype: mimeType,
      size: buffer.length,
    };
  }

  private async prepareStoredFile(
    blogId: string,
    pathSegments: string[],
    file: UploadedFile,
  ): Promise<PreparedStoredFile> {
    const storageDriver =
      this.configService.get<string>('DOCUMENT_STORAGE_DRIVER') ?? 'local';

    if (storageDriver !== 'local') {
      throw new BadRequestException(
        `Unsupported DOCUMENT_STORAGE_DRIVER "${storageDriver}". Currently only "local" is implemented.`,
      );
    }

    const rootPath = this.getStorageRoot();
    const extension = extname(file.originalname) || '';
    const storageKey = join(
      'blogs',
      blogId,
      ...pathSegments,
      `${randomUUID()}${extension}`,
    );
    const absolutePath = join(rootPath, storageKey);

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer);

    return {
      storageDriver,
      storageKey,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      absolutePath,
    };
  }

  private async cleanupPreparedFiles(preparedFiles: PreparedStoredFile[]) {
    await Promise.all(
      preparedFiles.map((file) => rm(file.absolutePath, { force: true })),
    );
  }

  private serializeBlog(blog: {
    id: string;
    title: string;
    shortDescription: string | null;
    author: string;
    thumbnailStorageDriver: string | null;
    thumbnailStorageKey: string | null;
    thumbnailOriginalFileName: string | null;
    thumbnailMimeType: string | null;
    thumbnailSize: number | null;
    createdAt: Date;
    updatedAt: Date;
    contents: Array<{
      id: string;
      blogId: string;
      position: number;
      header: string | null;
      body: string;
      imageStorageDriver: string | null;
      imageStorageKey: string | null;
      imageOriginalFileName: string | null;
      imageMimeType: string | null;
      imageSize: number | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }) {
    const publicBaseUrl = this.configService
      .get<string>('DOCUMENT_STORAGE_PUBLIC_BASE_URL')
      ?.replace(/\/$/, '');
    const baseUrl = publicBaseUrl ?? '/v1';

    return {
      ...blog,
      thumbnailUrl: this.toAssetUrl(publicBaseUrl, blog.thumbnailStorageKey, [
        'blogs',
        blog.id,
        'thumbnail',
      ]),
      contents: [...blog.contents]
        .sort((a, b) => a.position - b.position)
        .map(
          (content): SerializedBlogContent => ({
            ...content,
            imageUrl: content.imageStorageKey
              ? `${baseUrl}/blogs/${blog.id}/contents/${content.id}/image`
              : null,
          }),
        ),
    };
  }

  private toAssetUrl(
    publicBaseUrl: string | undefined,
    storageKey: string | null,
    fallbackPathParts: string[],
  ) {
    if (!storageKey) {
      return null;
    }

    if (publicBaseUrl) {
      return `${publicBaseUrl}/${storageKey.replace(/\\/g, '/')}`;
    }

    return `/v1/${fallbackPathParts.join('/')}`;
  }

  private getBlogImageMaxFileSizeBytes() {
    return Number(
      this.configService.get<string>('BLOG_IMAGE_MAX_FILE_SIZE_BYTES') ??
        5 * 1024 * 1024,
    );
  }

  private getStorageRoot() {
    return (
      this.configService.get<string>('DOCUMENT_STORAGE_ROOT') ??
      join(process.cwd(), 'storage')
    );
  }
}
