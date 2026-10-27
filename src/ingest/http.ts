export const USER_AGENT =
	"mcp-ruptures-medicaments/1.0 (+https://ruptures-medicaments.a3e.dev; contact: https://github.com/amine7536/mcp-ruptures-medicaments/issues)";

export const ANSM_ORIGIN = "https://ansm.sante.fr";
export const ANSM_LIST_URL = `${ANSM_ORIGIN}/disponibilites-des-produits-de-sante/medicaments`;
export const DISPO_URL = "https://base-donnees-publique.medicaments.gouv.fr/download/file/CIS_CIP_Dispo_Spec.txt";

export const REQUEST_TIMEOUT_MS = 20_000;

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** GET with the service User-Agent and the per-request timeout. */
export function get(fetcher: Fetcher, url: string): Promise<Response> {
	return fetcher(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

export function log(event: string, fields: Record<string, unknown> = {}): void {
	console.log(JSON.stringify({ event, ...fields }));
}
