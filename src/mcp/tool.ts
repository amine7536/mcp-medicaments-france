import type { CallToolResult, StandardSchemaWithJSON, ToolAnnotations } from "@modelcontextprotocol/server";
import type * as z from "zod";
import { log } from "../ingest/http";
import { errorResult, loadSourceDates, UNKNOWN_DATES } from "./envelope";

export const ANNOTATIONS: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const INFO_ONLY = "Public data for information only; not medical advice.";

export const UNAVAILABLE = "Service temporarily unavailable, please try again later.";
export const EXACTLY_ONE = (args: string): string => `Provide exactly one of ${args}.`;

export const NOT_FOUND_HINT = "Check the spelling or search by active substance (DCI).";

/** What a handler returns: the tool result, and the CIS it resolved or was given (recorded in usage analytics). */
export interface ToolOutcome {
	result: CallToolResult;
	cis?: string | null;
}

export interface ToolContext {
	db: D1Database;
	now: Date;
}

/** Parsed arguments of a tool, as the SDK hands them to its callback. */
export type ToolArgs<I extends z.ZodObject> = StandardSchemaWithJSON.InferOutput<I>;

export interface Tool<I extends z.ZodObject, O extends z.ZodType> {
	name: string;
	title: string;
	description: string;
	inputSchema: I;
	outputSchema: O;
	handler: (ctx: ToolContext, args: ToolArgs<I>) => Promise<ToolOutcome>;
}

/**
 * Runs a handler for the MCP server: any thrown error (D1) becomes an error result, and one usage
 * data point (tool, ok|error, resolved CIS, latency) is written. Analytics failures are swallowed.
 */
export async function runTool<I extends z.ZodObject, O extends z.ZodType>(
	env: Pick<Env, "DB" | "USAGE">,
	tool: Tool<I, O>,
	args: ToolArgs<I>,
): Promise<CallToolResult> {
	const started = performance.now();
	let outcome: ToolOutcome;
	try {
		outcome = await tool.handler({ db: env.DB, now: new Date() }, args);
	} catch (err) {
		log("tool_error", { tool: tool.name, error: String(err) }, "error");
		const dates = await loadSourceDates(env.DB).catch(() => UNKNOWN_DATES);
		outcome = { result: errorResult(UNAVAILABLE, dates) };
	}
	try {
		env.USAGE.writeDataPoint({
			blobs: [tool.name, outcome.result.isError ? "error" : "ok", outcome.cis ?? ""],
			doubles: [performance.now() - started],
			indexes: [tool.name],
		});
	} catch {
		// Usage analytics never fail a tool call.
	}
	return outcome.result;
}
