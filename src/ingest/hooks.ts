/** Runs after a successful diff; returns a fragment for the run message. */
export async function afterIngest(_env: Env, _run: { id: number; bootstrap: boolean }): Promise<string> {
	return "";
}
