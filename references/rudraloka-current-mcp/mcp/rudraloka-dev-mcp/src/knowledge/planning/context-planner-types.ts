export const PROJECT_CONTEXT_PLANNER_MODES = [
  "architecture",
  "implementation",
  "debugging",
  "security-review",
  "docs",
  "ai-infra",
  "auto"
] as const;

export type ProjectContextPlannerMode =
  (typeof PROJECT_CONTEXT_PLANNER_MODES)[number];

export type ProjectContextTaskType =
  | "architecture-decision"
  | "implementation-change"
  | "debugging"
  | "security-review"
  | "documentation"
  | "ai-infra-design"
  | "mcp-context-tooling"
  | "general-project-context";

export type ProjectContextStrategy =
  | "architecture-options-first"
  | "security-policy-first"
  | "implementation-context"
  | "debugging-evidence"
  | "docs-learning-update"
  | "ai-infra-context"
  | "general-context";

export type ProjectContextPlanInput = {
  task: string;
  mode?: ProjectContextPlannerMode;
};

export type ProjectContextPlan = {
  taskType: ProjectContextTaskType;
  strategy: ProjectContextStrategy;
  recommendedQueries: string[];
  recommendedSources: string[];
  recommendedTools: string[];
  needsUserDecision: boolean;
  includeSecurityContext: boolean;
  includeArchitectureContext: boolean;
  warnings: string[];
  nextSteps: string[];
};
