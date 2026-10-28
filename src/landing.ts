import { escapeText } from "entities/escape";
import { ANSM_SOURCE_URL, BDPM_SOURCE_URL, COVERAGE_NOTE, DISCLAIMER } from "./mcp/envelope";

export const MCP_ENDPOINT = "https://ruptures-medicaments.a3e.dev/mcp";
export const REPO_URL = "https://github.com/amine7536/mcp-ruptures-medicaments";
export const NON_ENDORSEMENT = "Ce service n'est ni approuvé ni soutenu par l'ANSM, la HAS ou l'UNCAM.";

/** Example questions with the expected behaviour of the assistant. */
export const EXAMPLES: readonly { question: string; behaviour: string }[] = [
	{
		question: "« L'Aspirine est-elle en rupture ? »",
		behaviour: "Statut de rupture selon l'ANSM, date de retour annoncée, lien vers la fiche ANSM et date de mise à jour.",
	},
	{
		question: "« Quels sont les médicaments en tension pour la cardiologie ? »",
		behaviour: "Liste des tensions d'approvisionnement du domaine Cardiologie selon l'ANSM, avec les dates de retour annoncées.",
	},
	{
		question: "« Qu'est-ce qui a changé cette semaine ? »",
		behaviour: "Nouvelles ruptures, remises à disposition et changements de date de retour détectés par le service.",
	},
	{
		question: "« L'amoxicilline est-elle un MITM ? »",
		behaviour: "Indique si le médicament figure sur la liste des médicaments d'intérêt thérapeutique majeur de la BDPM.",
	},
	{
		question: "« Mon médicament n'est pas listé, il est donc disponible ? »",
		behaviour: "Non : l'absence de la liste ne garantit pas la disponibilité ; demandez à votre pharmacien.",
	},
	{
		question: "« Par quoi remplacer le Brevibloc ? »",
		behaviour: "Refus : aucun médicament de remplacement n'est proposé ; seul un médecin ou un pharmacien peut choisir une alternative.",
	},
];

export const REAL_ANSWERS_NOTE =
	"Réponses de Claude via ce serveur, capturées le 28/10/2026 avec la consigne de répondre en quelques phrases. Les données ont pu changer depuis.";

/** Real answers captured from production on 2026-10-28. */
export const REAL_ANSWERS: readonly { question: string; answer: string }[] = [
	{
		question: "« L'Aspirine est-elle en rupture ? »",
		answer:
			"Parmi les présentations d'Aspirine, seule l'ASPIRINE ARROW 75 mg, comprimé gastro-résistant figure sur la liste de l'ANSM : elle est en tension d'approvisionnement en ville et en rupture à l'hôpital, sans date de retour connue (fiche ANSM : https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/acide-acetylsalicylique-75-mg-comprime-gastro-resistant-acide-acetylsalicylique, mise à jour le 21/05/2026). Les autres présentations d'Aspirine ne figurent pas sur cette liste, mais cela ne garantit pas qu'elles soient disponibles, car l'ANSM recense surtout les médicaments d'intérêt thérapeutique majeur. Seul votre pharmacien ou votre médecin peut vous dire quoi faire pour votre traitement. Sources : ANSM (données récupérées le 28/10/2026) et BDPM (version du 29/09/2026).",
	},
	{
		question: "« Quels sont les médicaments en tension pour la cardiologie ? »",
		answer:
			"L'ANSM recense 23 médicaments de cardiologie en tension d'approvisionnement. Parmi les plus récemment mis à jour, entre le 6 et le 26 octobre 2026 : Volibris (ambrisentan, à l'hôpital), Nifédipine Viatris LP 30 mg (retour prévu début décembre 2026), Tarka LP 240/2 mg (février 2027), Winrevair 60 mg, Adempas 0,5 mg (novembre 2026) et Modamide 5 mg (janvier 2027). Plusieurs traitements courants sont aussi concernés : furosémide 20 et 40 mg en comprimés, propranolol 40 mg, trandolapril 2 et 4 mg, aspirine 75 mg gastro-résistante (en rupture à l'hôpital), clopidogrel 75 mg et Calciparine (héparine calcique, plusieurs dosages). La liste comprend également Nilemdo, Repatha, Praluent, bosentan 125 mg, nitrendipine, Dobutamine Panpharma (à l'hôpital), Colchimax et Colchicine Opocalcium. Sources : ANSM (données récupérées le 28/10/2026) et BDPM (version du 29/09/2026) ; un médicament absent de la liste n'est pas forcément disponible. Pour toute question sur un traitement, parlez-en à votre pharmacien ou à votre médecin.",
	},
	{
		question: "« Par quoi remplacer le Brevibloc ? »",
		answer:
			"Je ne peux pas vous indiquer de remplaçant : seul un médecin ou un pharmacien (ici, la pharmacie hospitalière) peut choisir une alternative. D'après l'ANSM (fiche mise à jour le 26/10/2026), Brevibloc 100 mg/10 ml en flacon injectable est en rupture de stock à l'hôpital, avec un retour prévu courant 2027 : https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/brevibloc-100-mg-10-ml-solution-injectable-en-flacon-esmolol-chlorhydrate-d. Brevibloc 10 mg/ml en solution pour perfusion ne figure pas dans la liste des ruptures de l'ANSM, mais ça ne garantit pas qu'il soit disponible. Sources : ANSM (données récupérées le 28/10/2026) et BDPM (version du 29/09/2026).",
	},
];

const EXAMPLES_HTML = EXAMPLES.map((e) => `<dt>${escapeText(e.question)}</dt>\n<dd>${escapeText(e.behaviour)}</dd>`).join("\n");

const REAL_ANSWERS_HTML = REAL_ANSWERS.map(
	(a) => `<figure>\n<figcaption>${escapeText(a.question)}</figcaption>\n<blockquote>${escapeText(a.answer)}</blockquote>\n</figure>`,
).join("\n");

const CURSOR_CONFIG = JSON.stringify({ mcpServers: { "ruptures-medicaments": { url: MCP_ENDPOINT } } }, null, 2);

/** The static landing page served at `GET /`. */
export const LANDING_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ruptures de médicaments (France)</title>
<meta name="description" content="MCP server: medicine shortages in France (ANSM + BDPM).">
<style>
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1a1a1a; --muted: #5a5a5a; --code: #f3f3f3; --link: #0b57d0; --warn-bg: #fff4e5; --warn-border: #b45309; --warn-fg: #5c2c00; }
@media (prefers-color-scheme: dark) { :root { --bg: #121212; --fg: #e8e8e8; --muted: #a8a8a8; --code: #222222; --link: #8ab4f8; --warn-bg: #2b1d0e; --warn-border: #f59e0b; --warn-fg: #fde7c8; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 .25rem; }
h2 { font-size: 1.15rem; margin: 2rem 0 .5rem; }
.subtitle { color: var(--muted); margin: 0 0 1.5rem; }
a { color: var(--link); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; background: var(--code); border-radius: 4px; }
code { padding: .1em .3em; overflow-wrap: anywhere; }
pre { padding: .75rem; overflow-x: auto; }
pre code { padding: 0; background: none; }
ul { padding-left: 1.25rem; }
.banner { background: var(--warn-bg); color: var(--warn-fg); border-left: 4px solid var(--warn-border); padding: .75rem 1rem; border-radius: 4px; margin: 0 0 1.5rem; }
blockquote { margin: .5rem 0 1rem; padding: .5rem 1rem; border-left: 3px solid var(--muted); overflow-wrap: anywhere; }
.note { color: var(--muted); font-size: .9em; }
</style>
</head>
<body>
<main>
<h1>Ruptures de médicaments (France)</h1>
<p class="subtitle">MCP server: medicine shortages in France (ANSM + BDPM).</p>
<div class="banner" role="note">
<p lang="fr"><strong>Information uniquement, pas un avis médical.</strong> Ce service ne remplace pas votre médecin ou votre pharmacien : demandez-leur toujours conseil avant de modifier, remplacer ou arrêter un traitement.</p>
<p lang="en"><strong>Information only, not medical advice.</strong> This service does not replace your doctor or pharmacist: always ask them before changing, replacing or stopping a treatment.</p>
</div>

<h2>What it is</h2>
<p>A free, read-only MCP server that lets AI assistants answer questions about medicine shortages in France: whether a medicine is in shortage or under supply tension, when it is expected back, what changed recently and whether it is a medicine of major therapeutic interest (MITM). Data comes from the ANSM shortage list and the BDPM public medicine database.</p>

<h2>Endpoint</h2>
<p><code>${MCP_ENDPOINT}</code></p>

<h2>Connect</h2>
<ul>
<li><strong>Claude:</strong> add a custom connector with the URL <code>${MCP_ENDPOINT}</code>.</li>
<li><strong>Cursor:</strong> add it to <code>mcp.json</code>:
<pre><code>${CURSOR_CONFIG}</code></pre></li>
<li><strong>Any MCP client</strong> supporting streamable HTTP: use the endpoint URL above.</li>
</ul>

<h2>Tools</h2>
<ul>
<li><code>search_medicine</code>: find a medicine and see if it is in shortage.</li>
<li><code>get_availability</code>: shortage status, expected return and history.</li>
<li><code>list_current_shortages</code>: current shortages with filters.</li>
<li><code>recent_changes</code>: what changed in the last days.</li>
<li><code>is_major_therapeutic_interest</code>: MITM status.</li>
</ul>

<h2>Exemples / Examples</h2>
<dl>
${EXAMPLES_HTML}
</dl>
<h3>Réponses réelles / Real answers</h3>
<p class="note">${escapeText(REAL_ANSWERS_NOTE)}</p>
${REAL_ANSWERS_HTML}

<h2>Coverage</h2>
<p>${COVERAGE_NOTE}</p>
<p>${DISCLAIMER}</p>

<h2>Sources</h2>
<ul>
<li>ANSM: <a href="${ANSM_SOURCE_URL}">${ANSM_SOURCE_URL}</a></li>
<li>BDPM: <a href="${BDPM_SOURCE_URL}">${BDPM_SOURCE_URL}</a></li>
</ul>
<p>Données ANSM mises à jour quotidiennement, BDPM mensuellement — dates exactes sur <a href="/health">/health</a>.</p>
<p>${NON_ENDORSEMENT}</p>

<h2>Licence</h2>
<p>Code under the MIT licence. Data under the terms of its sources: ANSM (no alteration, source and update date cited) and BDPM (Licence Ouverte, no alteration, source and update date cited).</p>

<h2>Privacy</h2>
<ul>
<li>No accounts, cookies or emails.</li>
<li>Cloudflare Analytics Engine stores only: tool name, success/error, latency, the BDPM CIS when present, and the date.</li>
<li>No IP, query text or user agent.</li>
<li>Cloudflare request logs keep their default retention and are not exported.</li>
</ul>

<h2>Links</h2>
<ul>
<li>Source code: <a href="${REPO_URL}">${REPO_URL}</a></li>
<li>Issues: <a href="${REPO_URL}/issues">${REPO_URL}/issues</a></li>
</ul>
</main>
</body>
</html>
`;

/** `GET /`: the landing page. */
export function handleLanding(): Response {
	return new Response(LANDING_HTML, {
		headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
	});
}
