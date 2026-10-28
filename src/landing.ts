import { escapeAttribute, escapeText } from "entities/escape";
import { ANSM_SOURCE_URL, BDPM_SOURCE_URL } from "./mcp/envelope";

export const SITE_URL = "https://ruptures-medicaments.a3e.dev";
export const MCP_ENDPOINT = `${SITE_URL}/mcp`;
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

export type Lang = "fr" | "en";

type Example = { question: string; behaviour: string };
type RealAnswer = { question: string; answer: string };

/** Every visible text of the landing page, for one language. */
export interface LandingCopy {
	noticeLead: string;
	notice: string;
	lead: string;
	endpointLabel: string;
	copy: string;
	copied: string;
	copyEndpointLabel: string;
	copyCommandLabel: string;
	copyConfigLabel: string;
	examplesId: string;
	examplesHeading: string;
	examples: readonly Example[];
	realAnswersHeading: string;
	realAnswersNote: string;
	realAnswers: readonly RealAnswer[];
	connectHeading: string;
	connectClaude: string;
	connectClaudeCode: string;
	connectCursor: string;
	connectOther: string;
	toolsHeading: string;
	toolsHeaders: readonly [string, string];
	tools: readonly { name: string; description: string }[];
	limitsHeading: string;
	limits: readonly string[];
	dataHeading: string;
	dataHeaders: readonly [string, string, string];
	dataRows: readonly { source: string; url: string; content: string; updated: string }[];
	lastUpdate: string;
	licence: string;
	privacy: string;
	maintainer: string;
	nonEndorsement: string;
	linkSource: string;
	linkIssues: string;
	linkStatus: string;
}

const TOOL_NAMES = ["search_medicine", "get_availability", "list_current_shortages", "recent_changes", "is_major_therapeutic_interest"] as const;

export const COPY: Record<Lang, LandingCopy> = {
	fr: {
		noticeLead: "Attention :",
		notice:
			"information uniquement, pas un avis médical. Ce service ne remplace pas votre médecin ou votre pharmacien : demandez-leur toujours conseil avant de modifier, remplacer ou arrêter un traitement.",
		lead: "Un serveur MCP gratuit, en lecture seule, qui permet aux assistants IA de consulter les ruptures et tensions d'approvisionnement de médicaments publiées par l'ANSM, avec les codes officiels de la base publique des médicaments (BDPM).",
		endpointLabel: "Adresse du serveur MCP",
		copy: "Copier",
		copied: "Copié",
		copyEndpointLabel: "Copier l'adresse du serveur",
		copyCommandLabel: "Copier la commande",
		copyConfigLabel: "Copier la configuration",
		examplesId: "exemples",
		examplesHeading: "Exemples",
		examples: EXAMPLES,
		realAnswersHeading: "Réponses réelles",
		realAnswersNote: REAL_ANSWERS_NOTE,
		realAnswers: REAL_ANSWERS,
		connectHeading: "Ajouter le serveur",
		connectClaude:
			"Dans Claude, ouvrez Customize > Connectors, choisissez Add custom connector, collez l'adresse ci-dessus et sélectionnez No sign-in.",
		connectClaudeCode: "Dans un terminal :",
		connectCursor: "Dans le fichier mcp.json :",
		connectOther: "Tout autre client MCP compatible Streamable HTTP fonctionne avec l'adresse ci-dessus.",
		toolsHeading: "Outils",
		toolsHeaders: ["Outil", "Ce qu'il répond"],
		tools: [
			"Trouve un médicament par son nom ou sa substance et indique s'il est en rupture.",
			"Donne le statut d'un médicament : rupture ou tension, date de retour annoncée, historique.",
			"Liste les ruptures et tensions en cours, par statut, ville ou hôpital, ou domaine médical.",
			"Montre ce qui a changé ces derniers jours.",
			"Indique si un médicament est d'intérêt thérapeutique majeur (MITM).",
		].map((description, i) => ({ name: TOOL_NAMES[i], description })),
		limitsHeading: "Ce que ce service ne fait pas",
		limits: [
			"Il ne donne aucun conseil médical : pas de remplacement, pas de changement de dose, pas d'arrêt de traitement.",
			"Il ne connaît pas le stock des pharmacies : les données de l'ANSM sont nationales.",
			"Un médicament absent de la liste n'est pas forcément disponible : l'ANSM publie surtout les ruptures de médicaments d'intérêt thérapeutique majeur déclarées par les fabricants.",
		],
		dataHeading: "Données",
		dataHeaders: ["Source", "Contenu", "Mise à jour"],
		dataRows: [
			{ source: "ANSM", url: ANSM_SOURCE_URL, content: "Ruptures, tensions, remises à disposition", updated: "Chaque jour" },
			{ source: "BDPM", url: BDPM_SOURCE_URL, content: "Médicaments, substances, liste MITM", updated: "Chaque mois" },
		],
		lastUpdate: "Date exacte de la dernière mise à jour :",
		licence:
			"Code sous licence MIT. Données réutilisées selon les conditions de leurs sources : sans modification, avec la source et la date de mise à jour.",
		privacy:
			"Pas de compte, pas de cookie. Pour chaque appel, seuls le nom de l'outil, le résultat (succès ou erreur), la durée, le code CIS s'il y en a un et la date sont enregistrés. Ni adresse IP, ni texte des questions.",
		maintainer: "Service indépendant, maintenu par Amine Benseddik.",
		nonEndorsement: NON_ENDORSEMENT,
		linkSource: "Code source",
		linkIssues: "Signaler un problème",
		linkStatus: "État du service",
	},
	en: {
		noticeLead: "Warning:",
		notice:
			"information only, not medical advice. This service does not replace your doctor or pharmacist: always ask them before changing, replacing or stopping a treatment.",
		lead: "A free, read-only MCP server that lets AI assistants look up the medicine shortages and supply problems published by the French medicines agency (ANSM), with the official codes from the French public medicines database (BDPM).",
		endpointLabel: "MCP server address",
		copy: "Copy",
		copied: "Copied",
		copyEndpointLabel: "Copy the server address",
		copyCommandLabel: "Copy the command",
		copyConfigLabel: "Copy the configuration",
		examplesId: "examples",
		examplesHeading: "Examples",
		examples: [
			{
				question: '"Is Aspirin in shortage?"',
				behaviour: "Shortage status from ANSM, the announced return date, the ANSM page and its update date.",
			},
			{
				question: '"Which cardiology medicines are under supply tension?"',
				behaviour: "The ANSM list of supply tensions in cardiology, with announced return dates.",
			},
			{
				question: '"What changed this week?"',
				behaviour: "New shortages, returns and changed return dates detected by the service.",
			},
			{
				question: '"Is amoxicillin a medicine of major therapeutic interest?"',
				behaviour: "Whether the medicine is on the BDPM list of medicines of major therapeutic interest (MITM).",
			},
			{
				question: "\"My medicine isn't listed, so it's available?\"",
				behaviour: "No: not being listed does not mean it is available; ask your pharmacist.",
			},
			{
				question: '"What can I take instead of Brevibloc?"',
				behaviour: "Refusal: no replacement is suggested; only a doctor or pharmacist can choose an alternative.",
			},
		],
		realAnswersHeading: "Real answers",
		realAnswersNote:
			"Answers from Claude through this server, captured on 28 October 2026 with an instruction to answer in a few sentences. The data may have changed since.",
		realAnswers: [
			{
				question: '"Is Aspirin in shortage in France?"',
				answer:
					"Only one aspirin product is in shortage: ASPIRINE ARROW 75 mg gastro-resistant tablets are listed in tension d'approvisionnement (strained supply) in pharmacies and in rupture (out of stock) in hospitals, and no return date has been set. No other aspirin product appears in the ANSM shortage list, but ANSM mainly lists shortages of essential medicines that manufacturers declare, so \"not listed\" doesn't guarantee it's in stock. Source: ANSM (entry updated 2026-05-21, data fetched 2026-10-28) — https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/acide-acetylsalicylique-75-mg-comprime-gastro-resistant-acide-acetylsalicylique. If you take this product, only your pharmacist or doctor can decide on any change to your treatment.",
			},
			{
				question: '"Which cardiology medicines are under supply tension in France?"',
				answer:
					'ANSM currently lists 23 cardiology medicines with a "tension d\'approvisionnement" (supply tension) status. The most recent updates (October 2026) cover ambrisentan (Volibris, hospital), Nifédipine Viatris LP 30 mg (expected back early December 2026), Tarka LP 240/2 mg (February 2027), Winrevair, Adempas 0.5 mg (November 2026) and Modamide 5 mg (January 2027). Also listed are furosemide 20/40 mg tablets, Nilemdo, several Calciparine/calcium heparin presentations, nitrendipine, dobutamine Panpharma (hospital, December 2026), Repatha 140 mg and Praluent, bosentan 125 mg, and trandolapril 2/4 mg (December 2026). The list also includes propranolol 40 mg, Tarka LP 240/4 mg, aspirin 75 mg (out of stock in hospitals), clopidogrel 75 mg, and Colchimax and Colchicine Opocalcium. Many of these have no return date, and a few entries were last updated in 2024–2025, so check each one\'s ANSM page at https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments. Source: ANSM, ingested 2026-10-28, with BDPM 2026-09-29; ANSM mainly lists medicines of major therapeutic interest, so a medicine missing from the list may still be short, and any change to a treatment is for a pharmacist or doctor to decide.',
			},
			{
				question: '"What can I take instead of Brevibloc?"',
				answer:
					"I can't suggest a replacement for Brevibloc; only your doctor or the hospital pharmacist can choose one. ANSM lists Brevibloc 100 mg/10 ml injectable solution as out of stock in hospitals, with supply expected back sometime in 2027 (ANSM, updated 2026-10-26: https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/brevibloc-100-mg-10-ml-solution-injectable-en-flacon-esmolol-chlorhydrate-d). Brevibloc 10 mg/ml infusion solution has no shortage listed, but ANSM mainly lists shortages reported by manufacturers, so that doesn't guarantee it's available. Source: ANSM data retrieved 2026-10-28 and BDPM release 2026-09-29.",
			},
		],
		connectHeading: "Add the server",
		connectClaude: "In Claude, open Customize > Connectors, choose Add custom connector, paste the address above and select No sign-in.",
		connectClaudeCode: "In a terminal:",
		connectCursor: "In mcp.json:",
		connectOther: "Any other MCP client that supports Streamable HTTP works with the address above.",
		toolsHeading: "Tools",
		toolsHeaders: ["Tool", "What it answers"],
		tools: [
			"Finds a medicine by name or active substance and shows whether it is in shortage.",
			"Gives a medicine's status: shortage or supply problem, announced return date, history.",
			"Lists current shortages and supply problems, by status, pharmacy or hospital, or medical area.",
			"Shows what changed in the last few days.",
			"Tells whether a medicine is of major therapeutic interest (MITM).",
		].map((description, i) => ({ name: TOOL_NAMES[i], description })),
		limitsHeading: "What this service does not do",
		limits: [
			"It gives no medical advice: no replacement, no dose change, no stopping a treatment.",
			"It does not know pharmacy stock: ANSM data is national.",
			"A medicine missing from the list is not necessarily available: ANSM mainly publishes shortages of medicines of major therapeutic interest declared by manufacturers.",
		],
		dataHeading: "Data",
		dataHeaders: ["Source", "Content", "Updated"],
		dataRows: [
			{ source: "ANSM", url: ANSM_SOURCE_URL, content: "Shortages, supply problems, returns", updated: "Daily" },
			{ source: "BDPM", url: BDPM_SOURCE_URL, content: "Medicines, substances, MITM list", updated: "Monthly" },
		],
		lastUpdate: "Exact date of the last update:",
		licence: "Code under the MIT licence. Data reused under the terms of its sources: unaltered, with the source and update date.",
		privacy:
			"No accounts, no cookies. For each call, only the tool name, the result (success or error), the duration, the CIS code when there is one and the date are stored. No IP address, no question text.",
		maintainer: "Independent service, maintained by Amine Benseddik.",
		nonEndorsement: "This service is not approved or endorsed by ANSM, HAS or UNCAM.",
		linkSource: "Source code",
		linkIssues: "Report a problem",
		linkStatus: "Service status",
	},
};

/** Picks the page language: `?lang=fr|en`, then the first `Accept-Language` tag, then French. */
export function resolveLang(url: URL, acceptLanguage: string | null): Lang {
	const param = url.searchParams.get("lang");
	if (param === "fr" || param === "en") return param;
	const first = (acceptLanguage ?? "").split(",")[0].split(";")[0].trim().toLowerCase();
	return first.startsWith("en") ? "en" : "fr";
}


/** French typography: a narrow no-break space (U+202F) before `: ; ? ! »` and after `«`, applied to escaped text. */
export function frenchSpacing(escaped: string): string {
	return escaped.replace(/ (?=[:;?!»])/g, " ").replace(/« /g, "« ");
}

/** Escapes a text for the page of `lang`, with French typography on the French page. */
export function formatText(lang: Lang): (s: string) => string {
	return lang === "fr" ? (s) => frenchSpacing(escapeText(s)) : escapeText;
}

/** Renders the example questions as `<dt>`/`<dd>` pairs, every text escaped. */
export function renderExamples(examples: readonly Example[], format: (s: string) => string = escapeText): string {
	return examples.map((e) => `<dt>${format(e.question)}</dt>\n<dd>${format(e.behaviour)}</dd>`).join("\n");
}

/** Renders the real answers as question/answer exchanges, every text escaped. */
export function renderRealAnswers(answers: readonly RealAnswer[], format: (s: string) => string = escapeText): string {
	return answers
		.map(
			(a) =>
				`<div class="exchange">\n<p class="q">${format(a.question)}</p>\n<blockquote class="a"><span class="who">Claude</span>${format(a.answer)}</blockquote>\n</div>`,
		)
		.join("\n");
}

const CLAUDE_CODE_COMMAND = `claude mcp add --transport http ruptures-medicaments ${MCP_ENDPOINT}`;
const CURSOR_CONFIG = JSON.stringify({ mcpServers: { "ruptures-medicaments": { url: MCP_ENDPOINT } } }, null, 2);

const UI_FONT = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const TEXT_FONT = `Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif`;
const CODE_FONT = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

export const CSS = `:root { color-scheme: light; --bg: #FBFAF7; --surface: #FFFFFF; --fg: #1C1B19; --muted: #5F5C56; --border: #E4E1DA; --accent: #0F5E57; --accent-soft: #E6F0EE; --code-bg: #F3F1EC; --notice-bg: #FFF4DB; --notice-border: #E8C66A; --notice-fg: #5C4300; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: ${TEXT_FONT}; font-size: 17px; line-height: 1.6; }
.wrap { max-width: 960px; margin: 0 auto; padding: 0 24px; }
h1, h2, h3 { font-family: ${UI_FONT}; font-weight: 600; }
h1 { font-size: 34px; letter-spacing: -0.02em; line-height: 1.15; margin: 0 0 16px; }
h2 { font-size: 22px; letter-spacing: -0.01em; line-height: 1.3; margin: 0 0 16px; }
h3 { font-size: 16px; line-height: 1.4; margin: 32px 0 8px; }
a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
code, pre { font-family: ${CODE_FONT}; font-size: 14px; }
code { background: var(--code-bg); border-radius: 4px; padding: 1px 4px; }
pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin: 0; overflow-x: auto; line-height: 1.5; }
pre code { background: none; padding: 0; border-radius: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.notice { background: var(--notice-bg); color: var(--notice-fg); border-bottom: 1px solid var(--notice-border); padding: 12px 0; font-family: ${UI_FONT}; font-size: 15px; line-height: 1.5; }
.notice p { margin: 0; }
header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 32px 0 40px; }
.top { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 40px; }
.site { font-family: ${UI_FONT}; font-size: 15px; font-weight: 600; color: var(--fg); text-decoration: none; }
.lang { font-family: ${UI_FONT}; font-size: 14px; color: var(--muted); }
.lang a[aria-current="true"] { font-weight: 700; text-decoration: none; }
.lead { font-size: 19px; color: var(--muted); max-width: 640px; margin: 0 0 24px; }
.endpoint { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; min-height: 48px; padding: 6px 6px 6px 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; max-width: 640px; box-sizing: border-box; }
.endpoint code { font-size: 15px; flex: 1; overflow-wrap: anywhere; background: none; padding: 0; }
.pill { font-family: ${UI_FONT}; font-size: 12px; font-weight: 600; line-height: 1.5; color: var(--accent); background: var(--surface); border: 1px solid var(--accent); border-radius: 4px; padding: 1px 6px; }
.copy { font-family: ${UI_FONT}; border-radius: 6px; cursor: pointer; }
.copy:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.primary { height: 36px; padding: 0 14px; background: var(--accent); color: #FFFFFF; border: none; font-size: 14px; font-weight: 600; }
.primary:hover { filter: brightness(1.1); }
.secondary { height: 30px; padding: 0 10px; background: transparent; border: 1px solid var(--muted); color: var(--fg); font-size: 13px; }
.secondary:hover { border-color: var(--accent); }
section { margin-top: 48px; padding-top: 32px; border-top: 1px solid var(--border); }
.body > :first-child { margin-top: 0; }
dl { margin: 0; }
dt { font-family: ${UI_FONT}; font-size: 16px; font-weight: 600; margin-top: 16px; }
dd { font-size: 16px; color: var(--muted); margin: 4px 0 0 0; }
.note { color: var(--muted); font-size: 15px; }
.small { font-size: 15px; }
.q { background: var(--accent-soft); color: var(--fg); border-radius: 12px 12px 4px 12px; padding: 10px 14px; margin: 0 0 0 auto; width: fit-content; max-width: 85%; font-family: ${TEXT_FONT}; font-size: 16px; }
.a { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 18px; margin: 8px 0 28px; overflow-wrap: anywhere; }
.who { display: block; font-family: ${UI_FONT}; font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 6px; }
.snippet { margin-top: 32px; }
.snippet-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.snippet h3 { margin: 0; }
.snippet p { margin: 8px 0 12px; }
li + li { margin-top: 8px; }
.table-wrap { border: 1px solid var(--border); border-radius: 8px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 10px 14px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
th { background: var(--code-bg); font-family: ${UI_FONT}; font-size: 14px; font-weight: 600; }
td { background: var(--surface); }
tbody tr:last-child td { border-bottom: none; }
td code { overflow-wrap: anywhere; }
footer { background: var(--surface); border-top: 1px solid var(--border); margin-top: 64px; padding: 32px 0; font-family: ${UI_FONT}; font-size: 14px; color: var(--muted); }
footer p { margin: 0 0 8px; max-width: 560px; }
.links { list-style: none; margin: 0; padding: 0; }
.links li + li { margin-top: 6px; }
@media (max-width: 599px) { .wrap { padding: 0 16px; } }
@media (min-width: 900px) { section { display: grid; grid-template-columns: 220px 1fr; column-gap: 48px; margin-top: 64px; } footer .wrap { display: grid; grid-template-columns: 1fr auto; column-gap: 48px; } }`;

const SCRIPT = `document.addEventListener("DOMContentLoaded", function () {
	if (!(navigator.clipboard && navigator.clipboard.writeText)) return;
	var live = document.querySelector("p[aria-live]");
	document.querySelectorAll("button.copy").forEach(function (b) {
		b.hidden = false;
		var label = b.textContent;
		b.addEventListener("click", function () {
			navigator.clipboard.writeText(b.dataset.copy).then(function () {
				b.textContent = b.dataset.done;
				live.textContent = b.dataset.done;
				setTimeout(function () { b.textContent = label; }, 1500);
			}, function () {});
		});
	});
});`;

function copyButton(c: LandingCopy, kind: "primary" | "secondary", value: string, label: string): string {
	return `<button type="button" class="copy ${kind}" data-copy="${escapeAttribute(value)}" data-done="${escapeAttribute(c.copied)}" aria-label="${escapeAttribute(label)}" hidden>${escapeText(c.copy)}</button>`;
}

function snippet(c: LandingCopy, t: (s: string) => string, client: string, sentence: string, code?: { value: string; label: string }): string {
	const button = code ? `\n${copyButton(c, "secondary", code.value, code.label)}` : "";
	const pre = code ? `\n<pre><code>${escapeText(code.value)}</code></pre>` : "";
	return `<div class="snippet">\n<div class="snippet-head">\n<h3>${client}</h3>${button}\n</div>\n<p>${t(sentence)}</p>${pre}\n</div>`;
}

function langLink(lang: Lang, current: Lang): string {
	const aria = lang === current ? ` aria-current="true"` : "";
	return `<a href="/?lang=${lang}" hreflang="${lang}" lang="${lang}"${aria}>${lang.toUpperCase()}</a>`;
}

/** The landing page served at `GET /`, in one language. */
export function renderLanding(lang: Lang): string {
	const c = COPY[lang];
	const t = formatText(lang);
	const fr = lang === "fr" ? "" : ` lang="fr"`;
	return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ruptures de médicaments (France)</title>
<meta name="description" content="${escapeAttribute(c.lead)}">
<link rel="alternate" hreflang="fr" href="${SITE_URL}/?lang=fr">
<link rel="alternate" hreflang="en" href="${SITE_URL}/?lang=en">
<link rel="alternate" hreflang="x-default" href="${SITE_URL}/">
<style>
${CSS}
</style>
</head>
<body>
<div class="notice" role="note">
<div class="wrap"><p><strong>${t(c.noticeLead)}</strong> ${t(c.notice)}</p></div>
</div>
<header>
<div class="wrap">
<div class="top">
<a class="site" href="/?lang=${lang}"${fr}>Ruptures de médicaments</a>
<nav class="lang" aria-label="Langue / Language">${langLink("fr", lang)} | ${langLink("en", lang)}</nav>
</div>
<h1${fr}>Ruptures de médicaments (France)</h1>
<p class="lead">${t(c.lead)}</p>
<div class="endpoint">
<span class="sr-only">${t(c.endpointLabel)}</span>
<span class="pill">MCP</span>
<code>${escapeText(MCP_ENDPOINT)}</code>
${copyButton(c, "primary", MCP_ENDPOINT, c.copyEndpointLabel)}
</div>
</div>
</header>
<main class="wrap">
<section id="${c.examplesId}">
<h2>${t(c.examplesHeading)}</h2>
<div class="body">
<dl>
${renderExamples(c.examples, t)}
</dl>
<h3>${t(c.realAnswersHeading)}</h3>
<p class="note">${t(c.realAnswersNote)}</p>
${renderRealAnswers(c.realAnswers, t)}
</div>
</section>

<section>
<h2>${t(c.connectHeading)}</h2>
<div class="body">
${snippet(c, t, "Claude", c.connectClaude)}
${snippet(c, t, "Claude Code", c.connectClaudeCode, { value: CLAUDE_CODE_COMMAND, label: c.copyCommandLabel })}
${snippet(c, t, "Cursor", c.connectCursor, { value: CURSOR_CONFIG, label: c.copyConfigLabel })}
<p>${t(c.connectOther)}</p>
</div>
</section>

<section>
<h2>${t(c.toolsHeading)}</h2>
<div class="body">
<div class="table-wrap">
<table>
<thead><tr><th>${t(c.toolsHeaders[0])}</th><th>${t(c.toolsHeaders[1])}</th></tr></thead>
<tbody>
${c.tools.map((tool) => `<tr><td><code>${tool.name}</code></td><td>${t(tool.description)}</td></tr>`).join("\n")}
</tbody>
</table>
</div>
</div>
</section>

<section>
<h2>${t(c.limitsHeading)}</h2>
<div class="body">
<ul>
${c.limits.map((item) => `<li>${t(item)}</li>`).join("\n")}
</ul>
</div>
</section>

<section>
<h2>${t(c.dataHeading)}</h2>
<div class="body">
<div class="table-wrap">
<table>
<thead><tr>${c.dataHeaders.map((h) => `<th>${t(h)}</th>`).join("")}</tr></thead>
<tbody>
${c.dataRows.map((r) => `<tr><td><a href="${escapeAttribute(r.url)}">${t(r.source)}</a></td><td>${t(r.content)}</td><td>${t(r.updated)}</td></tr>`).join("\n")}
</tbody>
</table>
</div>
<p class="small">${t(c.lastUpdate)} <a href="/health">/health</a></p>
<p class="small">${t(c.licence)}</p>
</div>
</section>
</main>
<footer>
<div class="wrap">
<div>
<p>${t(c.privacy)}</p>
<p>${t(c.maintainer)}</p>
<p>${t(c.nonEndorsement)}</p>
</div>
<ul class="links">
<li><a href="${REPO_URL}">${t(c.linkSource)}</a></li>
<li><a href="${REPO_URL}/issues">${t(c.linkIssues)}</a></li>
<li><a href="/health">${t(c.linkStatus)}</a></li>
</ul>
</div>
</footer>
<p class="sr-only" aria-live="polite"></p>
<script>
${SCRIPT}
</script>
</body>
</html>
`;
}
