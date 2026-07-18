/**
 * Guardrails barrel — Stage 25.5 D25 umbrella.
 *
 * Existing call-time guards (`DefaultPermissionGate`, `DefaultApprovalPolicy`,
 * `SafeOutputSanitizer`) remain in `../harness/` for historical reasons; they
 * are documented as Guardrails in `docs/04-core-framework/` but are NOT
 * re-exported here to avoid duplicate exports.
 *
 * Phases of Stage 25.5 add: `input-guard.ts` (Phase 01),
 * `output-guard.ts` (Phase 03), `refusal-taxonomy.ts` (Phase 04),
 * `schema-guard.ts` (Phase 03).
 */
export * from "./input-guard.js";
export * from "./output-guard.js";
export * from "./content-guard.js";    // Stage 25.5 P05
