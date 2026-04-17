import { PartialType } from '@nestjs/swagger';
import {
  CreateBusinessClientDto,
  CreateIndividualClientDto,
} from './create.dto';

export class UpdateIndividualClientDto extends PartialType(
  CreateIndividualClientDto,
) {}

export class UpdateBusinessClientDto extends PartialType(
  CreateBusinessClientDto,
) {}
