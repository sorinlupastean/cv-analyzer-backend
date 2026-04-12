import { IsOptional, IsString } from 'class-validator';

export class AnalyzeCandidateDto {
  @IsString()
  jobText!: string;

  @IsOptional()
  @IsString()
  githubUsernameOrUrl?: string;
}
