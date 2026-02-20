import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class SendEmailDto {
  @IsEmail()
  @IsNotEmpty()
  to!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  subject!: string;

  @ValidateIf((o) => !o.html)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  text?: string;

  @ValidateIf((o) => !o.text)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  html?: string;
}
