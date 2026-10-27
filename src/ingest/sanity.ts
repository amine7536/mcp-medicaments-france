import type { ListRow } from "./ansm";

export const MIN_ROWS = 200;

export interface SanityContext {
	previousOkSeen: number | null;
	currentlyListedIds: Set<string>;
}

export type SanityResult = { ok: true } | { ok: false; reason: string };

/** Abort rules run before any write; the first matching rule wins. */
export function checkSanity(rows: Pick<ListRow, "id" | "status">[], ctx: SanityContext): SanityResult {
	const n = rows.length;
	if (n === 0) return { ok: false, reason: "list has 0 rows" };
	if (n < MIN_ROWS) return { ok: false, reason: `list has ${n} rows, below ${MIN_ROWS}` };
	if (ctx.previousOkSeen !== null && n < ctx.previousOkSeen * 0.6) {
		return { ok: false, reason: `list has ${n} rows, below 60% of previous ${ctx.previousOkSeen}` };
	}
	const autre = rows.filter((r) => r.status === "autre").length;
	if (autre > n * 0.2) return { ok: false, reason: `${autre} of ${n} rows have an unknown status` };
	const seen = new Set(rows.map((r) => r.id));
	let absent = 0;
	for (const id of ctx.currentlyListedIds) if (!seen.has(id)) absent++;
	if (absent > ctx.currentlyListedIds.size * 0.1) {
		return { ok: false, reason: `${absent} of ${ctx.currentlyListedIds.size} listed entries are absent` };
	}
	return { ok: true };
}
