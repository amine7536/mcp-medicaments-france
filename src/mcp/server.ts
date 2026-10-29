import { McpServer } from "@modelcontextprotocol/server";
import type * as z from "zod";
import { ANNOTATIONS, runTool, type Tool } from "./tool";
import { getAvailability } from "./tools/getAvailability";
import { getMedicineInfo } from "./tools/getMedicineInfo";
import { isMajorTherapeuticInterest } from "./tools/isMajorTherapeuticInterest";
import { listCurrentShortages } from "./tools/listCurrentShortages";
import { recentChanges } from "./tools/recentChanges";
import { searchMedicine } from "./tools/searchMedicine";

export const SERVER_NAME = "medicaments-france";
export const SERVER_VERSION = "1.6.0"; // x-release-please-version

export const INSTRUCTIONS =
	`Data on medicines in France from the ANSM (Agence nationale de sécurité du médicament) and the BDPM (Base de données publique des médicaments): medicine shortages, and reference information on boxes, prices, reimbursement, prescription and dispensing conditions and ANSM safety information. The shortage list covers mainly medicines of major therapeutic interest declared by manufacturers. "Not listed" does not mean "available". Information only: never recommend a substitute, a dosage change or stopping a treatment; tell the user to ask their pharmacist or doctor. Always cite the source and the update date returned by the tools. Substitution, dosage and stopping questions: if the user asks what to take instead, for a substitute, an alternative, an equivalent or a replacement, or whether to change a dose or stop a treatment, do not name or list any other medicine, brand, presentation or active substance, whether from your own knowledge or from tool results. Other medicines returned by the tools, including products with the same active substance, are not alternatives. Answer only with the shortage status of the medicine asked about, say that only a pharmacist or doctor can choose an alternative or change a treatment, and give that medicine's ANSM page link when there is one.`;

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
	server.registerTool(getMedicineInfo.name, config(getMedicineInfo), (args) => runTool(env, getMedicineInfo, args));
	return server;
}
