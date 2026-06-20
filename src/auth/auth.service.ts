import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async register(data: any) {
    const email = data.email?.trim().toLowerCase();
    if (await this.usersService.isEmailDeleted(email)) {
      throw new ConflictException('Acest cont a fost șters și nu mai poate fi recreat');
    }
    const existingUser = await this.usersService.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('Există deja un cont cu acest email');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    return this.usersService.create({
      email,
      password: hashedPassword,
      firstName: data.firstName?.trim(),
      lastName: data.lastName?.trim(),
    });
  }

  async login(email: string, password: string) {
    const normalizedEmail = email?.trim().toLowerCase();
    if (await this.usersService.isEmailDeleted(normalizedEmail)) {
      throw new UnauthorizedException('Contul a fost șters');
    }
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user || !user.password) {
      throw new UnauthorizedException('Email sau parolă incorectă');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Email sau parolă incorectă');
    }

    const payload = { sub: user.id, email: user.email };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async validateOAuthLogin(profile: any): Promise<string> {
    const email = profile.email?.trim().toLowerCase();
    const { firstName, lastName } = profile;

    let user = await this.usersService.findByEmail(email);

    if (!user) {
      user = await this.usersService.create({
        email,
        firstName,
        lastName,
        provider: 'google',
      });
    }

    const payload = { sub: user.id, email: user.email };

    return this.jwtService.sign(payload);
  }
}



