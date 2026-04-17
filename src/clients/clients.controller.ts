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
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import {
  CreateIndividualClientDto,
  CreateBusinessClientDto,
} from './dto/create.dto';
import {
  UpdateBusinessClientDto,
  UpdateIndividualClientDto,
} from './dto/update.dto';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

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
  getClients(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.clientsService.getClients(page, limit);
  }

  @Roles('LOAN_OFFICER')
  @Post('individual')
  @ApiOperation({ summary: 'Create an individual client' })
  createIndividualClient(@Body() dto: CreateIndividualClientDto) {
    return this.clientsService.createIndividualClient(dto);
  }

  @Roles('LOAN_OFFICER')
  @Post('business')
  @ApiOperation({ summary: 'Create a business client' })
  createBusinessClient(@Body() dto: CreateBusinessClientDto) {
    return this.clientsService.createBusinessClient(dto);
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
}
