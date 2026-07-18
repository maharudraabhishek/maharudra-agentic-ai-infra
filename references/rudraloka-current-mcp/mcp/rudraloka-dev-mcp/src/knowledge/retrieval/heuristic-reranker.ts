import type { KnowledgeSourceType } from "../chunking/chunk-types.js";
import type {
  ProjectKnowledgeCandidate,
  ProjectKnowledgeScoreBreakdown,
  RerankedProjectKnowledgeCandidate
} from "./retrieval-types.js";

const SOURCE_PRIORITY: Record<KnowledgeSourceType, number> = {
  "project-policy": 0.22,
  "security-doc": 0.2,
  "architecture-doc": 0.18,
  "ai-infra-doc": 0.16,
  "mcp-doc": 0.15,
  runbook: 0.12,
  skill: 0.11,
  "typescript-source": 0.1,
  "learning-journal": 0.08,
  "claude-compatibility": 0.07,
  "project-doc": 0.06
};

const SECURITY_QUERY_PATTERN =
  /security|secret|credential|token|approval|patch|mcp|env|blocked|safe|policy/i;
const ARCHITECTURE_QUERY_PATTERN =
  /architecture|decision|tradeoff|design|milestone|plan|infra/i;

function normalizeText(value: string | undefined): string {
  return (value ?? "").toLowerCase();
}

function extractSearchTerms(query: string): string[] {
  const terms = query.match(/[a-zA-Z0-9_.:-]{2,}/g) ?? [];

  return Array.from(new Set(terms.map((term) => term.toLowerCase())));
}

function includesAnyTerm(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function exactIdentifierBoost(params: {
  candidate: ProjectKnowledgeCandidate;
  terms: readonly string[];
}): number {
  const content = normalizeText(params.candidate.content);
  const symbolName = normalizeText(params.candidate.symbolName);
  const filePath = normalizeText(params.candidate.filePath);
  const headingPath = normalizeText(params.candidate.headingPath);
  const exactTerms = params.terms.filter((term) => /[_./:-]/.test(term));
  let boost = 0;

  if (exactTerms.length > 0 && includesAnyTerm(symbolName, exactTerms)) {
    boost += 0.22;
  }

  if (exactTerms.length > 0 && includesAnyTerm(filePath, exactTerms)) {
    boost += 0.2;
  }

  if (exactTerms.length > 0 && includesAnyTerm(headingPath, exactTerms)) {
    boost += 0.14;
  }

  if (exactTerms.length > 0 && includesAnyTerm(content, exactTerms)) {
    boost += 0.2;
  }

  return Math.min(0.35, boost);
}

function metadataBoost(params: {
  candidate: ProjectKnowledgeCandidate;
  terms: readonly string[];
}): number {
  const metadataText = [
    params.candidate.filePath,
    params.candidate.headingPath,
    params.candidate.symbolName,
    params.candidate.sourceType
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (includesAnyTerm(metadataText, params.terms)) {
    return 0.16;
  }

  return 0;
}

function securityOrArchitectureBoost(params: {
  query: string;
  candidate: ProjectKnowledgeCandidate;
}): number {
  if (
    SECURITY_QUERY_PATTERN.test(params.query) &&
    (params.candidate.sourceType === "security-doc" ||
      params.candidate.sourceType === "project-policy" ||
      params.candidate.filePath === "AGENTS.md")
  ) {
    return 0.18;
  }

  if (
    ARCHITECTURE_QUERY_PATTERN.test(params.query) &&
    (params.candidate.sourceType === "architecture-doc" ||
      params.candidate.filePath.includes("architecture-decision") ||
      params.candidate.filePath.includes("architecture-decisions"))
  ) {
    return 0.16;
  }

  return 0;
}

function buildMatchReasons(params: {
  candidate: ProjectKnowledgeCandidate;
  breakdown: ProjectKnowledgeScoreBreakdown;
}): string[] {
  const reasons = new Set<string>();

  for (const source of params.candidate.retrievalSources) {
    reasons.add(source === "full-text" ? "full-text-match" : "vector-match");
  }

  if (params.breakdown.exactIdentifierBoost > 0) {
    reasons.add("exact-identifier-boost");
  }

  if (params.breakdown.metadataBoost > 0) {
    reasons.add("metadata-match");
  }

  if (params.breakdown.sourcePriorityBoost > 0.15) {
    reasons.add("source-priority");
  }

  if (params.breakdown.securityOrArchitectureBoost > 0) {
    reasons.add("security-or-architecture-context");
  }

  if (params.breakdown.archivePenalty < 0) {
    reasons.add("archive-penalty");
  }

  return Array.from(reasons).sort();
}

function scoreCandidate(params: {
  query: string;
  terms: readonly string[];
  candidate: ProjectKnowledgeCandidate;
}): RerankedProjectKnowledgeCandidate {
  const vectorScore = params.candidate.vectorScore ?? 0;
  const fullTextScore = params.candidate.fullTextScore ?? 0;
  const exactBoost = exactIdentifierBoost({
    candidate: params.candidate,
    terms: params.terms
  });
  const metadata = metadataBoost({
    candidate: params.candidate,
    terms: params.terms
  });
  const sourcePriority = SOURCE_PRIORITY[params.candidate.sourceType] ?? 0;
  const securityArchitecture = securityOrArchitectureBoost({
    query: params.query,
    candidate: params.candidate
  });
  const archivePenalty = params.candidate.isArchived ? -0.25 : 0;
  const finalScore =
    fullTextScore * 0.55 +
    vectorScore * 0.2 +
    exactBoost +
    metadata +
    sourcePriority +
    securityArchitecture +
    archivePenalty;
  const breakdown = {
    vectorScore,
    fullTextScore,
    exactIdentifierBoost: exactBoost,
    metadataBoost: metadata,
    sourcePriorityBoost: sourcePriority,
    securityOrArchitectureBoost: securityArchitecture,
    archivePenalty,
    finalScore: Number(finalScore.toFixed(6))
  };

  return {
    ...params.candidate,
    score: breakdown.finalScore,
    scoreBreakdown: breakdown,
    matchReasons: buildMatchReasons({
      candidate: params.candidate,
      breakdown
    })
  };
}

export function mergeProjectKnowledgeCandidates(
  candidates: readonly ProjectKnowledgeCandidate[]
): ProjectKnowledgeCandidate[] {
  const mergedByChunk = new Map<string, ProjectKnowledgeCandidate>();

  for (const candidate of candidates) {
    const existing = mergedByChunk.get(candidate.chunkId);

    if (!existing) {
      mergedByChunk.set(candidate.chunkId, { ...candidate });
      continue;
    }

    mergedByChunk.set(candidate.chunkId, {
      ...existing,
      vectorScore: Math.max(existing.vectorScore ?? 0, candidate.vectorScore ?? 0),
      fullTextScore: Math.max(
        existing.fullTextScore ?? 0,
        candidate.fullTextScore ?? 0
      ),
      retrievalSources: Array.from(
        new Set([...existing.retrievalSources, ...candidate.retrievalSources])
      ).sort()
    });
  }

  return Array.from(mergedByChunk.values());
}

export function rerankProjectKnowledgeCandidates(params: {
  query: string;
  candidates: readonly ProjectKnowledgeCandidate[];
  topK: number;
}): RerankedProjectKnowledgeCandidate[] {
  const terms = extractSearchTerms(params.query);

  return params.candidates
    .map((candidate) =>
      scoreCandidate({
        query: params.query,
        terms,
        candidate
      })
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.filePath !== right.filePath) {
        return left.filePath.localeCompare(right.filePath);
      }

      return left.chunkIndex - right.chunkIndex;
    })
    .slice(0, params.topK);
}
