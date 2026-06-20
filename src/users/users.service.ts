import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { DeletedAccount } from './entities/deleted-account.entity';
import { Cv } from '../cvs/entities/cv.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(DeletedAccount)
    private readonly deletedAccountRepository: Repository<DeletedAccount>,
    @InjectRepository(Cv)
    private readonly cvRepository: Repository<Cv>,
  ) {}

  findByEmail(email: string) {
    return this.userRepository.findOne({ where: { email } });
  }

  findById(id: number) {
    return this.userRepository.findOne({ where: { id } });
  }

  create(user: Partial<User>) {
    const newUser = this.userRepository.create(user);
    return this.userRepository.save(newUser);
  }

  async isEmailDeleted(email: string) {
    const normalized = email?.trim().toLowerCase();
    if (!normalized) return false;

    const deleted = await this.deletedAccountRepository.findOne({
      where: { email: normalized },
    });

    return Boolean(deleted);
  }

  async markEmailDeleted(email: string) {
    const normalized = email?.trim().toLowerCase();
    if (!normalized) return;

    const existing = await this.deletedAccountRepository.findOne({
      where: { email: normalized },
    });

    if (existing) return;

    await this.deletedAccountRepository.save(
      this.deletedAccountRepository.create({ email: normalized }),
    );
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (dto.email !== undefined) user.email = dto.email.trim();
    if (dto.firstName !== undefined) user.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) user.lastName = dto.lastName.trim();

    if (dto.phone !== undefined) user.phone = dto.phone.trim() || null;
    if (dto.location !== undefined) user.location = dto.location.trim() || null;
    if (dto.role !== undefined) user.role = dto.role.trim() || null;
    if (dto.website !== undefined) user.website = dto.website.trim() || null;
    if (dto.bio !== undefined) user.bio = dto.bio || null;

    return this.userRepository.save(user);
  }

  async updateAvatar(userId: number, avatarUrl: string) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (user.avatarUrl) {
      const oldPath = path.join(
        process.cwd(),
        user.avatarUrl.replace(/^\/+/, ''),
      );

      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {}
      }
    }

    user.avatarUrl = avatarUrl;
    return this.userRepository.save(user);
  }

  async clearAvatar(userId: number) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (user.avatarUrl) {
      const oldPath = path.join(
        process.cwd(),
        user.avatarUrl.replace(/^\/+/, ''),
      );

      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {}
      }
    }

    user.avatarUrl = null;
    return this.userRepository.save(user);
  }

  async deleteAccount(userId: number) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const ownedCvs = await this.cvRepository.find({
      where: { owner: { id: userId } },
    });
    for (const cv of ownedCvs) {
      this.removeFileIfExists(cv.filePath);
    }

    if (user.avatarUrl) {
      this.removeFileIfExists(
        path.join(process.cwd(), user.avatarUrl.replace(/^\/+/, '')),
      );
    }

    await this.markEmailDeleted(user.email);
    await this.userRepository.remove(user);

    return { ok: true as const };
  }

  toSafeUser(u: User) {
    const { password, ...rest } = u as any;
    return rest;
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Parola curentă este greșită');
    }

    const sameAsOld = await bcrypt.compare(newPassword, user.password);
    if (sameAsOld) {
      throw new BadRequestException('Noua parolă trebuie să fie diferită');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await this.userRepository.save(user);

    return { message: 'Password updated successfully' };
  }

  private removeFileIfExists(filePath?: string | null) {
    if (!filePath) return;

    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath.replace(/^\/+/, ''));

    if (fs.existsSync(resolved)) {
      try {
        fs.unlinkSync(resolved);
      } catch {}
    }
  }
}
