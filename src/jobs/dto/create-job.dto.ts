import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  category: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  location?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  type: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  // ✅ nou: requirements (ce caută jobul)
  @IsString()
  @IsNotEmpty()
  requirements: string;

  // ✅ nou: status (implicit ACTIVE dacă nu trimiți)
  @IsOptional()
  @IsIn(['ACTIVE', 'CLOSED'])
  status?: 'ACTIVE' | 'CLOSED';
}
