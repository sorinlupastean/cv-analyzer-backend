import { Test, TestingModule } from '@nestjs/testing';
import { CvsController } from './cvs.controller';

describe('CvsController', () => {
  let controller: CvsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CvsController],
    }).compile();

    controller = module.get<CvsController>(CvsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
