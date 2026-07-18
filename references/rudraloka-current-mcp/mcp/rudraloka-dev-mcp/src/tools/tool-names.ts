/**
 * Keep the public tool list in one reviewable place.
 *
 * This is metadata only; server.ts still performs explicit registration so
 * adding a name here cannot expose a tool by itself.
 */
export const REGISTERED_MCP_TOOL_NAMES = [
  "project_info",
  "safe_list_files",
  "safe_read_file",
  "propose_file_patch",
  "apply_approved_patch",
  "propose_new_file",
  "apply_approved_new_file",
  "run_allowed_pnpm_script",
  "audit_read_summary",
  "log_read_summary",
  "run_mcp_security_evals",
  "preview_project_knowledge_scan",
  "preview_project_chunks",
  "run_knowledge_pipeline_evals",
  "index_project_knowledge",
  "get_project_knowledge_index_status",
  "search_project_knowledge",
  "get_relevant_context",
  "run_project_rag_evals",
  "plan_project_context",
  "check_local_ai_db",
  "get_local_ai_migration_status",
  "run_local_ai_migrations"
] as const;
