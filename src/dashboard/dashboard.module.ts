import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Cv } from '../cvs/entities/cv.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Cv])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
