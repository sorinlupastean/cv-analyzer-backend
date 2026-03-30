import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  // DataURL: "data:image/...;base64,...."
  @IsOptional()
  @IsString()
  @MaxLength(5_000_000) // aprox, ca să nu explodeze DB
  @Matches(/^data:image\/(png|jpeg|jpg|webp);base64,/i, {
    message: 'avatarDataUrl must be a valid image data url',
  })
  avatarUrl?: string;
}
