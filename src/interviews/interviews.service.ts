import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { InterviewEvent } from './entities/interview-event.entity';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { UpdateInterviewDto } from './dto/update-interview.dto';
import { MailService } from '../mail/mail.service';
import type { DeepPartial } from 'typeorm';
import type { InterviewStatus } from './entities/interview-event.entity';

@Injectable()
export class InterviewsService {
  constructor(
    @InjectRepository(InterviewEvent)
    private readonly repo: Repository<InterviewEvent>,
    private readonly mail: MailService,
  ) {}

  async list(fromIso: string, toIso: string) {
    const from = new Date(fromIso);
    const to = new Date(toIso);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Interval invalid.');
    }

    return this.repo.find({
      where: {
        startAt: Between(from, to),
      },
      order: { startAt: 'ASC' },
    });
  }

  async create(dto: CreateInterviewDto) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Dată sau oră invalidă.');
    }
    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException(
        'Ora de final trebuie să fie după ora de start.',
      );
    }

    // Conflict check: evită suprapuneri
    const overlap = await this.repo
      .createQueryBuilder('e')
      .where('e.status != :cancelled', { cancelled: 'CANCELLED' })
      .andWhere('e.startAt < :endAt AND e.endAt > :startAt', { startAt, endAt })
      .getCount();

    if (overlap > 0) {
      throw new BadRequestException(
        'Există deja o programare care se suprapune cu intervalul ales.',
      );
    }

    const confirmToken = randomBytes(24).toString('hex');
    const cancelToken = randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 48); // 48h

    const entity = this.repo.create({
      title: dto.title.trim(),
      cvId: dto.cvId ?? null,
      candidateName: dto.candidateName.trim(),
      candidateEmail: dto.candidateEmail.trim(),
      location: dto.location?.trim() ?? null,
      meetLink: dto.meetLink?.trim() ?? null,
      notes: dto.notes?.trim() ?? null,
      startAt,
      endAt,
      status: (dto.status ?? 'SCHEDULED') as InterviewStatus,
      confirmToken,
      confirmTokenExpiresAt: expires,
      cancelToken,
    } satisfies DeepPartial<InterviewEvent>);

    const saved = await this.repo.save(entity); // acum e InterviewEvent, nu InterviewEvent[]
    await this.sendCandidateInvite(saved);
    return saved;
  }

  async update(id: number, dto: UpdateInterviewDto) {
    const ev = await this.repo.findOne({ where: { id } });
    if (!ev) throw new NotFoundException('Programarea nu există.');

    if (ev.status === 'CANCELLED') {
      throw new BadRequestException('Nu poți edita o programare anulată.');
    }

    const startAt = dto.startAt ? new Date(dto.startAt) : ev.startAt;
    const endAt = dto.endAt ? new Date(dto.endAt) : ev.endAt;

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Dată sau oră invalidă.');
    }
    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException(
        'Ora de final trebuie să fie după ora de start.',
      );
    }

    // Conflict check (exclude current id)
    const overlap = await this.repo
      .createQueryBuilder('e')
      .where('e.id != :id', { id })
      .andWhere('e.status != :cancelled', { cancelled: 'CANCELLED' })
      .andWhere('e.startAt < :endAt AND e.endAt > :startAt', { startAt, endAt })
      .getCount();

    if (overlap > 0) {
      throw new BadRequestException(
        'Există deja o programare care se suprapune cu intervalul ales.',
      );
    }

    Object.assign(ev, {
      title: dto.title?.trim() ?? ev.title,
      cvId: dto.cvId ?? ev.cvId,
      candidateName: dto.candidateName?.trim() ?? ev.candidateName,
      candidateEmail: dto.candidateEmail?.trim() ?? ev.candidateEmail,
      location: dto.location?.trim() ?? ev.location,
      meetLink: dto.meetLink?.trim() ?? ev.meetLink,
      notes: dto.notes?.trim() ?? ev.notes,
      startAt,
      endAt,
    });

    const saved = await this.repo.save(ev);

    // Opțional: dacă schimbi ora sau email-ul, poți retrimite invitația
    // await this.sendCandidateInvite(saved);

    return saved;
  }

  async cancel(id: number, reason?: string) {
    const ev = await this.repo.findOne({ where: { id } });
    if (!ev) throw new NotFoundException('Programarea nu există.');

    if (ev.status === 'CANCELLED') return ev;

    ev.status = 'CANCELLED';
    ev.cancelledAt = new Date();
    ev.notes = reason
      ? `${ev.notes || ''}\n\n[Cancel reason] ${reason}`.trim()
      : ev.notes;

    const saved = await this.repo.save(ev);

    // opțional: email de anulare către candidat
    await this.sendCandidateCancellation(saved);

    return saved;
  }

  async confirmByToken(token: string) {
    const ev = await this.repo.findOne({ where: { confirmToken: token } });
    if (!ev) throw new NotFoundException('Token invalid sau deja folosit.');

    if (ev.status === 'CANCELLED') {
      throw new BadRequestException('Programarea este anulată.');
    }

    if (ev.status === 'CONFIRMED') return ev;

    if (
      !ev.confirmTokenExpiresAt ||
      ev.confirmTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('Token expirat.');
    }

    ev.status = 'CONFIRMED';
    ev.confirmedAt = new Date();

    return this.repo.save(ev);
  }

  async cancelByToken(token: string) {
    const ev = await this.repo.findOne({ where: { cancelToken: token } });
    if (!ev) throw new NotFoundException('Token invalid sau deja folosit.');

    // dacă e deja anulată, returnează ok (idempotent)
    if (ev.status === 'CANCELLED') return ev;

    ev.status = 'CANCELLED';
    ev.cancelledAt = new Date();

    return this.repo.save(ev);
  }

  private async sendCandidateInvite(ev: InterviewEvent) {
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const confirmUrl = `${appUrl}/interview/confirm?token=${ev.confirmToken}`;
    const cancelUrl = `${appUrl}/interview/cancel?token=${ev.cancelToken}`;

    const when = ev.startAt.toLocaleString('ro-RO', {
      dateStyle: 'full',
      timeStyle: 'short',
    });
    const durationMin = Math.round(
      (ev.endAt.getTime() - ev.startAt.getTime()) / 60000,
    );

    const html = `
  <div style="font-family: Arial, sans-serif; line-height:1.5;">
    <h2 style="margin:0 0 8px;">Programare interviu</h2>
    <p>Bună, ${escapeHtml(ev.candidateName)},</p>
    <p>Ai fost programat la: <b>${escapeHtml(when)}</b> (${durationMin} min).</p>
    <p><b>Titlu:</b> ${escapeHtml(ev.title)}</p>
    ${ev.location ? `<p><b>Locație:</b> ${escapeHtml(ev.location)}</p>` : ''}
    ${ev.meetLink ? `<p><b>Link:</b> <a href="${ev.meetLink}">${ev.meetLink}</a></p>` : ''}

    <div style="margin-top:18px;">
      <a href="${confirmUrl}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#3b7f9b;color:#fff;text-decoration:none;font-weight:700;margin-right:10px;">
        Confirmă programarea
      </a>
      <a href="${cancelUrl}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#ef4444;color:#fff;text-decoration:none;font-weight:700;">
        Anulează
      </a>
    </div>

    <p style="margin-top:16px;color:#64748b;font-size:12px;">
      Linkurile sunt valabile 48 ore.
    </p>
  </div>
`;

    await this.mail.send({
      to: ev.candidateEmail,
      subject: `Confirmare interviu: ${ev.title}`,
      text: `Ai o programare la ${when}. Confirmă: ${confirmUrl}`,
      html,
    });
  }

  private async sendCandidateCancellation(ev: InterviewEvent) {
    const when = ev.startAt.toLocaleString('ro-RO', {
      dateStyle: 'full',
      timeStyle: 'short',
    });

    await this.mail.send({
      to: ev.candidateEmail,
      subject: `Anulare interviu: ${ev.title}`,
      text: `Programarea de la ${when} a fost anulată.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height:1.5;">
          <h2 style="margin:0 0 8px;">Programare anulată</h2>
          <p>Bună, ${escapeHtml(ev.candidateName)},</p>
          <p>Programarea pentru <b>${escapeHtml(ev.title)}</b> de la <b>${escapeHtml(when)}</b> a fost anulată.</p>
        </div>
      `,
    });
  }
}

function escapeHtml(s: string) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
