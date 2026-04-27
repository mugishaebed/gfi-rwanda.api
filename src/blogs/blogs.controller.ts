import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { Readable } from 'stream';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateBlogDto } from './dto/create-blog.dto';
import { BlogsService } from './blogs.service';

type AuthenticatedRequest = {
  user: {
    userId: string;
    email: string;
    roles: string[];
  };
};

type File = {
  stream: Readable;
  mimeType: string;
  originalFileName: string;
};

@ApiTags('Blogs')
@Controller('blogs')
export class BlogsController {
  constructor(private readonly blogsService: BlogsService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BLOG_EDITOR')
  @ApiBody({
    description:
      'Create a blog using ordered content chunks. Thumbnail and chunk images are optional base64 data URLs.',
    schema: {
      type: 'object',
      required: ['title', 'contents'],
      properties: {
        title: {
          type: 'string',
          maxLength: 200,
          example: 'How We Disburse Loans Faster in 2026',
        },
        thumbnail: {
          type: 'string',
          description: 'Optional base64 data URL cover image (JPEG/PNG/WEBP).',
          example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
        },
        contents: {
          type: 'array',
          items: {
            type: 'object',
            required: ['body'],
            properties: {
              header: {
                type: 'string',
                maxLength: 200,
                example: 'Introduction',
              },
              body: {
                type: 'string',
                description: 'HTML body for this chunk.',
                example:
                  '<p style="font-family:Poppins;font-size:16px">Styled paragraph body.</p>',
              },
              image: {
                type: 'string',
                description:
                  'Optional base64 data URL chunk image (JPEG/PNG/WEBP).',
                example: 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4...',
              },
            },
          },
        },
      },
    },
  })
  @ApiOperation({
    summary:
      'Create a blog post with ordered HTML chunks and optional local images',
  })
  create(@Body() dto: CreateBlogDto, @Req() req?: AuthenticatedRequest) {
    return this.blogsService.create(dto, req?.user.email ?? 'Unknown');
  }

  @Get()
  @ApiOperation({ summary: 'Retrieve blogs with pagination' })
  @ApiQuery({
    name: 'page',
    required: false,
    example: 1,
    description: 'Page number to retrieve.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 10,
    description: 'Maximum number of records per page.',
  })
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.blogsService.findAll(page, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a single blog' })
  findOne(@Param('id') id: string) {
    return this.blogsService.findOne(id);
  }

  @Get(':id/thumbnail')
  @ApiOperation({ summary: 'Download a blog thumbnail' })
  async downloadThumbnail(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file: File = await this.blogsService.getThumbnailForDownload(id);

    response.setHeader('Content-Type', file.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${file.originalFileName}"`,
    );

    return new StreamableFile(file.stream);
  }

  @Get(':id/contents/:contentId/image')
  @ApiOperation({
    summary: 'Download an image attached to a blog content chunk',
  })
  async downloadContentImage(
    @Param('id') id: string,
    @Param('contentId') contentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file: File = await this.blogsService.getContentImageForDownload(
      id,
      contentId,
    );

    response.setHeader('Content-Type', file.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${file.originalFileName}"`,
    );

    return new StreamableFile(file.stream);
  }
}
