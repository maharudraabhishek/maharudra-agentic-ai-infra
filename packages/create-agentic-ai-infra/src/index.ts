/**
 * Public package export boundary for the generator.
 *
 * Consumers import typed helpers from here rather than reaching into individual
 * source files. The module has no side effects and does not execute CLI logic.
 */
export * from "./args.js";
export * from "./commands.js";
export * from "./config-factory.js";
export * from "./doctor.js";
export * from "./planner.js";
export * from "./result.js";
export * from "./templates.js";
export * from "./types.js";
export * from "./validation.js";
export * from "./writer.js";
