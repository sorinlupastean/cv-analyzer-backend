import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

export class CreateInterviewDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  cvId?: number;

  @IsString()
  candidateName!: string;

  @IsEmail()
  candidateEmail!: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsUrl()
  meetLink?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsOptional()
  @IsIn(['SCHEDULED', 'CONFIRMED', 'CANCELLED'])
  status?: 'SCHEDULED' | 'CONFIRMED' | 'CANCELLED';
}
