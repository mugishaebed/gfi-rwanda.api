jest.mock('../prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { BlogsService } from './blogs.service';

describe('BlogsService', () => {
  let service: BlogsService;
  let prisma: {
    blog: {
      findUnique: jest.Mock;
    };
  };
  let configService: {
    get: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      blog: {
        findUnique: jest.fn(),
      },
    };
    configService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<BlogsService>(BlogsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('serializes content image URLs through the content image endpoint', async () => {
    const now = new Date('2026-05-04T10:00:00.000Z');

    configService.get.mockImplementation((key: string) => {
      if (key === 'DOCUMENT_STORAGE_PUBLIC_BASE_URL') {
        return 'https://api.example.com/v1/';
      }

      return undefined;
    });
    prisma.blog.findUnique.mockResolvedValue({
      id: 'blog-1',
      title: 'Blog title',
      shortDescription: null,
      author: 'author@example.com',
      thumbnailStorageDriver: null,
      thumbnailStorageKey: null,
      thumbnailOriginalFileName: null,
      thumbnailMimeType: null,
      thumbnailSize: null,
      createdAt: now,
      updatedAt: now,
      contents: [
        {
          id: 'content-with-image',
          blogId: 'blog-1',
          position: 2,
          header: null,
          body: '<p>With image</p>',
          imageStorageDriver: 'local',
          imageStorageKey: 'blogs/blog-1/contents/2/generated-file.png',
          imageOriginalFileName: 'generated-file.png',
          imageMimeType: 'image/png',
          imageSize: 512,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'content-without-image',
          blogId: 'blog-1',
          position: 1,
          header: null,
          body: '<p>Without image</p>',
          imageStorageDriver: null,
          imageStorageKey: null,
          imageOriginalFileName: null,
          imageMimeType: null,
          imageSize: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    const result = await service.findOne('blog-1');

    expect(result.contents).toEqual([
      expect.objectContaining({
        id: 'content-without-image',
        imageUrl: null,
      }),
      expect.objectContaining({
        id: 'content-with-image',
        imageUrl:
          'https://api.example.com/v1/blogs/blog-1/contents/content-with-image/image',
      }),
    ]);
    expect(result.contents[1].imageUrl).not.toContain(
      'contents/2/generated-file.png',
    );
  });
});
