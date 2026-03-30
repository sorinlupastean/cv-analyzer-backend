import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Cv } from '../cvs/entities/cv.entity';

export type ScoreEvolutionPoint = {
  name: string; // ex: "W08"
  score: number; // scor mediu
  candidates: number; // câte CV-uri analizate
};

export type SkillPoint = {
  name: string; // skill
  value: number; // count (în frontend îl transformăm în procent)
};

export type HomeDashboardDto = {
  kpis: {
    cvsUploadedLast30: number;
    cvsUploadedDeltaPct: number;

    cvsAnalyzedLast30: number;
    analyzedRateLast30: number;

    avgMatchLast30: number;

    invitedLast30: number;
    invitedRateLast30: number;
  };
  charts: {
    scoreEvolution: ScoreEvolutionPoint[];
    topSkillsLast30: SkillPoint[];
  };
};

@Injectable()
export class DashboardService {
  constructor(@InjectRepository(Cv) private readonly cvRepo: Repository<Cv>) {}

  async home(): Promise<HomeDashboardDto> {
    const now = new Date();

    const d30 = new Date(now);
    d30.setDate(now.getDate() - 30);

    const d60 = new Date(now);
    d60.setDate(now.getDate() - 60);

    const d56 = new Date(now);
    d56.setDate(now.getDate() - 56);

    const [
      cvsUploadedLast30,
      cvsUploadedPrev30,
      cvsAnalyzedLast30,
      avgMatchLast30,
      invitedLast30,
      scoreEvolution,
      topSkillsLast30,
    ] = await Promise.all([
      this.cvRepo.count({ where: { createdAt: Between(d30, now) } }),
      this.cvRepo.count({ where: { createdAt: Between(d60, d30) } }),

      this.cvRepo.count({
        where: { createdAt: Between(d30, now), status: 'Analizat' },
      }),

      this.getAvgMatchLast30(d30, now),
      this.countInvitedLast30(d30, now),

      this.getScoreEvolutionWeekly(d56, now),
      this.getTopSkillsLast30(d30, now),
    ]);

    const cvsUploadedDeltaPct =
      cvsUploadedPrev30 === 0
        ? cvsUploadedLast30 > 0
          ? 100
          : 0
        : ((cvsUploadedLast30 - cvsUploadedPrev30) / cvsUploadedPrev30) * 100;

    const analyzedRateLast30 =
      cvsUploadedLast30 === 0 ? 0 : cvsAnalyzedLast30 / cvsUploadedLast30;

    const invitedRateLast30 =
      cvsAnalyzedLast30 === 0 ? 0 : invitedLast30 / cvsAnalyzedLast30;

    return {
      kpis: {
        cvsUploadedLast30,
        cvsUploadedDeltaPct: Math.round(cvsUploadedDeltaPct * 10) / 10,

        cvsAnalyzedLast30,
        analyzedRateLast30,

        avgMatchLast30,

        invitedLast30,
        invitedRateLast30,
      },
      charts: {
        scoreEvolution,
        topSkillsLast30,
      },
    };
  }

  private async getAvgMatchLast30(from: Date, to: Date) {
    const row = await this.cvRepo
      .createQueryBuilder('cv')
      .select('AVG("cv"."matchScore")', 'avg')
      .where(`"cv"."status" = :st`, { st: 'Analizat' })
      .andWhere(`"cv"."createdAt" BETWEEN :from AND :to`, { from, to })
      .getRawOne();

    return Math.round(Number(row?.avg ?? 0));
  }

  private async countInvitedLast30(from: Date, to: Date) {
    const row = await this.cvRepo
      .createQueryBuilder('cv')
      .select('COUNT(*)', 'cnt')
      .where(`"cv"."analysisRaw" IS NOT NULL`)
      .andWhere(`"cv"."analysisRaw"->>'recommendation' = :r`, { r: 'INVITA' })
      .andWhere(`"cv"."createdAt" BETWEEN :from AND :to`, { from, to })
      .getRawOne();

    return Number(row?.cnt ?? 0);
  }

  private async getScoreEvolutionWeekly(from: Date, to: Date) {
    const rows = await this.cvRepo
      .createQueryBuilder('cv')
      .select(
        `to_char(date_trunc('week', "cv"."createdAt"), 'IYYY-"W"IW')`,
        'week',
      )
      .addSelect('AVG("cv"."matchScore")', 'avgScore')
      .addSelect('COUNT(*)', 'cnt')
      .where(`"cv"."status" = :st`, { st: 'Analizat' })
      .andWhere(`"cv"."createdAt" BETWEEN :from AND :to`, { from, to })
      .groupBy('week')
      .orderBy('week', 'ASC')
      .getRawMany();

    const map = new Map<string, { avg: number; cnt: number }>();
    for (const r of rows) {
      map.set(String(r.week), {
        avg: Math.round(Number(r.avgScore ?? 0)),
        cnt: Number(r.cnt ?? 0),
      });
    }

    // Generează ultimele 8 săptămâni, inclusiv săptămâna curentă
    const points: { name: string; score: number; candidates: number }[] = [];
    const cur = new Date(to);
    cur.setHours(0, 0, 0, 0);

    for (let i = 7; i >= 0; i--) {
      const d = new Date(cur);
      d.setDate(cur.getDate() - i * 7);

      const key = await this.cvRepo.query(
        `SELECT to_char(date_trunc('week', $1::timestamptz), 'IYYY-"W"IW') AS w`,
        [d],
      );
      const weekKey = String(key?.[0]?.w ?? '');

      const parts = weekKey.split('-W');
      const w = parts.length === 2 ? parts[1] : weekKey;
      const label = `W${w}`;

      const found = map.get(weekKey);
      points.push({
        name: label,
        score: found?.avg ?? 0,
        candidates: found?.cnt ?? 0,
      });
    }

    return points;
  }

  private async getTopSkillsLast30(
    from: Date,
    to: Date,
  ): Promise<SkillPoint[]> {
    // skills este text[] la tine, deci unnest merge.
    // Alegem doar CV-urile analizate, ca să fie relevant.
    const rows = await this.cvRepo
      .createQueryBuilder()
      .select('skill', 'skill')
      .addSelect('COUNT(*)', 'cnt')
      .from((qb) => {
        return qb
          .select(`unnest("cv"."skills")`, 'skill')
          .from(Cv, 'cv')
          .where(`"cv"."status" = :st`, { st: 'Analizat' })
          .andWhere(`"cv"."createdAt" BETWEEN :from AND :to`, { from, to });
      }, 't')
      .groupBy('skill')
      .orderBy('cnt', 'DESC')
      .limit(10)
      .getRawMany();

    return rows
      .map((r: any) => ({
        name: String(r.skill || '').trim(),
        value: Number(r.cnt ?? 0),
      }))
      .filter((x) => x.name.length > 0 && x.value > 0);
  }
}
