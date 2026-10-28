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
		examplesId: "exemples",
		examplesHeading: "Exemples",
		examples: EXAMPLES,
		realAnswersHeading: "Réponses réelles",
		realAnswersNote: REAL_ANSWERS_NOTE,
		realAnswers: REAL_ANSWERS,
		connectHeading: "Se connecter",
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
		connectHeading: "Connect",
		connectClaude: "In Claude, open Customize > Connectors, choose Add custom connector, paste the address above and select No sign-in.",
		connectClaudeCode: "In a terminal:",
		connectCursor: "In mcp.json:",
		connectOther: "Any other MCP client that supports Streamable HTTP works with the address above.",
		toolsHeading: "Tools",
		toolsHeaders: ["Tool", "What it answers"],
		tools: [
			"Finds a medicine by name or active substance and shows whether it is in shortage.",
			"Gives a medicine's status: shortage or tension, announced return date, history.",
			"Lists current shortages and tensions, by status, pharmacy or hospital, or medical area.",
			"Shows what changed in the last days.",
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
			{ source: "ANSM", url: ANSM_SOURCE_URL, content: "Shortages, tensions, returns", updated: "Daily" },
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

/** Renders the example questions as `<dt>`/`<dd>` pairs, every text escaped. */
export function renderExamples(examples: readonly Example[]): string {
	return examples.map((e) => `<dt>${escapeText(e.question)}</dt>\n<dd>${escapeText(e.behaviour)}</dd>`).join("\n");
}

/** Renders the real answers as question/answer exchanges, every text escaped. */
export function renderRealAnswers(answers: readonly RealAnswer[]): string {
	return answers
		.map((a) => `<div class="exchange">\n<p class="q">${escapeText(a.question)}</p>\n<blockquote class="a">${escapeText(a.answer)}</blockquote>\n</div>`)
		.join("\n");
}

const CLAUDE_CODE_COMMAND = `claude mcp add --transport http ruptures-medicaments ${MCP_ENDPOINT}`;
const CURSOR_CONFIG = JSON.stringify({ mcpServers: { "ruptures-medicaments": { url: MCP_ENDPOINT } } }, null, 2);

const UI_FONT = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const TEXT_FONT = `Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif`;
const CODE_FONT = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

export const CSS = `:root { color-scheme: light dark; --bg: #FBFAF7; --surface: #FFFFFF; --fg: #1C1B19; --muted: #6B6862; --border: #E4E1DA; --accent: #0F5E57; --code-bg: #F3F1EC; --notice-bg: #FFF4DB; --notice-border: #E8C66A; --notice-fg: #5C4300; }
@media (prefers-color-scheme: dark) { :root { --bg: #141413; --surface: #1C1B19; --fg: #ECEAE4; --muted: #9C988F; --border: #2E2C28; --accent: #5FB3A8; --code-bg: #1F1E1B; --notice-bg: #2E2610; --notice-border: #6B5420; --notice-fg: #F0D58A; } }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: ${TEXT_FONT}; font-size: 17px; line-height: 1.6; }
main { max-width: 720px; margin: 0 auto; padding: 0 16px 48px; }
h1, h2, h3 { font-family: ${TEXT_FONT}; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; }
h1 { font-size: 30px; margin: 0; }
h2 { font-size: 21px; margin: 24px 0 12px; }
h3 { font-size: 17px; margin: 24px 0 8px; }
a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
code, pre { font-family: ${CODE_FONT}; font-size: 14px; }
code { background: var(--code-bg); border-radius: 4px; padding: 1px 4px; }
pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin: 0; overflow-x: auto; text-align: left; }
pre code { background: none; padding: 0; border-radius: 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.notice { background: var(--notice-bg); color: var(--notice-fg); border-bottom: 1px solid var(--notice-border); padding: 12px 16px; }
.notice p { max-width: 720px; margin: 0 auto; }
header { display: grid; grid-template-columns: 1fr auto; column-gap: 16px; align-items: baseline; padding-top: 32px; }
header > * { grid-column: 1 / -1; }
header h1 { grid-column: 1; grid-row: 1; }
header nav { grid-column: 2; grid-row: 1; }
.lang { font-family: ${UI_FONT}; font-size: 14px; }
.lang a[aria-current="true"] { font-weight: 700; text-decoration: none; }
.endpoint { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.endpoint code { background: none; padding: 0; overflow-wrap: anywhere; }
.pill { font-family: ${UI_FONT}; font-size: 12px; font-weight: 600; color: var(--accent); background: var(--surface); border: 1px solid var(--accent); border-radius: 4px; padding: 1px 6px; }
.copy { height: 28px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--fg); font-family: ${UI_FONT}; font-size: 13px; padding: 0 10px; cursor: pointer; }
.copy:hover { border-color: var(--accent); }
.copy:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.snippet { text-align: right; }
.snippet .copy { margin-bottom: 8px; }
section { margin-top: 48px; border-top: 1px solid var(--border); }
dt { font-weight: 600; }
dd { margin: 0 0 12px; }
.note { color: var(--muted); }
.q { max-width: 85%; margin-left: auto; margin-right: 0; background: var(--code-bg); border-radius: 12px; padding: 8px 12px; width: fit-content; }
.a { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin: 8px 0 24px 0; overflow-wrap: anywhere; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid var(--border); background: var(--surface); padding: 8px 12px; text-align: left; vertical-align: top; }
th { font-family: ${UI_FONT}; font-size: 14px; font-weight: 600; }
footer { margin-top: 48px; font-family: ${UI_FONT}; font-size: 14px; color: var(--muted); }`;

const SCRIPT = `document.addEventListener("DOMContentLoaded", function () {
	document.querySelectorAll("button.copy").forEach(function (b) {
		b.hidden = false;
		var label = b.textContent;
		b.addEventListener("click", function () {
			try {
				navigator.clipboard.writeText(b.dataset.copy).then(function () {
					b.textContent = b.dataset.done;
					setTimeout(function () { b.textContent = label; }, 1500);
				}, function () {});
			} catch (e) {}
		});
	});
});`;

function copyButton(c: LandingCopy, value: string): string {
	return `<button type="button" class="copy" data-copy="${escapeAttribute(value)}" data-done="${escapeAttribute(c.copied)}" hidden>${escapeText(c.copy)}</button>`;
}

function snippet(c: LandingCopy, code: string): string {
	return `<div class="snippet">\n${copyButton(c, code)}\n<pre><code>${escapeText(code)}</code></pre>\n</div>`;
}

function langLink(lang: Lang, current: Lang): string {
	const aria = lang === current ? ` aria-current="true"` : "";
	return `<a href="/?lang=${lang}" hreflang="${lang}" lang="${lang}"${aria}>${lang.toUpperCase()}</a>`;
}

/** The landing page served at `GET /`, in one language. */
export function renderLanding(lang: Lang): string {
	const c = COPY[lang];
	const t = escapeText;
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
<p><strong>${t(c.noticeLead)}</strong> ${t(c.notice)}</p>
</div>
<main>
<header>
<h1>Ruptures de médicaments (France)</h1>
<p>${t(c.lead)}</p>
<div class="endpoint">
<span class="visually-hidden">${t(c.endpointLabel)}</span>
<span class="pill">MCP</span>
<code>${t(MCP_ENDPOINT)}</code>
${copyButton(c, MCP_ENDPOINT)}
</div>
<nav class="lang" aria-label="Langue / Language">${langLink("fr", lang)} | ${langLink("en", lang)}</nav>
</header>

<section id="${c.examplesId}">
<h2>${t(c.examplesHeading)}</h2>
<dl>
${renderExamples(c.examples)}
</dl>
<h3>${t(c.realAnswersHeading)}</h3>
<p class="note">${t(c.realAnswersNote)}</p>
${renderRealAnswers(c.realAnswers)}
</section>

<section>
<h2>${t(c.connectHeading)}</h2>
<h3>Claude</h3>
<p>${t(c.connectClaude)}</p>
<h3>Claude Code</h3>
<p>${t(c.connectClaudeCode)}</p>
${snippet(c, CLAUDE_CODE_COMMAND)}
<h3>Cursor</h3>
<p>${t(c.connectCursor)}</p>
${snippet(c, CURSOR_CONFIG)}
<p>${t(c.connectOther)}</p>
</section>

<section>
<h2>${t(c.toolsHeading)}</h2>
<div class="table-wrap">
<table>
<thead><tr><th>${t(c.toolsHeaders[0])}</th><th>${t(c.toolsHeaders[1])}</th></tr></thead>
<tbody>
${c.tools.map((tool) => `<tr><td><code>${tool.name}</code></td><td>${t(tool.description)}</td></tr>`).join("\n")}
</tbody>
</table>
</div>
</section>

<section>
<h2>${t(c.limitsHeading)}</h2>
<ul>
${c.limits.map((item) => `<li>${t(item)}</li>`).join("\n")}
</ul>
</section>

<section>
<h2>${t(c.dataHeading)}</h2>
<div class="table-wrap">
<table>
<thead><tr>${c.dataHeaders.map((h) => `<th>${t(h)}</th>`).join("")}</tr></thead>
<tbody>
${c.dataRows.map((r) => `<tr><td><a href="${escapeAttribute(r.url)}">${t(r.source)}</a></td><td>${t(r.content)}</td><td>${t(r.updated)}</td></tr>`).join("\n")}
</tbody>
</table>
</div>
<p>${t(c.lastUpdate)} <a href="/health">/health</a></p>
<p>${t(c.licence)}</p>
</section>

<footer>
<p>${t(c.privacy)}</p>
<p>${t(c.maintainer)}</p>
<p>${t(c.nonEndorsement)}</p>
<p><a href="${REPO_URL}">${t(c.linkSource)}</a> · <a href="${REPO_URL}/issues">${t(c.linkIssues)}</a> · <a href="/health">${t(c.linkStatus)}</a></p>
</footer>
</main>
<script>
${SCRIPT}
</script>
</body>
</html>
`;
}
