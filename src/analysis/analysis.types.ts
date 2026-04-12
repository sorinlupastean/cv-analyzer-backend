// src/modules/analysis/analysis.types.ts

export type Recommendation = 'INVITA' | 'REVIZUIRE' | 'RESPINGE';

export type CandidateExperience = {
  title: string;
  company?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  responsibilities?: string[];
  technologies?: string[];
};

export type CandidateEducation = {
  school: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
};

export type GeminiJobCvAnalysis = {
  candidateName: string;
  email: string | null;
  phone: string | null;

  languages: string[];
  domains: string[];

  skills: string[];
  experience: CandidateExperience[];
  education: CandidateEducation[];

  matchedRequirements: string[];
  missingRequirements: string[];
  redFlags: string[];

  summary: string;
  matchScore: number;
  recommendation: Recommendation;

  reasoningShort: string;
  evidence: string[];
};

export type GithubRepoTechEvidence = {
  repoName: string;
  repoUrl: string;
  detectedSkills: string[];
  evidence: string[];
};

export type GithubRepositoryAnalysis = {
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stargazersCount: number;
  language: string | null;
  topics: string[];
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  size: number;

  languages: string[];
  rootFiles: string[];
  hasReadme: boolean;
  hasTests: boolean;
  hasDocker: boolean;
  hasCiCd: boolean;
  hasPackageJson: boolean;
  hasTsConfig: boolean;
  hasBackendIndicators: boolean;
  hasFrontendIndicators: boolean;
  readmeScore: number;
  qualityScore: number;
  activityScore: number;
  relevanceScore: number;

  detectedSkills: string[];
  matchedJobSkills: string[];
  missingJobSkills: string[];
  evidence: string[];
};

export type GithubProfileAnalysis = {
  username: string;
  profileUrl: string;
  usedInScoring: boolean;
  totalPublicRepos: number;
  analyzedReposCount: number;
  githubScore: number;
  confidenceBoost: number;
  validatedSkills: string[];
  unverifiedSkills: string[];
  matchedRequirements: string[];
  missingRequirements: string[];
  redFlags: string[];
  evidence: string[];
  repositories: GithubRepositoryAnalysis[];
};

export type FinalCandidateAnalysis = {
  candidateName: string;
  email: string | null;
  phone: string | null;

  cvScore: number;
  githubScore: number | null;
  finalScore: number;
  confidenceScore: number;

  recommendation: Recommendation;

  languages: string[];
  domains: string[];
  skills: string[];

  validatedSkills: string[];
  unverifiedSkills: string[];

  matchedRequirements: string[];
  missingRequirements: string[];
  redFlags: string[];

  summary: string;
  reasoningShort: string;
  evidence: string[];

  cvAnalysis: GeminiJobCvAnalysis;
  githubAnalysis: GithubProfileAnalysis | null;
};
