import { Test, TestingModule } from '@nestjs/testing';
import { MsalAuthService } from './msal-auth.service';

describe('AuthService', () => {
  let service: MsalAuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MsalAuthService],
    }).compile();

    service = module.get<MsalAuthService>(MsalAuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
