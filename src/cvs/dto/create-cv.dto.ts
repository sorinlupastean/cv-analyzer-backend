import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateCvDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  candidateName: string;

  @IsDateString()
  uploadDate: string;

  @IsInt()
  @Min(0)
  @Max(100)
  matchScore: number;

  @IsString()
  @IsNotEmpty()
  status: string;

  @IsArray()
  @IsString({ each: true })
  skills: string[];
}
