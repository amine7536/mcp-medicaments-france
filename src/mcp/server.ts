import { McpServer } from "@modelcontextprotocol/server";
import type * as z from "zod";
import { ANNOTATIONS, runTool, type Tool } from "./tool";
import { getAvailability } from "./tools/getAvailability";
import { isMajorTherapeuticInterest } from "./tools/isMajorTherapeuticInterest";
import { listCurrentShortages } from "./tools/listCurrentShortages";
import { recentChanges } from "./tools/recentChanges";
import { searchMedicine } from "./tools/searchMedicine";

export const SERVER_NAME = "ruptures-medicaments";
export const SERVER_VERSION = "1.0.0";

export const INSTRUCTIONS =
	'Data on medicine shortages in France from the ANSM (Agence nationale de sécurité du médicament) and the BDPM (Base de données publique des médicaments). Covers mainly medicines of major therapeutic interest declared by manufacturers. "Not listed" does not mean "available". Information only: never recommend a substitute, a dosage change or stopping a treatment; tell the user to ask their pharmacist or doctor. Always cite the source and the update date returned by the tools.';

/** `registerTool` config of a tool. Called per concrete tool so the SDK infers the callback's argument type. */
function config<I extends z.ZodObject, O extends z.ZodType>({ title, description, inputSchema, outputSchema }: Tool<I, O>) {
	return { title, description, inputSchema, outputSchema, annotations: ANNOTATIONS };
}

/** A fresh MCP server exposing the read-only shortage tools. */
export function createServer(env: Env, _ctx: ExecutionContext): McpServer {
	const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
	server.registerTool(searchMedicine.name, config(searchMedicine), (args) => runTool(env, searchMedicine, args));
	server.registerTool(getAvailability.name, config(getAvailability), (args) => runTool(env, getAvailability, args));
	server.registerTool(listCurrentShortages.name, config(listCurrentShortages), (args) => runTool(env, listCurrentShortages, args));
	server.registerTool(recentChanges.name, config(recentChanges), (args) => runTool(env, recentChanges, args));
	server.registerTool(isMajorTherapeuticInterest.name, config(isMajorTherapeuticInterest), (args) => runTool(env, isMajorTherapeuticInterest, args));
	return server;
}
