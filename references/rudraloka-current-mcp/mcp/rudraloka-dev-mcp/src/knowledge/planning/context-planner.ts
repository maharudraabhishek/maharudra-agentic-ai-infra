import {
  MAX_PROJECT_CONTEXT_PLANNER_NEXT_STEPS,
  MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_QUERIES,
  MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_SOURCES,
  MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_TOOLS,
  MAX_PROJECT_CONTEXT_PLANNER_TASK_CHARS,
  MAX_PROJECT_CONTEXT_PLANNER_WARNINGS,
  MAX_PROJECT_KNOWLEDGE_QUERY_CHARS
} from "../../config/mcp-config.js";
import type {
  ProjectContextPlan,
  ProjectContextPlanInput,
  ProjectContextPlannerMode,
  ProjectContextStrategy,
  ProjectContextTaskType
} from "./context-planner-types.js";

export const PROJECT_CONTEXT_PLANNER_ALLOWED_RECOMMENDED_TOOLS = [
  "project_info",
  "safe_read_file",
  "search_project_knowledge",
  "get_relevant_context",
  "run_project_rag_evals",
  "run_mcp_security_evals",
  "run_knowledge_pipeline_evals",
  "audit_read_summary",
  "log_read_summary"
] as const;

const ALLOWED_TOOL_SET = new Set<string>(
  PROJECT_CONTEXT_PLANNER_ALLOWED_RECOMMENDED_TOOLS
);

const TASK_TYPE_TIE_BREAK_ORDER: ProjectContextTaskType[] = [
  "security-review",
  "architecture-decision",
  "ai-infra-design",
  "mcp-context-tooling",
  "implementation-change",
  "debugging",
  "documentation",
  "general-project-context"
];

const MODE_TASK_TYPE: Record<
  Exclude<ProjectContextPlannerMode, "auto">,
  ProjectContextTaskType
> = {
  architecture: "architecture-decision",
  implementation: "implementation-change",
  debugging: "debugging",
  "security-review": "security-review",
  docs: "documentation",
  "ai-infra": "ai-infra-design"
};

const STRATEGY_BY_TASK_TYPE: Record<
  ProjectContextTaskType,
  ProjectContextStrategy
> = {
  "architecture-decision": "architecture-options-first",
  "implementation-change": "implementation-context",
  debugging: "debugging-evidence",
  "security-review": "security-policy-first",
  documentation: "docs-learning-update",
  "ai-infra-design": "ai-infra-context",
  "mcp-context-tooling": "security-policy-first",
  "general-project-context": "general-context"
};

const ARCHITECTURE_DECISION_PATTERN =
  /\b(architecture|architectural|decision|decide|choose|choice|option|tradeoff|trade-off|approach|pattern|process|workflow|provider|runtime|docker|compose|kubernetes|public|exposure|expose|connector|production|deployment|deploy|service boundary|microservice)\b/i;

const SECURITY_CONTEXT_PATTERN =
  /\b(mcp|security|secure|secret|credential|token|rag|retrieval|context tool|context planner|indexing|indexer|database|db|migration|sql|tool|path|eval|evaluation|log|audit|patch|approval|blocked|policy)\b/i;

const AI_INFRA_PATTERN =
  /\b(ai infra|ai infrastructure|rag|embedding|vector|pgvector|retrieval|rerank|context engineering|context planner|chunk|orchestration|eval harness|provider)\b/i;

const MCP_CONTEXT_PATTERN =
  /\b(mcp|tool|tools|context tool|context planner|safe read|controlled write|stdio|audit|log summary)\b/i;

const IMPLEMENTATION_PATTERN =
  /\b(implement|add|update|change|refactor|code|typescript|source|register|wire|create|fix)\b/i;

const DEBUGGING_PATTERN =
  /\b(debug|bug|failure|failing|error|trace|troubleshoot|regression|broken|diagnose|logs?)\b/i;

const DOCUMENTATION_PATTERN =
  /\b(doc|docs|documentation|readme|runbook|learning journal|guide|explain|write up|note)\b/i;

const LEARNING_WORTHY_PATTERN =
  /\b(ai infra|rag|embedding|vector|pgvector|chunk|retrieval|context engineering|planner|orchestration|eval|mcp|security|architecture|workflow|runbook)\b/i;

const CLASSIFICATION_RULES: Array<{
  taskType: ProjectContextTaskType;
  pattern: RegExp;
  points: number;
}> = [
  { taskType: "security-review", pattern: SECURITY_CONTEXT_PATTERN, points: 3 },
  {
    taskType: "architecture-decision",
    pattern: ARCHITECTURE_DECISION_PATTERN,
    points: 3
  },
  { taskType: "ai-infra-design", pattern: AI_INFRA_PATTERN, points: 3 },
  { taskType: "mcp-context-tooling", pattern: MCP_CONTEXT_PATTERN, points: 2 },
  {
    taskType: "implementation-change",
    pattern: IMPLEMENTATION_PATTERN,
    points: 2
  },
  { taskType: "debugging", pattern: DEBUGGING_PATTERN, points: 2 },
  { taskType: "documentation", pattern: DOCUMENTATION_PATTERN, points: 2 }
];

function normalizeTask(task: string): string {
  const normalized = task.trim().replace(/\s+/g, " ");

  if (normalized.length === 0) {
    throw new Error("Project context planner task must not be empty.");
  }

  if (normalized.length > MAX_PROJECT_CONTEXT_PLANNER_TASK_CHARS) {
    throw new Error(
      `Project context planner task is too long. Limit is ${MAX_PROJECT_CONTEXT_PLANNER_TASK_CHARS} characters.`
    );
  }

  return normalized;
}

function capUnique(values: readonly string[], cap: number): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");

    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    results.push(normalized);

    if (results.length >= cap) {
      break;
    }
  }

  return results;
}

function capQuery(query: string): string {
  const normalized = query.trim().replace(/\s+/g, " ");

  if (normalized.length <= MAX_PROJECT_KNOWLEDGE_QUERY_CHARS) {
    return normalized;
  }

  return normalized.slice(0, MAX_PROJECT_KNOWLEDGE_QUERY_CHARS).trim();
}

function classifyTask(params: {
  task: string;
  mode: ProjectContextPlannerMode;
}): ProjectContextTaskType {
  if (params.mode !== "auto") {
    return MODE_TASK_TYPE[params.mode];
  }

  const scores = new Map<ProjectContextTaskType, number>();

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(params.task)) {
      scores.set(
        rule.taskType,
        (scores.get(rule.taskType) ?? 0) + rule.points
      );
    }
  }

  let bestType: ProjectContextTaskType = "general-project-context";
  let bestScore = 0;

  for (const taskType of TASK_TYPE_TIE_BREAK_ORDER) {
    const score = scores.get(taskType) ?? 0;

    if (score > bestScore) {
      bestType = taskType;
      bestScore = score;
    }
  }

  return bestType;
}

function includesArchitectureDecisionSignal(task: string): boolean {
  return ARCHITECTURE_DECISION_PATTERN.test(task);
}

function includesSecuritySignal(task: string): boolean {
  return SECURITY_CONTEXT_PATTERN.test(task);
}

function includesAiInfraSignal(task: string, taskType: ProjectContextTaskType): boolean {
  return taskType === "ai-infra-design" || AI_INFRA_PATTERN.test(task);
}

function includesMcpSignal(task: string, taskType: ProjectContextTaskType): boolean {
  return taskType === "mcp-context-tooling" || MCP_CONTEXT_PATTERN.test(task);
}

function buildRecommendedQueries(params: {
  task: string;
  taskType: ProjectContextTaskType;
  includeSecurityContext: boolean;
  includeArchitectureContext: boolean;
  aiInfra: boolean;
  mcp: boolean;
  docs: boolean;
  debugging: boolean;
}): string[] {
  const queries = [
    params.task,
    params.includeSecurityContext
      ? `${params.task} AGENTS.md MCP security policy secret blocking approval context tools`
      : "",
    params.includeArchitectureContext
      ? `${params.task} architecture decisions options tradeoffs user decision`
      : "",
    params.aiInfra
      ? `${params.task} agentic context engineering RAG retrieval planner evals`
      : "",
    params.mcp
      ? `${params.task} local MCP context tools security evals tool policy`
      : "",
    params.debugging
      ? `${params.task} MCP logs eval failures retrieval context troubleshooting`
      : "",
    params.docs
      ? `${params.task} learning journal runbook docs update context planner`
      : ""
  ].map(capQuery);

  return capUnique(
    queries,
    MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_QUERIES
  );
}

function buildRecommendedSources(params: {
  includeSecurityContext: boolean;
  includeArchitectureContext: boolean;
  aiInfra: boolean;
  mcp: boolean;
  docs: boolean;
  implementation: boolean;
  debugging: boolean;
}): string[] {
  const sources = [
    "AGENTS.md",
    params.includeSecurityContext
      ? "docs/05-security/mcp-security-policy.md"
      : "",
    params.includeSecurityContext
      ? ".agents/skills/mcp-security-review/SKILL.md"
      : "",
    params.includeArchitectureContext
      ? "docs/02-architecture/architecture-decisions.md"
      : "",
    params.includeArchitectureContext
      ? ".agents/skills/architecture-decision/SKILL.md"
      : "",
    params.aiInfra
      ? "docs/04-ai-infra/local-mcp-agentic-context-rag-design-spec.md"
      : "",
    params.aiInfra ? "docs/04-ai-infra/local-mcp-ai-infra-plan.md" : "",
    params.aiInfra ? ".agents/skills/ai-infra-design/SKILL.md" : "",
    params.mcp ? "docs/03-mcp/local-mcp-context-tools.md" : "",
    params.mcp ? "docs/03-mcp/local-mcp-architecture.md" : "",
    params.implementation ? "mcp/rudraloka-dev-mcp/src/knowledge/" : "",
    params.implementation ? "mcp/rudraloka-dev-mcp/src/tools/" : "",
    params.debugging ? "mcp/rudraloka-dev-mcp/src/evals/" : "",
    params.docs ? "docs/01-learning-journal/README.md" : "",
    params.docs ? "docs/06-runbooks/" : ""
  ];

  return capUnique(
    sources,
    MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_SOURCES
  );
}

function safeRecommendedTools(tools: readonly string[]): string[] {
  return capUnique(
    tools.filter((tool) => ALLOWED_TOOL_SET.has(tool)),
    MAX_PROJECT_CONTEXT_PLANNER_RECOMMENDED_TOOLS
  );
}

function buildRecommendedTools(params: {
  includeSecurityContext: boolean;
  includeArchitectureContext: boolean;
  docs: boolean;
  debugging: boolean;
}): string[] {
  const tools = [
    "search_project_knowledge",
    "get_relevant_context",
    "safe_read_file",
    params.includeArchitectureContext ? "project_info" : "",
    params.includeSecurityContext ? "run_mcp_security_evals" : "",
    params.includeSecurityContext ? "run_project_rag_evals" : "",
    params.docs ? "run_knowledge_pipeline_evals" : "",
    params.debugging ? "log_read_summary" : "",
    params.debugging ? "audit_read_summary" : "",
    params.includeSecurityContext ? "audit_read_summary" : "",
    params.includeSecurityContext ? "log_read_summary" : ""
  ];

  return safeRecommendedTools(tools);
}

function buildWarnings(params: {
  includeSecurityContext: boolean;
  needsUserDecision: boolean;
}): string[] {
  return capUnique(
    [
      "planner-is-advisory-only",
      "planner-does-not-read-files-run-tools-call-models-or-touch-the-db",
      params.includeSecurityContext
        ? "security-sensitive-task-include-policy-context"
        : "",
      params.needsUserDecision
        ? "architecture-or-process-choice-requires-user-decision"
        : ""
    ],
    MAX_PROJECT_CONTEXT_PLANNER_WARNINGS
  );
}

function buildNextSteps(params: {
  needsUserDecision: boolean;
  includeSecurityContext: boolean;
  implementation: boolean;
  docs: boolean;
  debugging: boolean;
}): string[] {
  return capUnique(
    [
      params.needsUserDecision
        ? "Present options and tradeoffs, give a separate recommendation, and wait for user choice before implementation."
        : "",
      params.includeSecurityContext
        ? "Review MCP security policy before changing tools, retrieval, indexing, database, eval, log, audit, or path behavior."
        : "",
      "Use recommended queries with search_project_knowledge or get_relevant_context only after this planning step.",
      params.implementation
        ? "Read exact implementation files before editing and keep changes scoped to the requested behavior."
        : "",
      params.debugging
        ? "Use eval and observability summaries to gather evidence before changing behavior."
        : "",
      params.docs
        ? "Add or update a beginner-friendly learning note under docs/01-learning-journal/ when the work teaches a durable concept."
        : ""
    ],
    MAX_PROJECT_CONTEXT_PLANNER_NEXT_STEPS
  );
}

export function planProjectContext(
  input: ProjectContextPlanInput
): ProjectContextPlan {
  const task = normalizeTask(input.task);
  const mode = input.mode ?? "auto";
  const taskType = classifyTask({ task, mode });
  const architectureSignal =
    taskType === "architecture-decision" ||
    includesArchitectureDecisionSignal(task);
  const securitySignal =
    taskType === "security-review" ||
    taskType === "mcp-context-tooling" ||
    includesSecuritySignal(task);
  const aiInfra = includesAiInfraSignal(task, taskType);
  const mcp = includesMcpSignal(task, taskType);
  const docs =
    taskType === "documentation" ||
    DOCUMENTATION_PATTERN.test(task) ||
    LEARNING_WORTHY_PATTERN.test(task);
  const debugging = taskType === "debugging" || DEBUGGING_PATTERN.test(task);
  const implementation =
    taskType === "implementation-change" || IMPLEMENTATION_PATTERN.test(task);
  const needsUserDecision = architectureSignal;
  const includeSecurityContext = securitySignal;
  const includeArchitectureContext = architectureSignal;
  const strategy = needsUserDecision
    ? "architecture-options-first"
    : includeSecurityContext && taskType !== "ai-infra-design"
      ? "security-policy-first"
      : STRATEGY_BY_TASK_TYPE[taskType];

  return {
    taskType,
    strategy,
    recommendedQueries: buildRecommendedQueries({
      task,
      taskType,
      includeSecurityContext,
      includeArchitectureContext,
      aiInfra,
      mcp,
      docs,
      debugging
    }),
    recommendedSources: buildRecommendedSources({
      includeSecurityContext,
      includeArchitectureContext,
      aiInfra,
      mcp,
      docs,
      implementation,
      debugging
    }),
    recommendedTools: buildRecommendedTools({
      includeSecurityContext,
      includeArchitectureContext,
      docs,
      debugging
    }),
    needsUserDecision,
    includeSecurityContext,
    includeArchitectureContext,
    warnings: buildWarnings({
      includeSecurityContext,
      needsUserDecision
    }),
    nextSteps: buildNextSteps({
      needsUserDecision,
      includeSecurityContext,
      implementation,
      docs,
      debugging
    })
  };
}
