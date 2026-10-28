import { exports } from "cloudflare:workers";
import { decodeHTML } from "entities/decode";
import { escapeAttribute, escapeText } from "entities/escape";
import { describe, expect, it } from "vitest";
import {
	COPY,
	CSS,
	EXAMPLES,
	type Lang,
	MCP_ENDPOINT,
	NON_ENDORSEMENT,
	REAL_ANSWERS,
	REAL_ANSWERS_NOTE,
	REPO_URL,
	renderExamples,
	renderLanding,
	renderRealAnswers,
	resolveLang,
} from "../src/landing";

const ORIGIN = "https://ruptures-medicaments.a3e.dev";
const LANGS: readonly Lang[] = ["fr", "en"];
const PAGES: Record<Lang, string> = { fr: renderLanding("fr"), en: renderLanding("en") };

const text = (html: string) => decodeHTML(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
/** Visible text of our own copy: no head, script, code, or Claude's real answers. */
const ownText = (html: string) =>
	text(
		html
			.replace(/<head>[\s\S]*?<\/head>/, "")
			.replace(/<script>[\s\S]*?<\/script>/g, "")
			.replace(/<pre>[\s\S]*?<\/pre>/g, "")
			.replace(/<code>[\s\S]*?<\/code>/g, "")
			.replace(/<div class="exchange">[\s\S]*?<\/div>/g, ""),
	);
const between = (html: string, start: string, end: string) => {
	const i = html.indexOf(start);
	expect(i).toBeGreaterThanOrEqual(0);
	return html.slice(i, html.indexOf(end, i) + end.length);
};

const CURSOR_JSON = `{
  "mcpServers": {
    "ruptures-medicaments": {
      "url": "${MCP_ENDPOINT}"
    }
  }
}`;
const CLAUDE_CODE = `claude mcp add --transport http ruptures-medicaments ${MCP_ENDPOINT}`;

const VERBATIM: Record<Lang, readonly string[]> = {
	fr: [
		"Attention : information uniquement, pas un avis médical. Ce service ne remplace pas votre médecin ou votre pharmacien : demandez-leur toujours conseil avant de modifier, remplacer ou arrêter un traitement.",
		"Un serveur MCP gratuit, en lecture seule, qui permet aux assistants IA de consulter les ruptures et tensions d'approvisionnement de médicaments publiées par l'ANSM, avec les codes officiels de la base publique des médicaments (BDPM).",
		"Adresse du serveur MCP",
		"Exemples",
		"Réponses réelles",
		REAL_ANSWERS_NOTE,
		"Se connecter",
		"Dans Claude, ouvrez Customize > Connectors, choisissez Add custom connector, collez l'adresse ci-dessus et sélectionnez No sign-in.",
		"Dans un terminal :",
		"Dans le fichier mcp.json :",
		"Tout autre client MCP compatible Streamable HTTP fonctionne avec l'adresse ci-dessus.",
		"Outils",
		"Outil",
		"Ce qu'il répond",
		"search_medicine Trouve un médicament par son nom ou sa substance et indique s'il est en rupture.",
		"get_availability Donne le statut d'un médicament : rupture ou tension, date de retour annoncée, historique.",
		"list_current_shortages Liste les ruptures et tensions en cours, par statut, ville ou hôpital, ou domaine médical.",
		"recent_changes Montre ce qui a changé ces derniers jours.",
		"is_major_therapeutic_interest Indique si un médicament est d'intérêt thérapeutique majeur (MITM).",
		"Ce que ce service ne fait pas",
		"Il ne donne aucun conseil médical : pas de remplacement, pas de changement de dose, pas d'arrêt de traitement.",
		"Il ne connaît pas le stock des pharmacies : les données de l'ANSM sont nationales.",
		"Un médicament absent de la liste n'est pas forcément disponible : l'ANSM publie surtout les ruptures de médicaments d'intérêt thérapeutique majeur déclarées par les fabricants.",
		"Données",
		"Source Contenu Mise à jour",
		"ANSM Ruptures, tensions, remises à disposition Chaque jour",
		"BDPM Médicaments, substances, liste MITM Chaque mois",
		"Date exacte de la dernière mise à jour : /health",
		"Code sous licence MIT. Données réutilisées selon les conditions de leurs sources : sans modification, avec la source et la date de mise à jour.",
		"Pas de compte, pas de cookie. Pour chaque appel, seuls le nom de l'outil, le résultat (succès ou erreur), la durée, le code CIS s'il y en a un et la date sont enregistrés. Ni adresse IP, ni texte des questions.",
		"Service indépendant, maintenu par Amine Benseddik.",
		NON_ENDORSEMENT,
		"Code source · Signaler un problème · État du service",
	],
	en: [
		"Warning: information only, not medical advice. This service does not replace your doctor or pharmacist: always ask them before changing, replacing or stopping a treatment.",
		"A free, read-only MCP server that lets AI assistants look up the medicine shortages and supply problems published by the French medicines agency (ANSM), with the official codes from the French public medicines database (BDPM).",
		"MCP server address",
		"Examples",
		"Real answers",
		"Answers from Claude through this server, captured on 28 October 2026 with an instruction to answer in a few sentences. The data may have changed since.",
		"Connect",
		"In Claude, open Customize > Connectors, choose Add custom connector, paste the address above and select No sign-in.",
		"In a terminal:",
		"In mcp.json:",
		"Any other MCP client that supports Streamable HTTP works with the address above.",
		"Tools",
		"Tool",
		"What it answers",
		"search_medicine Finds a medicine by name or active substance and shows whether it is in shortage.",
		"get_availability Gives a medicine's status: shortage or tension, announced return date, history.",
		"list_current_shortages Lists current shortages and tensions, by status, pharmacy or hospital, or medical area.",
		"recent_changes Shows what changed in the last days.",
		"is_major_therapeutic_interest Tells whether a medicine is of major therapeutic interest (MITM).",
		"What this service does not do",
		"It gives no medical advice: no replacement, no dose change, no stopping a treatment.",
		"It does not know pharmacy stock: ANSM data is national.",
		"A medicine missing from the list is not necessarily available: ANSM mainly publishes shortages of medicines of major therapeutic interest declared by manufacturers.",
		"Data",
		"Source Content Updated",
		"ANSM Shortages, tensions, returns Daily",
		"BDPM Medicines, substances, MITM list Monthly",
		"Exact date of the last update: /health",
		"Code under the MIT licence. Data reused under the terms of its sources: unaltered, with the source and update date.",
		"No accounts, no cookies. For each call, only the tool name, the result (success or error), the duration, the CIS code when there is one and the date are stored. No IP address, no question text.",
		"Independent service, maintained by Amine Benseddik.",
		"This service is not approved or endorsed by ANSM, HAS or UNCAM.",
		"Source code · Report a problem · Service status",
	],
};

const EXAMPLES_EN: readonly [string, string][] = [
	['"Is Aspirin in shortage?"', "Shortage status from ANSM, the announced return date, the ANSM page and its update date."],
	['"Which cardiology medicines are under supply tension?"', "The ANSM list of supply tensions in cardiology, with announced return dates."],
	['"What changed this week?"', "New shortages, returns and changed return dates detected by the service."],
	['"Is amoxicillin a medicine of major therapeutic interest?"', "Whether the medicine is on the BDPM list of medicines of major therapeutic interest (MITM)."],
	["\"My medicine isn't listed, so it's available?\"", "No: not being listed does not mean it is available; ask your pharmacist."],
	['"What can I take instead of Brevibloc?"', "Refusal: no replacement is suggested; only a doctor or pharmacist can choose an alternative."],
];

const REAL_ANSWERS_EN: readonly [string, string][] = [
	[
		'"Is Aspirin in shortage in France?"',
		"Only one aspirin product is in shortage: ASPIRINE ARROW 75 mg gastro-resistant tablets are listed in tension d'approvisionnement (strained supply) in pharmacies and in rupture (out of stock) in hospitals, and no return date has been set. No other aspirin product appears in the ANSM shortage list, but ANSM mainly lists shortages of essential medicines that manufacturers declare, so \"not listed\" doesn't guarantee it's in stock. Source: ANSM (entry updated 2026-05-21, data fetched 2026-10-28) — https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/acide-acetylsalicylique-75-mg-comprime-gastro-resistant-acide-acetylsalicylique. If you take this product, only your pharmacist or doctor can decide on any change to your treatment.",
	],
	[
		'"Which cardiology medicines are under supply tension in France?"',
		"ANSM currently lists 23 cardiology medicines with a \"tension d'approvisionnement\" (supply tension) status. The most recent updates (October 2026) cover ambrisentan (Volibris, hospital), Nifédipine Viatris LP 30 mg (expected back early December 2026), Tarka LP 240/2 mg (February 2027), Winrevair, Adempas 0.5 mg (November 2026) and Modamide 5 mg (January 2027). Also listed are furosemide 20/40 mg tablets, Nilemdo, several Calciparine/calcium heparin presentations, nitrendipine, dobutamine Panpharma (hospital, December 2026), Repatha 140 mg and Praluent, bosentan 125 mg, and trandolapril 2/4 mg (December 2026). The list also includes propranolol 40 mg, Tarka LP 240/4 mg, aspirin 75 mg (out of stock in hospitals), clopidogrel 75 mg, and Colchimax and Colchicine Opocalcium. Many of these have no return date, and a few entries were last updated in 2024–2025, so check each one's ANSM page at https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments. Source: ANSM, ingested 2026-10-28, with BDPM 2026-09-29; ANSM mainly lists medicines of major therapeutic interest, so a medicine missing from the list may still be short, and any change to a treatment is for a pharmacist or doctor to decide.",
	],
	[
		'"What can I take instead of Brevibloc?"',
		"I can't suggest a replacement for Brevibloc; only your doctor or the hospital pharmacist can choose one. ANSM lists Brevibloc 100 mg/10 ml injectable solution as out of stock in hospitals, with supply expected back sometime in 2027 (ANSM, updated 2026-10-26: https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/brevibloc-100-mg-10-ml-solution-injectable-en-flacon-esmolol-chlorhydrate-d). Brevibloc 10 mg/ml infusion solution has no shortage listed, but ANSM mainly lists shortages reported by manufacturers, so that doesn't guarantee it's available. Source: ANSM data retrieved 2026-10-28 and BDPM release 2026-09-29.",
	],
];

const get = (path: string, headers?: Record<string, string>) => exports.default.fetch(`${ORIGIN}${path}`, { headers });

describe("resolveLang", () => {
	const url = (q = "") => new URL(`${ORIGIN}/${q}`);
	it("lets ?lang=fr|en decide over the header", () => {
		expect(resolveLang(url("?lang=en"), "fr-FR,fr;q=0.9")).toBe("en");
		expect(resolveLang(url("?lang=fr"), "en-GB,en;q=0.9")).toBe("fr");
	});
	it("ignores any other lang value", () => {
		expect(resolveLang(url("?lang=de"), "en-US")).toBe("en");
		expect(resolveLang(url("?lang=EN"), null)).toBe("fr");
		expect(resolveLang(url("?lang="), "fr")).toBe("fr");
	});
	it("uses the first Accept-Language tag, lowercased, starting with en", () => {
		expect(resolveLang(url(), "en-GB,en;q=0.9")).toBe("en");
		expect(resolveLang(url(), "EN-us")).toBe("en");
		expect(resolveLang(url(), "en;q=0.8")).toBe("en");
		expect(resolveLang(url(), "de-DE,en;q=0.9")).toBe("fr");
		expect(resolveLang(url(), "fr-FR,en;q=0.9")).toBe("fr");
	});
	it("falls back to French without a header", () => {
		expect(resolveLang(url(), null)).toBe("fr");
		expect(resolveLang(url(), "")).toBe("fr");
	});
});

describe("GET /", () => {
	const branches: readonly [string, Record<string, string> | undefined, Lang][] = [
		["/?lang=en", { "Accept-Language": "fr-FR" }, "en"],
		["/?lang=fr", { "Accept-Language": "en-GB,en;q=0.9" }, "fr"],
		["/?lang=xx", { "Accept-Language": "en-GB" }, "en"],
		["/", { "Accept-Language": "en-GB,en;q=0.9" }, "en"],
		["/", { "Accept-Language": "de-DE" }, "fr"],
		["/", undefined, "fr"],
	];
	for (const [path, headers, lang] of branches) {
		it(`serves ${lang} for ${path} with ${JSON.stringify(headers ?? {})}`, async () => {
			const res = await get(path, headers);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
			expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
			expect(res.headers.get("vary")).toBe("Accept-Language");
			expect(res.headers.get("content-language")).toBe(lang);
			expect(res.headers.get("set-cookie")).toBeNull();
			expect(await res.text()).toBe(PAGES[lang]);
		});
	}

	it("rejects non-GET methods with 405", async () => {
		for (const method of ["POST", "PUT", "DELETE"]) {
			const res = await exports.default.fetch(`${ORIGIN}/`, { method });
			expect(res.status).toBe(405);
			expect(res.headers.get("allow")).toBe("GET");
		}
	});
});

describe.each(LANGS)("landing page (%s)", (lang) => {
	const html = PAGES[lang];
	const c = COPY[lang];
	const other = lang === "fr" ? "en" : "fr";

	it("sets html lang, title, description and hreflang links", () => {
		expect(html).toContain(`<html lang="${lang}">`);
		expect(html).toContain("<title>Ruptures de médicaments (France)</title>");
		expect(html).toContain(`<meta name="description" content="${escapeAttribute(VERBATIM[lang][1])}">`);
		expect(html).toContain(`<link rel="alternate" hreflang="fr" href="${ORIGIN}/?lang=fr">`);
		expect(html).toContain(`<link rel="alternate" hreflang="en" href="${ORIGIN}/?lang=en">`);
		expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`);
	});

	it("has a plain-link language switch marking the current language", () => {
		const nav = between(html, '<nav class="lang" aria-label="Langue / Language">', "</nav>");
		expect(text(nav).trim()).toBe("FR | EN");
		expect(nav).toContain(`<a href="/?lang=${lang}" hreflang="${lang}" lang="${lang}" aria-current="true">${lang.toUpperCase()}</a>`);
		expect(nav).toContain(`<a href="/?lang=${other}" hreflang="${other}" lang="${other}">${other.toUpperCase()}</a>`);
		expect(nav.match(/aria-current/g)).toHaveLength(1);
	});

	it("shows every text verbatim", () => {
		const visible = text(html);
		for (const s of VERBATIM[lang]) expect(visible).toContain(s);
		expect(html).toContain(`<strong>${escapeText(VERBATIM[lang][0].slice(0, VERBATIM[lang][0].indexOf(":") + 1))}</strong>`);
		expect(html).toContain(`<h1>Ruptures de médicaments (France)</h1>`);
		for (const client of ["Claude", "Claude Code", "Cursor"]) expect(html).toContain(`<h3>${client}</h3>`);
		const footer = between(html, "<footer>", "</footer>");
		expect(footer).toContain(`<a href="${REPO_URL}">`);
		expect(footer).toContain(`<a href="${REPO_URL}/issues">`);
		expect(footer).toContain(`<a href="/health">`);
		expect(html).toContain('<a href="https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments">ANSM</a>');
		expect(html).toContain('<a href="https://base-donnees-publique.medicaments.gouv.fr">BDPM</a>');
	});

	it("lists the six examples and the three real answers of the language", () => {
		const examples = lang === "fr" ? EXAMPLES.map((e) => [e.question, e.behaviour] as const) : EXAMPLES_EN;
		const answers = lang === "fr" ? REAL_ANSWERS.map((a) => [a.question, a.answer] as const) : REAL_ANSWERS_EN;
		expect(examples).toHaveLength(6);
		expect(answers).toHaveLength(3);
		for (const [q, b] of examples) {
			expect(html).toContain(`<dt>${escapeText(q)}</dt>\n<dd>${escapeText(b)}</dd>`);
		}
		for (const [q, a] of answers) {
			expect(html).toContain(`<div class="exchange">\n<p class="q">${escapeText(q)}</p>\n<blockquote class="a">${escapeText(a)}</blockquote>\n</div>`);
			expect(a).not.toMatch(/\*\*|\]\(/);
		}
		expect(html.match(/<div class="exchange">/g)).toHaveLength(3);
		expect(html).toContain(renderExamples(c.examples));
		expect(html).toContain(renderRealAnswers(c.realAnswers));
		expect(html).not.toContain("**");
		expect(html).not.toMatch(/<a [^>]*href="https:\/\/ansm\.sante\.fr\/disponibilites-des-produits-de-sante\/medicaments\/(acide|brevibloc)/);
		expect(html.indexOf(`<p class="note">${escapeText(c.realAnswersNote)}</p>`)).toBeLessThan(html.indexOf('<div class="exchange">'));
	});

	it("keeps the section order", () => {
		const order = [
			'<div class="notice" role="note">',
			"<main>",
			"<header>",
			"<h1>",
			"<p>",
			'<div class="endpoint">',
			'<nav class="lang"',
			"</header>",
			`<section id="${lang === "fr" ? "exemples" : "examples"}">`,
			"<dl>",
			"<h3>",
			'<p class="note">',
			'<div class="exchange">',
		];
		let at = -1;
		for (const marker of order) {
			const i = html.indexOf(marker, at + 1);
			expect(i, marker).toBeGreaterThan(at);
			at = i;
		}
		const headings = [...html.matchAll(/<section[^>]*>\n<h2>([^<]+)<\/h2>/g)].map((m) => decodeHTML(m[1]));
		expect(headings).toEqual(
			lang === "fr"
				? ["Exemples", "Se connecter", "Outils", "Ce que ce service ne fait pas", "Données"]
				: ["Examples", "Connect", "Tools", "What this service does not do", "Data"],
		);
		expect(html.indexOf("</section>\n\n<footer>")).toBeGreaterThan(html.lastIndexOf("<section"));
		expect(html.indexOf("<footer>")).toBeLessThan(html.indexOf("</main>"));
		const footer = text(between(html, "<footer>", "</footer>"));
		const parts = VERBATIM[lang].slice(-4);
		for (let i = 1; i < parts.length; i++) expect(footer.indexOf(parts[i - 1])).toBeLessThan(footer.indexOf(parts[i]));
		const tools = between(html, `<h2>${escapeText(c.toolsHeading)}</h2>`, "</section>");
		expect(tools).toContain('<div class="table-wrap">\n<table>');
		expect(tools.match(/<tr>/g)).toHaveLength(6);
		const limits = between(html, `<h2>${escapeText(c.limitsHeading)}</h2>`, "</section>");
		expect(limits.match(/<li>/g)).toHaveLength(3);
		const data = between(html, `<h2>${escapeText(c.dataHeading)}</h2>`, "</section>");
		expect(data.match(/<tr>/g)).toHaveLength(3);
		expect(data.indexOf("</table>")).toBeLessThan(data.indexOf(escapeText(c.licence)));
	});

	it("renders the endpoint bar and hidden copy buttons", () => {
		const bar = between(html, '<div class="endpoint">', "</div>");
		expect(bar).toContain(`<span class="visually-hidden">${escapeText(c.endpointLabel)}</span>`);
		expect(bar).toContain('<span class="pill">MCP</span>');
		expect(bar).toContain(`<code>${MCP_ENDPOINT}</code>`);
		const button = (value: string) =>
			`<button type="button" class="copy" data-copy="${escapeAttribute(value)}" data-done="${lang === "fr" ? "Copié" : "Copied"}" hidden>${lang === "fr" ? "Copier" : "Copy"}</button>`;
		expect(bar).toContain(button(MCP_ENDPOINT));
		for (const code of [CLAUDE_CODE, CURSOR_JSON]) {
			expect(html).toContain(`<div class="snippet">\n${button(code)}\n<pre><code>${escapeText(code)}</code></pre>\n</div>`);
		}
		const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
		expect(buttons).toHaveLength(3);
		for (const b of buttons) expect(b).toMatch(/ hidden>$/);
	});

	describe("slop guards", () => {
		it("(a) uses none of the banned words in our own copy", () => {
			const visible = ownText(html);
			for (const word of [
				"unlock",
				"seamless",
				"seamlessly",
				"effortless",
				"effortlessly",
				"supercharge",
				"empower",
				"robust",
				"leverage",
				"streamline",
				"cutting-edge",
				"revolutionize",
				"game-changer",
				"elevate",
				"harness",
				"révolutionner",
				"révolutionnaire",
				"sans effort",
				"booster",
				"optimisez",
				"incontournable",
				"en toute simplicité",
			]) {
				expect(visible, word).not.toMatch(new RegExp(`(?<![\\p{L}\\p{N}-])${word}(?![\\p{L}\\p{N}-])`, "iu"));
			}
		});

		it("(b) has no em dash in our own copy", () => {
			expect(ownText(html)).not.toContain("—");
		});

		it("(c) has no emoji", () => {
			expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
		});

		it("(e) loads no asset and has exactly one inline script", () => {
			expect(html).not.toMatch(/<img|<svg|<link rel="stylesheet"|<script src=|@import|url\(/i);
			expect(html.match(/<script/g)).toHaveLength(1);
			expect(html).toContain("<script>\n");
			expect(html.match(/<style>/g)).toHaveLength(1);
		});
	});
});

describe("styles", () => {
	const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
	const rule = (selector: string) => {
		const found = rules.filter((r) => r.selector === selector);
		expect(found, selector).toHaveLength(1);
		return found[0].body;
	};
	const expectDecls = (selector: string, decls: readonly string[]) => {
		const body = rule(selector);
		for (const d of decls) expect(body, `${selector} ${d}`).toContain(`${d};`);
	};

	it("is the single style block of both pages", () => {
		for (const lang of LANGS) expect(PAGES[lang]).toContain(`<style>\n${CSS}\n</style>`);
	});

	it("defines every colour token in both palettes", () => {
		const light = CSS.match(/^:root \{([^}]*)\}/m)![1];
		const dark = CSS.match(/@media \(prefers-color-scheme: dark\) \{ :root \{([^}]*)\} \}/)![1];
		const tokens: readonly [string, string, string][] = [
			["--bg", "#FBFAF7", "#141413"],
			["--surface", "#FFFFFF", "#1C1B19"],
			["--fg", "#1C1B19", "#ECEAE4"],
			["--muted", "#6B6862", "#9C988F"],
			["--border", "#E4E1DA", "#2E2C28"],
			["--accent", "#0F5E57", "#5FB3A8"],
			["--code-bg", "#F3F1EC", "#1F1E1B"],
			["--notice-bg", "#FFF4DB", "#2E2610"],
			["--notice-border", "#E8C66A", "#6B5420"],
			["--notice-fg", "#5C4300", "#F0D58A"],
		];
		for (const [name, l, d] of tokens) {
			expect(light).toContain(`${name}: ${l};`);
			expect(dark).toContain(`${name}: ${d};`);
		}
		const allowed = new Set(tokens.flatMap(([, l, d]) => [l, d]));
		for (const hex of CSS.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []) expect(allowed.has(hex), hex).toBe(true);
		expect(CSS).not.toMatch(/rgba?\(|hsla?\(/);
	});

	it("sets the type stacks and sizes", () => {
		const text = `Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif`;
		const ui = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
		const mono = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
		expectDecls("body", [`font-family: ${text}`, "font-size: 17px", "line-height: 1.6", "background: var(--bg)", "color: var(--fg)"]);
		expectDecls("h1, h2, h3", [`font-family: ${text}`, "font-weight: 600", "letter-spacing: -0.01em"]);
		expectDecls("h1", ["font-size: 30px"]);
		expectDecls("h2", ["font-size: 21px"]);
		expectDecls("h3", ["font-size: 17px"]);
		expectDecls("code, pre", [`font-family: ${mono}`, "font-size: 14px"]);
		expectDecls(".lang", [`font-family: ${ui}`, "font-size: 14px"]);
		expectDecls("th", [`font-family: ${ui}`, "font-size: 14px"]);
		expectDecls("footer", [`font-family: ${ui}`, "font-size: 14px"]);
		for (const m of CSS.matchAll(/font-size: (\d+)px/g)) expect(Number(m[1])).toBeLessThanOrEqual(30);
	});

	it("sets the layout, notice, endpoint bar, pill and copy buttons", () => {
		expectDecls("main", ["max-width: 720px", "margin: 0 auto", "padding: 0 16px 48px"]);
		expectDecls("section", ["margin-top: 48px", "border-top: 1px solid var(--border)"]);
		expectDecls(".notice", ["background: var(--notice-bg)", "color: var(--notice-fg)", "border-bottom: 1px solid var(--notice-border)", "padding: 12px 16px"]);
		expectDecls(".notice p", ["max-width: 720px"]);
		expect(rule(".notice")).not.toMatch(/border(-left|-top|-right)?:/);
		expectDecls(".endpoint", [
			"background: var(--code-bg)",
			"border: 1px solid var(--border)",
			"border-radius: 6px",
			"padding: 8px 12px",
			"display: flex",
			"gap: 8px",
			"align-items: center",
			"flex-wrap: wrap",
		]);
		expectDecls(".endpoint code", ["overflow-wrap: anywhere"]);
		expectDecls(".pill", [
			"font-size: 12px",
			"font-weight: 600",
			"color: var(--accent)",
			"background: var(--surface)",
			"border: 1px solid var(--accent)",
			"border-radius: 4px",
			"padding: 1px 6px",
		]);
		expectDecls(".copy", [
			"height: 28px",
			"border-radius: 6px",
			"border: 1px solid var(--border)",
			"background: transparent",
			"color: var(--fg)",
			"font-size: 13px",
			"cursor: pointer",
		]);
		expect(rule(".copy")).not.toMatch(/display:/);
		expectDecls(".copy:hover", ["border-color: var(--accent)"]);
		expectDecls(".copy:focus-visible", ["outline: 2px solid var(--accent)", "outline-offset: 2px"]);
	});

	it("sets code blocks, exchanges, tables, links and the switch", () => {
		expectDecls("pre", ["background: var(--code-bg)", "border: 1px solid var(--border)", "border-radius: 6px", "padding: 12px", "overflow-x: auto"]);
		expectDecls(".snippet", ["text-align: right"]);
		expectDecls(".q", ["max-width: 85%", "margin-left: auto", "background: var(--code-bg)", "border-radius: 12px", "padding: 8px 12px"]);
		expectDecls(".a", [
			"background: var(--surface)",
			"border: 1px solid var(--border)",
			"border-radius: 8px",
			"padding: 12px 16px",
			"margin: 8px 0 24px 0",
			"overflow-wrap: anywhere",
		]);
		expectDecls(".table-wrap", ["overflow-x: auto"]);
		expectDecls("table", ["width: 100%"]);
		expectDecls("th, td", ["border: 1px solid var(--border)", "background: var(--surface)"]);
		expectDecls("a", ["color: var(--accent)", "text-decoration: underline", "text-underline-offset: 2px"]);
		expectDecls('.lang a[aria-current="true"]', ["font-weight: 700", "text-decoration: none"]);
	});

	it("(d) uses none of the rejected CSS patterns", () => {
		expect(CSS).not.toMatch(/gradient/i);
		expect(CSS).not.toMatch(/box-shadow/i);
		expect(CSS).not.toMatch(/backdrop-filter/i);
		expect(CSS).not.toMatch(/text-transform:\s*uppercase/i);
		expect(CSS).not.toMatch(/border-left/i);
		const withTop = rules.filter((r) => /border-top/i.test(r.body));
		expect(withTop.map((r) => r.selector)).toEqual(["section"]);
		expect(withTop[0].body.match(/border-top[^;]*;/g)).toEqual(["border-top: 1px solid var(--border);"]);
	});
});

describe("copy script", () => {
	const script = PAGES.fr.slice(PAGES.fr.indexOf("<script>") + 8, PAGES.fr.indexOf("</script>"));

	it("is the same in both languages and holds no text of its own", () => {
		expect(PAGES.en).toContain(`<script>${script}</script>`);
		expect(script).toContain('addEventListener("DOMContentLoaded"');
		expect(script).toContain('querySelectorAll("button.copy")');
		expect(script).toContain("b.hidden = false");
		expect(script).toContain("navigator.clipboard.writeText(b.dataset.copy)");
		expect(script).toContain("b.dataset.done");
		expect(script).toContain("1500");
		expect(script).not.toMatch(/Copi|Copy|fetch\(|import|https?:/);
	});
});

describe("renderers", () => {
	it("escapes markup, ampersands and non-breaking spaces in the rendered texts", () => {
		const raw = "<b>A</b> & B C";
		const outputs = [renderExamples([{ question: raw, behaviour: raw }]), renderRealAnswers([{ question: raw, answer: raw }])];
		for (const out of outputs) {
			expect(out).toContain("&lt;b&gt;A&lt;/b&gt;");
			expect(out).toContain("&amp;");
			expect(out).toContain("&nbsp;");
			expect(out).not.toContain("<b>");
			expect(out).not.toContain(" ");
		}
	});
});
