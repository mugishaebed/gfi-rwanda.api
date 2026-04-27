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
import { CreateBlogDto } from './dto/create-blog.dto';
import { sanitizeBlogHtml } from './blog-html-sanitizer';

type UploadedFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

@Injectable()
export class BlogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async create(data: CreateBlogDto, author: string, thumbnail?: UploadedFile) {
    const sanitizedContent = sanitizeBlogHtml(data.content);

    const blogId = randomUUID();
    const preparedThumbnail = thumbnail
      ? await this.prepareThumbnail(blogId, thumbnail)
      : null;

    try {
      const blog = await this.prisma.blog.create({
        data: {
          id: blogId,
          title: data.title,
          content: sanitizedContent,
          author,
          thumbnailStorageDriver: preparedThumbnail?.storageDriver,
          thumbnailStorageKey: preparedThumbnail?.storageKey,
          thumbnailOriginalFileName: preparedThumbnail?.originalFileName,
          thumbnailMimeType: preparedThumbnail?.mimeType,
          thumbnailSize: preparedThumbnail?.size,
        },
      });

      return this.serializeBlog(blog);
    } catch (error) {
      if (preparedThumbnail) {
        await rm(preparedThumbnail.absolutePath, { force: true });
      }

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
    const blog = await this.prisma.blog.findUnique({ where: { id } });

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

  private async prepareThumbnail(blogId: string, thumbnail: UploadedFile) {
    const storageDriver =
      this.configService.get<string>('DOCUMENT_STORAGE_DRIVER') ?? 'local';

    if (storageDriver !== 'local') {
      throw new BadRequestException(
        `Unsupported DOCUMENT_STORAGE_DRIVER "${storageDriver}". Currently only "local" is implemented.`,
      );
    }

    const rootPath = this.getStorageRoot();
    const extension = extname(thumbnail.originalname) || '';
    const storageKey = join('blogs', blogId, `${randomUUID()}${extension}`);
    const absolutePath = join(rootPath, storageKey);

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, thumbnail.buffer);

    return {
      storageDriver,
      storageKey,
      originalFileName: thumbnail.originalname,
      mimeType: thumbnail.mimetype,
      size: thumbnail.size,
      absolutePath,
    };
  }

  private serializeBlog(blog: {
    id: string;
    title: string;
    content: string;
    author: string;
    thumbnailStorageDriver: string | null;
    thumbnailStorageKey: string | null;
    thumbnailOriginalFileName: string | null;
    thumbnailMimeType: string | null;
    thumbnailSize: number | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const publicBaseUrl = this.configService
      .get<string>('DOCUMENT_STORAGE_PUBLIC_BASE_URL')
      ?.replace(/\/$/, '');

    return {
      ...blog,
      thumbnailUrl: blog.thumbnailStorageKey
        ? publicBaseUrl
          ? `${publicBaseUrl}/${blog.thumbnailStorageKey.replace(/\\/g, '/')}`
          : `/blogs/${blog.id}/thumbnail`
        : null,
    };
  }

  private getStorageRoot() {
    return (
      this.configService.get<string>('DOCUMENT_STORAGE_ROOT') ??
      join(process.cwd(), 'storage')
    );
  }
}
