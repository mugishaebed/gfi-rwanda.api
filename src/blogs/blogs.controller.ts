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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { Readable } from 'stream';
// import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { createBlogThumbnailUploadOptions } from './blog-upload';
import { BlogsService } from './blogs.service';
import { CreateBlogDto } from './dto/create-blog.dto';

type AuthenticatedRequest = {
  user: {
    userId: string;
    email: string;
    role: string;
  };
};

type File = {
  stream: Readable;
  mimeType: string;
  originalFileName: string;
};

@ApiTags('Blogs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('blogs')
export class BlogsController {
  constructor(private readonly blogsService: BlogsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor(
      'thumbnail',
      createBlogThumbnailUploadOptions(5 * 1024 * 1024),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create a blog post with rich HTML content and optional thumbnail',
  })
  create(
    @Body() dto: CreateBlogDto,
    @UploadedFile()
    thumbnail?: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    @Req() req?: AuthenticatedRequest,
  ) {
    return this.blogsService.create(
      dto,
      req?.user.email ?? 'Unknown',
      thumbnail,
    );
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
}
