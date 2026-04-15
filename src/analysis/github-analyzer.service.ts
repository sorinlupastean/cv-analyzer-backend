// src/modules/analysis/github-analyzer.service.ts

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  GithubProfileAnalysis,
  GithubRepositoryAnalysis,
} from './analysis.types';
import {
  clampInt,
  daysBetween,
  includesAny,
  mergeUnique,
  safeLower,
  subtractStrings,
  truncate,
  uniqueStrings,
} from './analysis.utils';

type GithubRepoApi = {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  language: string | null;
  topics?: string[];
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  size: number;
};

type GithubContentItem = {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  download_url: string | null;
};

@Injectable()
export class GithubAnalyzerService {
  private readonly logger = new Logger(GithubAnalyzerService.name);

  private readonly apiBase = 'https://api.github.com';

  private readonly knownSkillPatterns: Record<string, string[]> = {
    TypeScript: ['typescript', 'tsconfig.json', '.ts', '.tsx'],
    JavaScript: ['javascript', '.js', '.jsx', 'package.json'],
    NodeJS: ['node', 'nodejs', 'package.json'],
    NestJS: ['@nestjs/', 'nest-cli.json', 'nestjs'],
    Express: ['express'],
    React: ['react', '.tsx', '.jsx'],
    NextJS: ['next', 'next.config.js'],
    Angular: ['angular', 'angular.json'],
    Vue: ['vue', 'vue.config.js'],
    HTML: ['html'],
    CSS: ['css', 'scss', 'sass'],
    TailwindCSS: ['tailwind', 'tailwind.config'],
    Java: ['java', 'pom.xml', 'build.gradle'],
    Spring: ['spring', 'spring boot', 'spring-boot'],
    Python: ['python', 'requirements.txt', 'pyproject.toml', '.py'],
    Django: ['django', 'manage.py'],
    Flask: ['flask'],
    FastAPI: ['fastapi'],
    C: ['.c'],
    'C++': ['.cpp', '.hpp', '.cc'],
    CSharp: ['.cs', '.sln', '.csproj'],
    PHP: ['php', 'composer.json'],
    Laravel: ['laravel'],
    Go: ['go.mod', '.go'],
    Rust: ['cargo.toml', '.rs'],
    SQL: ['sql', '.sql', 'postgres', 'mysql', 'sqlite', 'typeorm', 'prisma'],
    PostgreSQL: ['postgres', 'postgresql'],
    MySQL: ['mysql'],
    MongoDB: ['mongodb', 'mongoose'],
    Prisma: ['prisma', 'schema.prisma'],
    Docker: ['dockerfile', 'docker-compose', 'docker compose'],
    Kubernetes: ['k8s', 'kubernetes', 'helm'],
    GitHubActions: ['.github/workflows', 'github actions'],
    RESTAPI: [
      'rest api',
      'controller',
      'route',
      'endpoint',
      'express',
      'nestjs',
    ],
    GraphQL: ['graphql'],
    JWT: ['jwt', 'jsonwebtoken'],
    Redis: ['redis'],
    Testing: [
      'jest',
      'vitest',
      'mocha',
      'pytest',
      '__tests__',
      '.spec.',
      '.test.',
    ],
  };

  async analyzeGithubProfile(
    githubUsernameOrUrl: string | null | undefined,
    jobText: string,
    cvSkills: string[] = [],
  ): Promise<GithubProfileAnalysis | null> {
    const username = this.extractGithubUsername(githubUsernameOrUrl);
    if (!username) return null;

    const repos = await this.fetchUserRepos(username);
    const publicSourceRepos = repos.filter(
      (r) => !r.private && !r.fork && !r.archived,
    );

    const sorted = publicSourceRepos
      .sort((a, b) => {
        const aScore =
          new Date(a.pushed_at).getTime() + (a.stargazers_count || 0) * 1000;
        const bScore =
          new Date(b.pushed_at).getTime() + (b.stargazers_count || 0) * 1000;
        return bScore - aScore;
      })
      .slice(0, 5);

    const analyzedRepos: GithubRepositoryAnalysis[] = [];
    for (const repo of sorted) {
      try {
        const analyzed = await this.analyzeRepository(repo, jobText);
        analyzedRepos.push(analyzed);
      } catch (err) {
        this.logger.warn(
          `Failed to analyze repo ${repo.full_name}: ${String(err)}`,
        );
      }
    }

    if (analyzedRepos.length === 0) {
      return {
        username,
        profileUrl: `https://github.com/${username}`,
        usedInScoring: false,
        totalPublicRepos: publicSourceRepos.length,
        analyzedReposCount: 0,
        githubScore: 0,
        confidenceBoost: 0,
        validatedSkills: [],
        unverifiedSkills: cvSkills,
        matchedRequirements: [],
        missingRequirements: [],
        redFlags: [
          'Profilul GitHub există, dar nu au fost găsite repository-uri relevante analizabile.',
        ],
        evidence: [],
        repositories: [],
      };
    }

    const githubScore = clampInt(
      analyzedRepos.reduce((acc, r) => acc + r.relevanceScore, 0) /
        analyzedRepos.length,
      0,
      100,
    );

    const detectedSkills = mergeUnique(
      ...analyzedRepos.map((r) => r.detectedSkills),
    );
    const matchedRequirements = mergeUnique(
      ...analyzedRepos.map((r) => r.matchedJobSkills),
    ).slice(0, 15);
    const missingRequirements = subtractStrings(
      mergeUnique(...analyzedRepos.map((r) => r.missingJobSkills)),
      matchedRequirements,
      15,
    );

    const evidence = uniqueStrings(
      analyzedRepos.flatMap((r) => r.evidence),
      12,
    );

    const redFlags = uniqueStrings(
      analyzedRepos.flatMap((r) => {
        const flags: string[] = [];
        if (!r.hasReadme) flags.push(`${r.name}: fără README`);
        if (r.activityScore < 25)
          flags.push(`${r.name}: activitate redusă sau veche`);
        if (r.qualityScore < 25)
          flags.push(`${r.name}: puține indicii de structură/testare/CI`);
        return flags;
      }),
      10,
    );

    const validatedSkills = cvSkills.filter((skill) =>
      detectedSkills.some((x) => safeLower(x) === safeLower(skill)),
    );

    const unverifiedSkills = cvSkills.filter(
      (skill) =>
        !validatedSkills.some((x) => safeLower(x) === safeLower(skill)),
    );

    const confidenceBoost =
      analyzedRepos.length >= 2 && matchedRequirements.length > 0
        ? 15
        : analyzedRepos.length >= 1
          ? 8
          : 0;

    return {
      username,
      profileUrl: `https://github.com/${username}`,
      usedInScoring: true,
      totalPublicRepos: publicSourceRepos.length,
      analyzedReposCount: analyzedRepos.length,
      githubScore,
      confidenceBoost,
      validatedSkills,
      unverifiedSkills,
      matchedRequirements,
      missingRequirements,
      redFlags,
      evidence,
      repositories: analyzedRepos,
    };
  }

  private async analyzeRepository(
    repo: GithubRepoApi,
    jobText: string,
  ): Promise<GithubRepositoryAnalysis> {
    const root = await this.fetchRootContents(repo.full_name);
    const rootFiles = root.map((x) => x.path);

    const languages = await this.fetchLanguages(repo.full_name);
    const readme = await this.fetchReadmeText(root);
    const latestCommitDate = await this.fetchLatestCommitDate(
      repo.full_name,
      repo.default_branch,
    );

    const joinedText = [
      repo.name,
      repo.description ?? '',
      ...(repo.topics ?? []),
      ...languages,
      ...rootFiles,
      readme,
    ]
      .join('\n')
      .toLowerCase();

    const detectedSkills = this.detectSkills(joinedText, languages, rootFiles);
    const jobSkills = this.extractJobSkills(jobText);
    const matchedJobSkills = jobSkills.filter((skill) =>
      detectedSkills.some((x) => safeLower(x) === safeLower(skill)),
    );

    const missingJobSkills = jobSkills.filter(
      (skill) =>
        !matchedJobSkills.some((x) => safeLower(x) === safeLower(skill)),
    );

    const hasReadme = rootFiles.some((f) =>
      /^readme/i.test(f.split('/').pop() ?? ''),
    );
    const hasTests = includesAny(joinedText, [
      '__tests__',
      '.spec.',
      '.test.',
      'jest',
      'vitest',
      'mocha',
      'pytest',
      'cypress',
    ]);
    const hasDocker = includesAny(joinedText, [
      'dockerfile',
      'docker-compose',
      'docker compose',
    ]);
    const hasCiCd = includesAny(joinedText, [
      '.github/workflows',
      'github actions',
    ]);
    const hasPackageJson = includesAny(joinedText, ['package.json']);
    const hasTsConfig = includesAny(joinedText, ['tsconfig.json']);
    const hasBackendIndicators = includesAny(joinedText, [
      'controller',
      'service',
      'route',
      'endpoint',
      'express',
      'nestjs',
      'spring',
      'fastapi',
      'django',
    ]);
    const hasFrontendIndicators = includesAny(joinedText, [
      'react',
      'next',
      'angular',
      'vue',
      'component',
      '.tsx',
      '.jsx',
    ]);

    const readmeScore = this.computeReadmeScore(readme);
    const qualityScore = this.computeQualityScore({
      hasReadme,
      hasTests,
      hasDocker,
      hasCiCd,
      hasPackageJson,
      hasTsConfig,
      hasBackendIndicators,
      hasFrontendIndicators,
    });

    const activityScore = this.computeActivityScore(
      latestCommitDate || repo.pushed_at || repo.updated_at,
    );

    const relevanceScore = clampInt(
      matchedJobSkills.length * 12 +
        readmeScore * 0.2 +
        qualityScore * 0.25 +
        activityScore * 0.25 +
        Math.min(repo.stargazers_count, 20) * 0.5,
      0,
      100,
    );

    const evidence: string[] = [];
    if (repo.description) evidence.push(`${repo.name}: descriere prezentă`);
    if (hasReadme) evidence.push(`${repo.name}: README disponibil`);
    if (hasTests) evidence.push(`${repo.name}: indicii de testare`);
    if (hasDocker) evidence.push(`${repo.name}: Docker detectat`);
    if (hasCiCd) evidence.push(`${repo.name}: workflow CI/CD detectat`);
    if (languages.length > 0)
      evidence.push(
        `${repo.name}: limbaje ${languages.slice(0, 4).join(', ')}`,
      );
    if (matchedJobSkills.length > 0) {
      evidence.push(
        `${repo.name}: skill-uri relevante ${matchedJobSkills.slice(0, 5).join(', ')}`,
      );
    }

    return {
      name: repo.name,
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      description: repo.description ?? '',
      private: repo.private,
      fork: repo.fork,
      archived: repo.archived,
      stargazersCount: repo.stargazers_count,
      language: repo.language,
      topics: repo.topics ?? [],
      defaultBranch: repo.default_branch,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at,
      size: repo.size,

      languages,
      rootFiles,
      hasReadme,
      hasTests,
      hasDocker,
      hasCiCd,
      hasPackageJson,
      hasTsConfig,
      hasBackendIndicators,
      hasFrontendIndicators,
      readmeScore,
      qualityScore,
      activityScore,
      relevanceScore,

      detectedSkills,
      matchedJobSkills,
      missingJobSkills,
      evidence: uniqueStrings(evidence, 10),
    };
  }

  private computeReadmeScore(readme: string): number {
    if (!readme) return 0;

    let score = 15;

    if (includesAny(readme, ['installation', 'install', 'setup'])) score += 20;
    if (includesAny(readme, ['usage', 'how to use', 'run'])) score += 20;
    if (includesAny(readme, ['features', 'functionalities'])) score += 10;
    if (includesAny(readme, ['docker'])) score += 10;
    if (includesAny(readme, ['api', 'endpoint'])) score += 10;
    if (includesAny(readme, ['license'])) score += 5;
    if (readme.length > 400) score += 10;

    return clampInt(score, 0, 100);
  }

  private computeQualityScore(input: {
    hasReadme: boolean;
    hasTests: boolean;
    hasDocker: boolean;
    hasCiCd: boolean;
    hasPackageJson: boolean;
    hasTsConfig: boolean;
    hasBackendIndicators: boolean;
    hasFrontendIndicators: boolean;
  }): number {
    let score = 0;
    if (input.hasReadme) score += 20;
    if (input.hasTests) score += 20;
    if (input.hasDocker) score += 15;
    if (input.hasCiCd) score += 15;
    if (input.hasPackageJson) score += 10;
    if (input.hasTsConfig) score += 5;
    if (input.hasBackendIndicators) score += 10;
    if (input.hasFrontendIndicators) score += 5;
    return clampInt(score, 0, 100);
  }

  private computeActivityScore(lastDate: string): number {
    const days = daysBetween(lastDate);
    if (days <= 30) return 100;
    if (days <= 90) return 80;
    if (days <= 180) return 60;
    if (days <= 365) return 40;
    if (days <= 730) return 20;
    return 5;
  }

  private detectSkills(
    joinedText: string,
    languages: string[],
    rootFiles: string[],
  ): string[] {
    const found = new Set<string>();

    for (const lang of languages) {
      const normalized = this.normalizeLanguage(lang);
      if (normalized) found.add(normalized);
    }

    const fileText = rootFiles.join('\n').toLowerCase();
    const full = `${joinedText}\n${fileText}`;

    for (const [skill, patterns] of Object.entries(this.knownSkillPatterns)) {
      if (patterns.some((p) => full.includes(p.toLowerCase()))) {
        found.add(skill);
      }
    }

    return Array.from(found).slice(0, 30);
  }

  private extractJobSkills(jobText: string): string[] {
    const text = safeLower(jobText);
    const found: string[] = [];

    for (const skill of Object.keys(this.knownSkillPatterns)) {
      if (text.includes(skill.toLowerCase())) {
        found.push(skill);
      }
    }

    if (includesAny(text, ['rest api', 'restful'])) found.push('RESTAPI');
    if (includesAny(text, ['node.js', 'node js'])) found.push('NodeJS');
    if (includesAny(text, ['postgres', 'postgresql'])) found.push('PostgreSQL');

    return uniqueStrings(found, 20);
  }

  private normalizeLanguage(lang: string): string | null {
    const x = safeLower(lang);
    if (!x) return null;
    if (x === 'typescript') return 'TypeScript';
    if (x === 'javascript') return 'JavaScript';
    if (x === 'python') return 'Python';
    if (x === 'java') return 'Java';
    if (x === 'go') return 'Go';
    if (x === 'rust') return 'Rust';
    if (x === 'php') return 'PHP';
    if (x === 'html') return 'HTML';
    if (x === 'css') return 'CSS';
    if (x === 'c') return 'C';
    if (x === 'c++') return 'C++';
    if (x === 'c#') return 'CSharp';
    if (x === 'sql') return 'SQL';
    return lang;
  }

  extractGithubUsername(input: string | null | undefined): string | null {
    const raw = String(input ?? '').trim();
    if (!raw) return null;

    if (/^[a-zA-Z0-9-]+$/.test(raw)) {
      return raw;
    }

    const match = raw.match(/github\.com\/([a-zA-Z0-9-]+)/i);
    return match?.[1] ?? null;
  }

  private async fetchUserRepos(username: string): Promise<GithubRepoApi[]> {
    const url = `${this.apiBase}/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=100`;

    const res = await this.githubGet(url);
    if (!Array.isArray(res)) {
      throw new BadRequestException(
        'Răspuns invalid de la GitHub pentru lista de repository-uri.',
      );
    }

    return res as GithubRepoApi[];
  }

  private async fetchLanguages(fullName: string): Promise<string[]> {
    const [owner, repo] = fullName.split('/');
    const url = `${this.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`;

    const res = await this.githubGet(url);
    if (!res || typeof res !== 'object') return [];

    return Object.keys(res as Record<string, number>);
  }

  private async fetchRootContents(
    fullName: string,
  ): Promise<GithubContentItem[]> {
    const [owner, repo] = fullName.split('/');
    const url = `${this.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`;

    const res = await this.githubGet(url);
    if (!Array.isArray(res)) return [];

    return (res as GithubContentItem[]).slice(0, 200);
  }

  private async fetchReadmeText(root: GithubContentItem[]): Promise<string> {
    const readme = root.find((item) => /^readme(\.|$)/i.test(item.name));
    if (!readme?.download_url) return '';

    try {
      const res = await fetch(readme.download_url, {
        method: 'GET',
      });
      if (!res.ok) return '';
      const text = await res.text();
      return truncate(text, 8000);
    } catch {
      return '';
    }
  }

  private async fetchLatestCommitDate(
    fullName: string,
    branch: string,
  ): Promise<string | null> {
    const [owner, repo] = fullName.split('/');
    const url =
      `${this.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
      `/commits?sha=${encodeURIComponent(branch)}&per_page=1`;

    const res = await this.githubGet(url);
    if (!Array.isArray(res) || res.length === 0) return null;

    const date = res[0]?.commit?.author?.date;
    return typeof date === 'string' ? date : null;
  }

  private async githubGet(url: string): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cv-analyzer-studio',
    };

    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const res = await fetch(url, { method: 'GET', headers });

    if (res.status === 404) {
      throw new BadRequestException(
        'Utilizatorul GitHub sau resursa nu a fost găsită.',
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(
        `Eroare GitHub API: ${res.status} ${truncate(body, 300)}`,
      );
    }

    return res.json();
  }
}
