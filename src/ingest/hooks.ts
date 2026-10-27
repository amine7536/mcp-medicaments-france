import { matchAll } from "./match";

/** Runs after a successful diff; returns a fragment for the run message. */
export async function afterIngest(env: Env, _run: { id: number; bootstrap: boolean }): Promise<string> {
	const c = await matchAll(env);
	return `match: manual=${c.manual} dispo=${c.dispo} exact=${c.exact} fuzzy=${c.fuzzy} none=${c.none}`;
}
