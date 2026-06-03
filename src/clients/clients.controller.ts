import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  Post,
  Query,
  ParseIntPipe,
  ParseEnumPipe,
  Req,
  Put,
  UploadedFiles,
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
import { FilesInterceptor } from '@nestjs/platform-express';
import { ClientsService } from './clients.service';
import { ClientSourceFilter } from './clients.service';
import {
  CreateIndividualClientDto,
  CreateBusinessClientDto,
} from './dto/create.dto';
import {
  UpdateBusinessClientDto,
  UpdateIndividualClientDto,
} from './dto/update.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { createDocumentUploadOptions } from '../documents/document-upload';

type AuthenticatedRequest = {
  user: {
    userId: string;
    email: string;
  };
};

@ApiTags('Clients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Roles('LOAN_OFFICER', 'GENERAL_MANAGER')
  @Get()
  @ApiOperation({
    summary: 'Retrieve clients with pagination',
    description: 'Returns a paginated list of individual and business clients.',
  })
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
  @ApiQuery({
    name: 'source',
    enum: ClientSourceFilter,
    required: false,
    description: 'Optional client source filter.',
  })
  getClients(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query(
      'source',
      new DefaultValuePipe(ClientSourceFilter.ALL),
      new ParseEnumPipe(ClientSourceFilter),
    )
    source: ClientSourceFilter,
  ) {
    return this.clientsService.getClients(page, limit, source);
  }

  @Roles('LOAN_OFFICER')
  @Get('pending-approval')
  @ApiOperation({
    summary: 'Retrieve client profiles pending loan officer approval',
    description:
      'Returns completed client profiles whose linked client account is waiting for approval.',
  })
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
  getPendingApprovalClients(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.clientsService.getPendingApprovalClients(page, limit);
  }

  @Roles('CLIENT')
  @Get('me/profile')
  @ApiOperation({
    summary: 'Retrieve current client user profile',
    description:
      'Returns the authenticated client user fields and the matching client profile when it has been completed.',
  })
  getMyProfile(@Req() req: AuthenticatedRequest) {
    return this.clientsService.getMyProfile(req.user.userId);
  }

  @Roles('LOAN_OFFICER', 'GENERAL_MANAGER')
  @Get(':id')
  @ApiOperation({
    summary: 'Retrieve a single client profile',
    description:
      'Returns a client profile by id, including individual or business details and uploaded documents.',
  })
  getClientById(@Param('id') id: string) {
    return this.clientsService.getClientById(id);
  }

  @Roles('LOAN_OFFICER')
  @Post('individual')
  @UseInterceptors(
    FilesInterceptor(
      'documents',
      10,
      createDocumentUploadOptions(10 * 1024 * 1024),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create an individual client' })
  createIndividualClient(
    @Body() dto: CreateIndividualClientDto,
    @UploadedFiles()
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.clientsService.createIndividualClient(
      dto,
      files,
      req.user.userId,
    );
  }

  @Roles('LOAN_OFFICER')
  @Post('business')
  @UseInterceptors(
    FilesInterceptor(
      'documents',
      10,
      createDocumentUploadOptions(10 * 1024 * 1024),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create a business client' })
  createBusinessClient(
    @Body() dto: CreateBusinessClientDto,
    @UploadedFiles()
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.clientsService.createBusinessClient(
      dto,
      files,
      req.user.userId,
    );
  }

  @Roles('LOAN_OFFICER')
  @Put('individual/:id')
  @ApiOperation({ summary: 'Update an individual client' })
  updateIndividualClient(
    @Param('id') id: string,
    @Body() dto: UpdateIndividualClientDto,
  ) {
    return this.clientsService.updateIndividualClient(id, dto);
  }

  @Roles('LOAN_OFFICER')
  @Put('business/:id')
  @ApiOperation({ summary: 'Update a business client' })
  updateBusinessClient(
    @Param('id') id: string,
    @Body() dto: UpdateBusinessClientDto,
  ) {
    return this.clientsService.updateBusinessClient(id, dto);
  }

  @Roles('LOAN_OFFICER')
  @Delete('individual/:id')
  @ApiOperation({ summary: 'Delete an individual client' })
  deleteIndividualClient(@Param('id') id: string) {
    return this.clientsService.deleteIndividualClient(id);
  }

  @Roles('LOAN_OFFICER')
  @Delete('business/:id')
  @ApiOperation({ summary: 'Delete a business client' })
  deleteBusinessClient(@Param('id') id: string) {
    return this.clientsService.deleteBusinessClient(id);
  }

  @Roles('CLIENT')
  @Post('me/complete-profile/individual')
  @UseInterceptors(
    FilesInterceptor(
      'documents',
      10,
      createDocumentUploadOptions(10 * 1024 * 1024),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Complete current client individual profile and move account to pending approval',
  })
  completeMyIndividualProfile(
    @Body() dto: CreateIndividualClientDto,
    @UploadedFiles()
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.clientsService.completeMyIndividualProfile(
      req.user.userId,
      req.user.email,
      dto,
      files,
    );
  }

  @Roles('CLIENT')
  @Post('me/complete-profile/business')
  @UseInterceptors(
    FilesInterceptor(
      'documents',
      10,
      createDocumentUploadOptions(10 * 1024 * 1024),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Complete current client business profile and move account to pending approval',
  })
  completeMyBusinessProfile(
    @Body() dto: CreateBusinessClientDto,
    @UploadedFiles()
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.clientsService.completeMyBusinessProfile(
      req.user.userId,
      req.user.email,
      dto,
      files,
    );
  }

  @Roles('LOAN_OFFICER')
  @Put(':id/approve-profile')
  @ApiOperation({ summary: 'Approve a pending client profile' })
  approveClientProfile(@Param('id') id: string) {
    return this.clientsService.approveClientProfile(id);
  }
}
