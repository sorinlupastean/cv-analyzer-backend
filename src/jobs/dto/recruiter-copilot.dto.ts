import { JobStatus } from '../entities/job.entity';

export type RecruiterCopilotDecision =
  | 'INVITE'
  | 'REVIEW'
  | 'REJECT'
  | 'FOLLOW_UP';

export type RecruiterCopilotRecommendation = 'INVITA' | 'REVIZUIRE' | 'RESPINGE';

export type RecruiterCopilotAgentMode = 'ai' | 'local';

export type RecruiterCopilotAgentTrace = {
  step: string;
  detail: string;
};

export type RecruiterCopilotAgentMemory = {
  mode: RecruiterCopilotAgentMode;
  lastTopCandidateIds: number[];
  lastTopCandidateNames: string[];
  lastGeneratedAt: string;
  notes: string[];
};

export type RecruiterCopilotCandidate = {
  id: number;
  candidateName: string;
  fileName: string;
  matchScore: number;
  confidenceScore: number;
  recommendation: RecruiterCopilotRecommendation;
  nextStep: RecruiterCopilotDecision;
  badge: string;
  explanation: string;
  evidence: string[];
  risks: string[];
  experienceHighlights: string[];
  interviewQuestions: string[];
  skills: string[];
  languages: string[];
  domains: string[];
  github: {
    username: string;
    profileUrl: string;
    score: number;
    evidence: string[];
  } | null;
  position: number;
};

export type RecruiterCopilotReport = {
  job: {
    id: number;
    title: string;
    category: string;
    location: string;
    type: string;
    status: JobStatus;
    requirements: string;
  };
  summary: {
    totalCandidates: number;
    analyzedCandidates: number;
    shortlistCount: number;
    averageScore: number;
    topRecommendation: RecruiterCopilotDecision;
    topSignal: string;
    highlights: string[];
    agentMode?: RecruiterCopilotAgentMode;
  };
  candidates: RecruiterCopilotCandidate[];
  agent?: {
    mode: RecruiterCopilotAgentMode;
    label: string;
    summary: string;
    trace: RecruiterCopilotAgentTrace[];
    memory: RecruiterCopilotAgentMemory;
    usedFallback: boolean;
  };
  generatedAt: string;
};
