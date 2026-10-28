import { exports } from "cloudflare:workers";
import { decodeHTML, decodeHTMLAttribute } from "entities/decode";
import { describe, expect, it } from "vitest";
import {
	COPY,
	CSS,
	EXAMPLES,
	formatText,
	frenchSpacing,
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
import { consume } from "../src/lib/html";

const ORIGIN = "https://medicaments-france.a3e.dev";
const LANGS: readonly Lang[] = ["fr", "en"];
const PAGES: Record<Lang, string> = { fr: renderLanding("fr"), en: renderLanding("en") };

/** A minimal element tree built with HTMLRewriter: raw text chunks are kept as strings. */
interface El {
	tag: string;
	attrs: Record<string, string>;
	children: (El | string)[];
	parent: El | null;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

async function parse(html: string): Promise<El> {
	const root: El = { tag: "#document", attrs: {}, children: [], parent: null };
	let current = root;
	await consume(
		new HTMLRewriter()
			.on("*", {
				element(el) {
					const node: El = { tag: el.tagName, attrs: Object.fromEntries([...el.attributes].map(([k, v]) => [k, decodeHTMLAttribute(v)])), children: [], parent: current };
					current.children.push(node);
					if (VOID.has(el.tagName)) return;
					current = node;
					el.onEndTag(() => {
						current = node.parent ?? root;
					});
				},
			})
			.onDocument({
				text(chunk) {
					if (chunk.text) current.children.push(chunk.text);
				},
			}),
		html,
	);
	return root;
}

const TREES: Record<Lang, El> = { fr: await parse(PAGES.fr), en: await parse(PAGES.en) };

const hasClass = (n: El, cls: string) => (n.attrs.class ?? "").split(" ").includes(cls);
const is =
	(tag: string, cls?: string) =>
	(n: El): boolean =>
		n.tag === tag && (cls === undefined || hasClass(n, cls));
const elements = (n: El): El[] => n.children.filter((c): c is El => typeof c !== "string");
function all(n: El, pred: (e: El) => boolean): El[] {
	const out: El[] = [];
	const walk = (e: El) => {
		for (const c of elements(e)) {
			if (pred(c)) out.push(c);
			walk(c);
		}
	};
	walk(n);
	return out;
}
function one(n: El, pred: (e: El) => boolean): El {
	const found = all(n, pred);
	expect(found).toHaveLength(1);
	return found[0];
}
/** Decoded text of a subtree, skipping the subtrees matched by `skip`. */
function rawText(n: El, skip: (e: El) => boolean = () => false): string {
	let out = "";
	const walk = (e: El) => {
		let chunk = "";
		for (const c of e.children) {
			if (typeof c === "string") chunk += c;
			else {
				out += decodeHTML(chunk);
				chunk = "";
				if (!skip(c)) walk(c);
				out += " ";
			}
		}
		out += decodeHTML(chunk);
	};
	walk(n);
	return out;
}
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const text = (n: El) => norm(rawText(n));
/** Visible text of our own copy: no head, script, style, code, or Claude's real answers. */
const ownText = (n: El) => norm(rawText(n, (e) => ["head", "script", "style", "pre", "code"].includes(e.tag) || is("div", "msg")(e)));

const CURSOR_JSON = `{
  "mcpServers": {
    "medicaments-france": {
      "url": "${MCP_ENDPOINT}"
    }
  }
}`;
const CLAUDE_CODE = `claude mcp add --transport http medicaments-france ${MCP_ENDPOINT}`;

const VERBATIM: Record<Lang, readonly string[]> = {
	fr: [
		"Attention : information uniquement, pas un avis médical. Ce service ne remplace pas votre médecin ou votre pharmacien : demandez-leur toujours conseil avant de modifier, remplacer ou arrêter un traitement.",
		"Un serveur MCP gratuit, en lecture seule, qui permet aux assistants IA de consulter les ruptures et tensions d'approvisionnement de médicaments publiées par l'ANSM, avec les codes officiels de la base publique des médicaments (BDPM).",
		"Adresse du serveur MCP",
		"Exemples",
		"Réponses réelles",
		REAL_ANSWERS_NOTE,
		"Ajouter le serveur",
		"Dans Claude, ouvrez Customize > Connectors, choisissez Add custom connector, collez l'adresse ci-dessus et sélectionnez No sign-in.",
		"Dans un terminal :",
		"Dans le fichier mcp.json :",
		"Tout autre client MCP compatible Streamable HTTP fonctionne avec l'adresse ci-dessus.",
		"Outils",
		"Ce que ce service ne fait pas",
		"Il ne donne aucun conseil médical : pas de remplacement, pas de changement de dose, pas d'arrêt de traitement.",
		"Il ne connaît pas le stock des pharmacies : les données de l'ANSM sont nationales.",
		"Un médicament absent de la liste n'est pas forcément disponible : l'ANSM publie surtout les ruptures de médicaments d'intérêt thérapeutique majeur déclarées par les fabricants.",
		"Données",
		"Date exacte de la dernière mise à jour : /health",
		"Code sous licence MIT. Données réutilisées selon les conditions de leurs sources : sans modification, avec la source et la date de mise à jour.",
		"Pas de compte, pas de cookie. Pour chaque appel, seuls le nom de l'outil, le résultat (succès ou erreur), la durée, le code CIS s'il y en a un et la date sont enregistrés. Ni adresse IP, ni texte des questions.",
		"Service indépendant.",
		NON_ENDORSEMENT,
	],
	en: [
		"Warning: information only, not medical advice. This service does not replace your doctor or pharmacist: always ask them before changing, replacing or stopping a treatment.",
		"A free, read-only MCP server that lets AI assistants look up the medicine shortages and supply problems published by the French medicines agency (ANSM), with the official codes from the French public medicines database (BDPM).",
		"MCP server address",
		"Examples",
		"Real answers",
		"Answers from Claude through this server, captured on 28 October 2026 with an instruction to answer in a few sentences. The data may have changed since.",
		"Add the server",
		"In Claude, open Customize > Connectors, choose Add custom connector, paste the address above and select No sign-in.",
		"In a terminal:",
		"In mcp.json:",
		"Any other MCP client that supports Streamable HTTP works with the address above.",
		"Tools",
		"What this service does not do",
		"It gives no medical advice: no replacement, no dose change, no stopping a treatment.",
		"It does not know pharmacy stock: ANSM data is national.",
		"A medicine missing from the list is not necessarily available: ANSM mainly publishes shortages of medicines of major therapeutic interest declared by manufacturers.",
		"Data",
		"Exact date of the last update: /health",
		"Code under the MIT licence. Data reused under the terms of its sources: unaltered, with the source and update date.",
		"No accounts, no cookies. For each call, only the tool name, the result (success or error), the duration, the CIS code when there is one and the date are stored. No IP address, no question text.",
		"Independent service.",
		"This service is not approved or endorsed by ANSM, HAS or UNCAM.",
	],
};

const HEADINGS: Record<Lang, readonly string[]> = {
	fr: ["Exemples", "Ajouter le serveur", "Outils", "Ce que ce service ne fait pas", "Données"],
	en: ["Examples", "Add the server", "Tools", "What this service does not do", "Data"],
};

const TOOLS: Record<Lang, readonly [string, string][]> = {
	fr: [
		["Outil", "Ce qu'il répond"],
		["search_medicine", "Trouve un médicament par son nom ou sa substance et indique s'il est en rupture."],
		["get_availability", "Donne le statut d'un médicament : rupture ou tension, date de retour annoncée, historique."],
		["list_current_shortages", "Liste les ruptures et tensions en cours, par statut, ville ou hôpital, ou domaine médical."],
		["recent_changes", "Montre ce qui a changé ces derniers jours."],
		["is_major_therapeutic_interest", "Indique si un médicament est d'intérêt thérapeutique majeur (MITM)."],
		["get_medicine_info", "Donne les boîtes d'un médicament (code CIP13, commercialisation, prix, taux de remboursement), ses conditions de prescription et de délivrance, et les informations de sécurité en cours publiées par l'ANSM."],
	],
	en: [
		["Tool", "What it answers"],
		["search_medicine", "Finds a medicine by name or active substance and shows whether it is in shortage."],
		["get_availability", "Gives a medicine's status: shortage or supply problem, announced return date, history."],
		["list_current_shortages", "Lists current shortages and supply problems, by status, pharmacy or hospital, or medical area."],
		["recent_changes", "Shows what changed in the last few days."],
		["is_major_therapeutic_interest", "Tells whether a medicine is of major therapeutic interest (MITM)."],
		["get_medicine_info", "Gives a medicine's boxes (CIP13 code, marketing status, price, reimbursement rate), its prescription and dispensing conditions, and current ANSM safety information."],
	],
};

const DATA_ROWS: Record<Lang, readonly string[][]> = {
	fr: [
		["Source", "Contenu", "Mise à jour"],
		["ANSM", "Ruptures, tensions, remises à disposition", "Chaque jour"],
		["BDPM", "Médicaments, substances, présentations, conditions de prescription, liste MITM, informations de sécurité", "Chaque semaine"],
	],
	en: [
		["Source", "Content", "Updated"],
		["ANSM", "Shortages, supply problems, returns", "Daily"],
		["BDPM", "Medicines, substances, presentations, prescription conditions, MITM list, safety information", "Weekly"],
	],
};

const FOOTER_LINKS: Record<Lang, readonly [string, string][]> = {
	fr: [
		["Code source", REPO_URL],
		["Signaler un problème", `${REPO_URL}/issues`],
		["État du service", "/health"],
	],
	en: [
		["Source code", REPO_URL],
		["Report a problem", `${REPO_URL}/issues`],
		["Service status", "/health"],
	],
};

const BUTTON_LABELS: Record<Lang, readonly string[]> = {
	fr: ["Copier l'adresse du serveur", "Copier la commande", "Copier la configuration"],
	en: ["Copy the server address", "Copy the command", "Copy the configuration"],
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

	it("answers HEAD with 200, the HTML content-type and an empty body", async () => {
		const res = await exports.default.fetch(`${ORIGIN}/`, { method: "HEAD" });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(await res.text()).toBe("");
	});

	it("rejects non-GET methods with 405", async () => {
		for (const method of ["POST", "PUT", "DELETE"]) {
			const res = await exports.default.fetch(`${ORIGIN}/`, { method });
			expect(res.status).toBe(405);
			expect(res.headers.get("allow")).toBe("GET, HEAD");
		}
	});
});

describe.each(LANGS)("landing page (%s)", (lang) => {
	const html = PAGES[lang];
	const tree = TREES[lang];
	const c = COPY[lang];
	const other = lang === "fr" ? "en" : "fr";
	const body = one(tree, is("body"));
	const header = one(tree, is("header"));
	const main = one(tree, is("main"));
	const footer = one(tree, is("footer"));
	const sections = all(main, is("section"));
	const sectionByHeading = (heading: string) => {
		const s = sections.find((x) => text(elements(x)[0]) === heading);
		expect(s, heading).toBeDefined();
		return s as El;
	};

	it("sets html lang, title, description and hreflang links", () => {
		expect(one(tree, is("html")).attrs.lang).toBe(lang);
		expect(text(one(tree, is("title")))).toBe("Médicaments en France");
		expect(one(tree, (e) => e.tag === "meta" && e.attrs.name === "description").attrs.content).toBe(VERBATIM[lang][1]);
		const alternates = all(tree, (e) => e.tag === "link" && e.attrs.rel === "alternate").map((e) => [e.attrs.hreflang, e.attrs.href]);
		expect(alternates).toEqual([
			["fr", `${ORIGIN}/?lang=fr`],
			["en", `${ORIGIN}/?lang=en`],
			["x-default", `${ORIGIN}/`],
		]);
	});

	it("never mentions the old service name", () => {
		expect(html).not.toContain(["ruptures", "medicaments"].join("-"));
	});

	it("opens the header with the site name, then the language switch", () => {
		const wrap = elements(header)[0];
		expect(hasClass(wrap, "wrap")).toBe(true);
		expect(elements(wrap).map((e) => `${e.tag}.${e.attrs.class ?? ""}`)).toEqual(["div.top", "h1.", "p.lead", "div.endpoint"]);
		const [site, nav] = elements(elements(wrap)[0]);
		expect(site.tag).toBe("a");
		expect(site.attrs.class).toBe("site");
		expect(site.attrs.href).toBe(`/?lang=${lang}`);
		expect(text(site)).toBe("Médicaments en France");
		expect(nav.tag).toBe("nav");
		expect(nav.attrs.class).toBe("lang");
		expect(nav.attrs["aria-label"]).toBe("Langue / Language");
		expect(text(nav)).toBe("FR | EN");
		const links = all(nav, is("a"));
		expect(links.map((a) => [a.attrs.href, a.attrs.hreflang, a.attrs.lang, text(a)])).toEqual([
			["/?lang=fr", "fr", "fr", "FR"],
			["/?lang=en", "en", "en", "EN"],
		]);
		expect(links.filter((a) => a.attrs["aria-current"] === "true").map((a) => a.attrs.lang)).toEqual([lang]);
		expect(links.find((a) => a.attrs.lang === other)?.attrs["aria-current"]).toBeUndefined();
	});

	it("marks the French title as French on the English page", () => {
		const h1 = one(tree, is("h1"));
		const site = one(tree, is("a", "site"));
		expect(text(h1)).toBe("Médicaments en France");
		expect(h1.attrs.lang).toBe(lang === "en" ? "fr" : undefined);
		expect(site.attrs.lang).toBe(lang === "en" ? "fr" : undefined);
	});

	it("shows every text verbatim", () => {
		const visible = text(body);
		for (const s of VERBATIM[lang]) expect(visible).toContain(s);
		const notice = one(tree, is("div", "notice"));
		expect(notice.attrs.role).toBe("note");
		expect(hasClass(elements(notice)[0], "wrap")).toBe(true);
		const lead = VERBATIM[lang][0];
		expect(text(one(notice, is("strong")))).toBe(lead.slice(0, lead.indexOf(":") + 1));
		expect(text(notice)).toBe(lead);
		expect(text(one(header, is("p", "lead")))).toBe(VERBATIM[lang][1]);
		expect(all(tree, is("a")).filter((a) => a.attrs.href?.startsWith("https://ansm.") || a.attrs.href?.startsWith("https://base-")).map((a) => [a.attrs.href, text(a)])).toEqual([
			["https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments", "ANSM"],
			["https://base-donnees-publique.medicaments.gouv.fr", "BDPM"],
		]);
	});

	it("applies French typography on the French page only", () => {
		if (lang === "fr") {
			expect(html).toContain("Attention :");
			expect(html).not.toContain("Attention :");
			expect(html).toContain("« L'Aspirine est-elle en rupture ? »");
			const raw = rawText(body, (e) => ["script", "style", "pre", "code"].includes(e.tag));
			expect(raw).not.toMatch(/ [:;?!»]|« /);
		} else {
			expect(html).not.toContain(" ");
		}
	});

	it("lists the six examples and the three real answers of the language", () => {
		const examples = lang === "fr" ? EXAMPLES.map((e) => [e.question, e.behaviour] as const) : EXAMPLES_EN;
		const answers = lang === "fr" ? REAL_ANSWERS.map((a) => [a.question, a.answer] as const) : REAL_ANSWERS_EN;
		expect(examples).toHaveLength(6);
		expect(answers).toHaveLength(3);
		const dl = one(tree, is("dl"));
		expect(elements(dl).map((e) => [e.tag, text(e)])).toEqual(examples.flatMap(([q, b]) => [
			["dt", norm(q)],
			["dd", norm(b)],
		]));
		const chat = one(tree, is("div", "chat"));
		expect(chat.attrs.role).toBe("log");
		expect(chat.attrs["aria-label"]).toBe(lang === "fr" ? "Exemple de conversation avec Claude" : "Example conversation with Claude");
		expect(elements(chat).map((e) => `${e.tag}.${e.attrs.class ?? ""}`)).toEqual(["div.chat-head", "div.chat-body"]);
		const [head, chatBody] = elements(chat);
		expect(elements(head).map((e) => [e.tag, text(e)])).toEqual([
			["span", "Claude + medicaments-france"],
			["span", lang === "fr" ? "28/10/2026" : "28 Oct 2026"],
		]);
		const msgs = elements(chatBody);
		expect(msgs.map((e) => `${e.tag}.${e.attrs.class ?? ""}`)).toEqual(answers.flatMap(() => ["div.msg user", "div.msg bot"]));
		answers.forEach(([question, answer], i) => {
			const user = msgs[2 * i];
			const bot = msgs[2 * i + 1];
			expect(elements(user).map((e) => e.tag)).toEqual(["p"]);
			expect(text(user)).toBe(norm(question));
			expect(elements(bot).map((e) => `${e.tag}.${e.attrs.class ?? ""}`)).toEqual(["span.who", "p."]);
			expect(text(elements(bot)[0])).toBe("Claude");
			expect(text(elements(bot)[1])).toBe(norm(answer));
			expect(answer).not.toMatch(/\*\*|\]\(/);
		});
		expect(all(tree, (e) => ["exchange", "q", "a"].some((cls) => hasClass(e, cls)))).toHaveLength(0);
		expect(all(tree, is("blockquote"))).toHaveLength(0);
		const t = formatText(lang);
		expect(html).toContain(renderExamples(c.examples, t));
		expect(html).toContain(renderRealAnswers(c.realAnswers, t));
		expect(html).not.toContain("**");
		expect(all(tree, (e) => e.tag === "a" && /\/medicaments\/(acide|brevibloc)/.test(e.attrs.href ?? ""))).toHaveLength(0);
		const examplesBody = elements(sections[0])[1];
		expect(elements(examplesBody).map((e) => `${e.tag}.${e.attrs.class ?? ""}`)).toEqual(["dl.", "h3.", "p.note", "div.chat"]);
		expect(text(elements(examplesBody)[1])).toBe(c.realAnswersHeading);
		expect(text(elements(examplesBody)[2])).toBe(norm(c.realAnswersNote));
	});

	it("keeps the page order and the two-column section structure", () => {
		expect(elements(body).map((e) => `${e.tag}.${e.attrs.class ?? ""}`)).toEqual(["div.notice", "header.", "main.wrap", "footer.", "p.sr-only", "script."]);
		expect(sections.map((s) => elements(s).map((e) => `${e.tag}.${e.attrs.class ?? ""}`))).toEqual(sections.map(() => ["h2.", "div.body"]));
		expect(sections.map((s) => text(elements(s)[0]))).toEqual(HEADINGS[lang]);
		expect(sections[0].attrs.id).toBe(lang === "fr" ? "exemples" : "examples");
		const limits = sectionByHeading(c.limitsHeading);
		expect(all(limits, is("li")).map(text)).toEqual(c.limits.map(norm));
	});

	it("renders the tools table with the tool names in code", () => {
		const tools = sectionByHeading(c.toolsHeading);
		const wrap = elements(elements(tools)[1])[0];
		expect(hasClass(wrap, "table-wrap")).toBe(true);
		expect(elements(wrap)[0].tag).toBe("table");
		const rows = all(tools, is("tr"));
		expect(rows.map((r) => elements(r).map(text))).toEqual(TOOLS[lang].map(([a, b]) => [a, norm(b)]));
		for (const r of rows.slice(1)) {
			const cell = elements(r)[0];
			expect(elements(cell).map((e) => e.tag)).toEqual(["code"]);
			expect(text(cell)).toBe(text(elements(cell)[0]));
		}
		expect(all(elements(rows[0])[0], is("code"))).toHaveLength(0);
	});

	it("renders the data table, then the update note and the licence", () => {
		const data = sectionByHeading(c.dataHeading);
		const parts = elements(elements(data)[1]);
		expect(parts.map((e) => `${e.tag}.${e.attrs.class ?? ""}`)).toEqual(["div.table-wrap", "p.small", "p.small"]);
		expect(all(parts[0], is("tr")).map((r) => elements(r).map(text))).toEqual(DATA_ROWS[lang]);
		expect(all(parts[0], is("th"))).toHaveLength(3);
		expect(text(parts[1])).toBe(norm(`${c.lastUpdate} /health`));
		expect(one(parts[1], is("a")).attrs.href).toBe("/health");
		expect(text(parts[2])).toBe(norm(c.licence));
	});

	it("renders the footer band with the texts on the left and the links on the right", () => {
		const wrap = elements(footer)[0];
		expect(hasClass(wrap, "wrap")).toBe(true);
		const [texts, links] = elements(wrap);
		expect(elements(texts).map((p) => [p.tag, text(p)])).toEqual(VERBATIM[lang].slice(-3).map((s) => ["p", s]));
		expect(links.tag).toBe("ul");
		expect(links.attrs.class).toBe("links");
		expect(elements(links).map((li) => [li.tag, text(li), one(li, is("a")).attrs.href])).toEqual(FOOTER_LINKS[lang].map(([t, h]) => ["li", t, h]));
	});

	it("renders the endpoint bar and the install tabs with hidden, labelled copy buttons", () => {
		const bar = one(header, is("div", "endpoint"));
		expect(elements(bar).map((e) => `${e.tag}.${e.attrs.class ?? ""}`)).toEqual(["span.sr-only", "span.pill", "code.", "button.copy primary"]);
		const [label, pill, code] = elements(bar);
		expect(text(label)).toBe(c.endpointLabel);
		expect(text(pill)).toBe("MCP");
		expect(text(code)).toBe(MCP_ENDPOINT);

		expect(all(tree, is("div", "snippet"))).toHaveLength(0);
		const connect = elements(sectionByHeading(c.connectHeading))[1];
		expect(elements(connect).map((e) => `${e.tag}.${e.attrs.class ?? ""}`)).toEqual(["div.tabs", "p."]);
		expect(text(elements(connect)[1])).toBe(norm(c.connectOther));
		const tabs = elements(connect)[0];
		expect(elements(tabs).map((e) => `${e.tag}.${e.attrs.class ?? ""}`)).toEqual(["div.tabbar", "div.", "div.", "div."]);
		const [tabbar, ...panels] = elements(tabs);
		expect(elements(tabbar).map((e) => `${e.tag}.${e.attrs.class ?? ""}`)).toEqual(["div.", "button.copy secondary"]);
		const [tablist, tabCopy] = elements(tabbar);
		expect(tablist.attrs.role).toBe("tablist");
		expect(tablist.attrs["aria-label"]).toBe(lang === "fr" ? "Clients MCP" : "MCP clients");
		expect(tablist.attrs.hidden).toBe("");
		const keys = ["claude", "claude-code", "cursor"];
		expect(elements(tablist).map((b) => [b.tag, b.attrs.type, b.attrs.role, b.attrs.id, b.attrs["aria-controls"], b.attrs["aria-selected"], text(b)])).toEqual(
			keys.map((k, i) => ["button", "button", "tab", `tab-${k}`, `panel-${k}`, i === 0 ? "true" : "false", ["Claude", "Claude Code", "Cursor"][i]]),
		);
		expect(panels.map((p) => [p.attrs.role, p.attrs.id, p.attrs["aria-labelledby"], p.attrs.hidden])).toEqual(keys.map((k) => ["tabpanel", `panel-${k}`, `tab-${k}`, undefined]));
		expect(panels.map((p) => [`${elements(p)[0].tag}.${elements(p)[0].attrs.class}`, text(elements(p)[0])])).toEqual([
			["h3.panel-title", "Claude"],
			["h3.panel-title", "Claude Code"],
			["h3.panel-title", "Cursor"],
		]);
		const [claude, claudeCode, cursor] = panels;
		expect(elements(claude).map((e) => e.tag)).toEqual(["h3", "p"]);
		expect(claude.attrs["data-label"]).toBeUndefined();
		expect(text(elements(claude)[1])).toBe(norm(c.connectClaude));
		for (const [p, sentence, value, label] of [
			[claudeCode, c.connectClaudeCode, CLAUDE_CODE, BUTTON_LABELS[lang][1]],
			[cursor, c.connectCursor, CURSOR_JSON, BUTTON_LABELS[lang][2]],
		] as const) {
			expect(elements(p).map((e) => e.tag)).toEqual(["h3", "p", "pre"]);
			expect(p.attrs["data-label"]).toBe(label);
			expect(text(elements(p)[1])).toBe(norm(sentence));
			const pre = elements(p)[2];
			expect(elements(pre).map((e) => e.tag)).toEqual(["code"]);
			expect(rawText(elements(pre)[0])).toBe(value);
		}
		expect(tabCopy.attrs["data-copy"]).toBeUndefined();

		const buttons = all(tree, (e) => is("button")(e) && e.attrs.role !== "tab");
		expect(buttons.map((b) => [b.attrs.class, b.attrs["data-copy"], b.attrs["aria-label"]])).toEqual([
			["copy primary", MCP_ENDPOINT, BUTTON_LABELS[lang][0]],
			["copy secondary", undefined, undefined],
		]);
		for (const b of buttons) {
			expect(b.attrs.type).toBe("button");
			expect(b.attrs.hidden).toBe("");
			expect(b.attrs["data-done"]).toBe(lang === "fr" ? "Copié" : "Copied");
			expect(text(b)).toBe(lang === "fr" ? "Copier" : "Copy");
		}
	});

	it("has one empty polite live region", () => {
		const live = all(tree, (e) => e.attrs["aria-live"] !== undefined);
		expect(live).toHaveLength(1);
		expect(live[0].tag).toBe("p");
		expect(live[0].attrs.class).toBe("sr-only");
		expect(live[0].attrs["aria-live"]).toBe("polite");
		expect(live[0].children).toEqual([]);
	});

	describe("slop guards", () => {
		it("(a) uses none of the banned words in our own copy", () => {
			const visible = ownText(body);
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
			expect(ownText(body)).not.toContain("—");
		});

		it("(c) has no emoji", () => {
			expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
		});

		it("(e) loads no asset and has exactly one inline script", () => {
			expect(all(tree, (e) => e.tag === "img" || e.tag === "svg")).toHaveLength(0);
			expect(all(tree, (e) => e.tag === "link" && e.attrs.rel === "stylesheet")).toHaveLength(0);
			expect(html).not.toMatch(/@import|url\(/i);
			const scripts = all(tree, is("script"));
			expect(scripts).toHaveLength(1);
			expect(scripts[0].attrs).toEqual({});
			expect(all(tree, is("style"))).toHaveLength(1);
		});
	});
});

/** CSS rules, top level and inside `@media` blocks. */
interface Rule {
	media: string | null;
	selector: string;
	body: string;
}

function parseCss(css: string): Rule[] {
	const out: Rule[] = [];
	const flat = (src: string, media: string | null) => {
		for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ media, selector: m[1].trim(), body: m[2] });
	};
	const top = css.replace(/@media ([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g, (_, query: string, inner: string) => {
		flat(inner, query.trim());
		return "";
	});
	flat(top, null);
	return out;
}

describe("styles", () => {
	const rules = parseCss(CSS);
	const rule = (selector: string, media: string | null = null) => {
		const found = rules.filter((r) => r.selector === selector && r.media === media);
		expect(found, `${media ?? ""} ${selector}`).toHaveLength(1);
		return found[0].body;
	};
	const expectDecls = (selector: string, decls: readonly string[], media: string | null = null) => {
		const body = rule(selector, media);
		for (const d of decls) expect(body, `${selector} ${d}`).toContain(` ${d};`);
	};
	const text = `Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif`;
	const ui = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
	const mono = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

	it("is the single style block of both pages", () => {
		for (const lang of LANGS) expect(PAGES[lang]).toContain(`<style>\n${CSS}\n</style>`);
	});

	it("is light only and defines every colour token", () => {
		expect(CSS).not.toMatch(/prefers-color-scheme/);
		expectDecls(":root", ["color-scheme: light"]);
		expect(rule(":root")).not.toMatch(/color-scheme: light dark/);
		const tokens: readonly [string, string][] = [
			["--bg", "#FBFAF7"],
			["--surface", "#FFFFFF"],
			["--fg", "#1C1B19"],
			["--muted", "#5F5C56"],
			["--border", "#E4E1DA"],
			["--accent", "#0F5E57"],
			["--accent-soft", "#E6F0EE"],
			["--code-bg", "#F3F1EC"],
			["--notice-bg", "#FFF4DB"],
			["--notice-border", "#E8C66A"],
			["--notice-fg", "#5C4300"],
		];
		expectDecls(
			":root",
			tokens.map(([name, value]) => `${name}: ${value}`),
		);
		const allowed = new Set(tokens.map(([, v]) => v));
		for (const hex of CSS.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []) expect(allowed.has(hex), hex).toBe(true);
		expect(CSS).not.toMatch(/rgba?\(|hsla?\(/);
	});

	it("sets the type stacks and sizes", () => {
		expectDecls("body", [`font-family: ${text}`, "font-size: 17px", "line-height: 1.6", "background: var(--bg)", "color: var(--fg)"]);
		expectDecls("h1, h2, h3", [`font-family: ${ui}`, "font-weight: 600"]);
		expectDecls("h1", ["font-size: 34px", "letter-spacing: -0.02em", "line-height: 1.15"]);
		expectDecls("h2", ["font-size: 22px", "letter-spacing: -0.01em"]);
		expectDecls("h3", ["font-size: 16px"]);
		expectDecls(".lead", ["font-size: 19px", "color: var(--muted)", "max-width: 640px"]);
		expect(rule(".lead")).not.toMatch(/font-family/);
		expectDecls("code, pre", [`font-family: ${mono}`, "font-size: 14px"]);
		expectDecls(".site", [`font-family: ${ui}`, "font-size: 15px", "font-weight: 600", "color: var(--fg)"]);
		expectDecls(".lang", [`font-family: ${ui}`, "font-size: 14px"]);
		expectDecls(".pill", [`font-family: ${ui}`, "font-size: 12px", "font-weight: 600"]);
		expectDecls(".copy", [`font-family: ${ui}`]);
		expectDecls("th", [`font-family: ${ui}`, "font-size: 14px", "font-weight: 600"]);
		expectDecls("footer", [`font-family: ${ui}`, "font-size: 14px", "color: var(--muted)"]);
		expectDecls(".notice", [`font-family: ${ui}`, "font-size: 15px"]);
		expectDecls("dt", [`font-family: ${ui}`, "font-size: 16px", "font-weight: 600", "margin-top: 16px"]);
		expectDecls("dd", ["font-size: 16px", "color: var(--muted)", "margin: 4px 0 0 0"]);
		expectDecls(".note", ["font-size: 15px"]);
		expectDecls(".small", ["font-size: 15px"]);
		for (const m of CSS.matchAll(/font-size: (\d+)px/g)) expect(Number(m[1])).toBeLessThanOrEqual(34);
	});

	it("sets the container, header band, sections and footer band", () => {
		expectDecls(".wrap", ["max-width: 960px", "margin: 0 auto", "padding: 0 24px"]);
		expectDecls(".wrap", ["padding: 0 16px"], "(max-width: 599px)");
		expectDecls("header", ["background: var(--surface)", "border-bottom: 1px solid var(--border)", "padding: 32px 0 40px"]);
		expectDecls(".top", ["display: flex", "justify-content: space-between"]);
		expectDecls("section", ["margin-top: 48px", "border-top: 1px solid var(--border)"]);
		expectDecls("section", ["display: grid", "grid-template-columns: 220px 1fr", "column-gap: 48px", "margin-top: 64px"], "(min-width: 900px)");
		expectDecls("footer", ["background: var(--surface)", "border-top: 1px solid var(--border)", "margin-top: 64px", "padding: 32px 0"]);
		expectDecls("footer .wrap", ["display: grid", "grid-template-columns: 1fr auto"], "(min-width: 900px)");
		expectDecls(".links", ["list-style: none"]);
		expectDecls(".notice", ["background: var(--notice-bg)", "color: var(--notice-fg)", "border-bottom: 1px solid var(--notice-border)"]);
		expect(rule(".notice")).not.toMatch(/border(-left|-top|-right)?:/);
	});

	it("sets the endpoint bar, pill and copy buttons", () => {
		expectDecls(".endpoint", [
			"background: var(--surface)",
			"border: 1px solid var(--border)",
			"border-radius: 8px",
			"min-height: 48px",
			"padding: 6px 6px 6px 12px",
			"display: flex",
			"align-items: center",
		]);
		expectDecls(".endpoint code", ["font-size: 15px", "flex: 1", "overflow-wrap: anywhere"]);
		expectDecls(".pill", ["color: var(--accent)", "background: var(--surface)", "border: 1px solid var(--accent)", "border-radius: 4px", "padding: 1px 6px"]);
		expectDecls(".copy", ["border-radius: 6px", "cursor: pointer"]);
		expectDecls(".copy:focus-visible", ["outline: 2px solid var(--accent)", "outline-offset: 2px"]);
		expectDecls(".primary", ["height: 36px", "padding: 0 14px", "background: var(--accent)", "color: #FFFFFF", "border: none", "font-size: 14px", "font-weight: 600"]);
		expectDecls(".primary:hover", ["filter: brightness(1.1)"]);
		expectDecls(".secondary", ["height: 30px", "padding: 0 10px", "background: transparent", "border: 1px solid var(--muted)", "color: var(--fg)", "font-size: 13px"]);
		expectDecls(".secondary:hover", ["border-color: var(--accent)"]);
		for (const s of [".copy", ".primary", ".secondary"]) expect(rule(s)).not.toMatch(/display:/);
	});

	it("sets the install tabs", () => {
		expectDecls(".tabs", ["border: 1px solid var(--border)", "border-radius: 8px", "background: var(--surface)", "overflow: hidden"]);
		expectDecls(".tabbar", [
			"display: flex",
			"justify-content: space-between",
			"align-items: center",
			"background: var(--code-bg)",
			"border-bottom: 1px solid var(--border)",
			"padding: 0 8px 0 4px",
		]);
		expectDecls("[role=tab]", [
			"background: none",
			"border: none",
			`font-family: ${ui}`,
			"font-size: 14px",
			"font-weight: 500",
			"color: var(--muted)",
			"padding: 12px 12px 10px",
			"border-bottom: 2px solid transparent",
			"margin-bottom: -1px",
			"cursor: pointer",
		]);
		expect(rule("[role=tab]").indexOf("border: none")).toBeLessThan(rule("[role=tab]").indexOf("border-bottom:"));
		expectDecls("[role=tab][aria-selected=true]", ["color: var(--fg)", "font-weight: 600", "border-bottom-color: var(--accent)"]);
		expectDecls("[role=tab]:focus-visible", ["outline: 2px solid var(--accent)", "outline-offset: 2px"]);
		expectDecls("[role=tabpanel]", ["padding: 16px"]);
		expectDecls("[role=tabpanel] pre", ["background: var(--code-bg)", "border: 1px solid var(--border)", "border-radius: 6px"]);
		expectDecls(".tabs.js .panel-title", ["display: none"]);
		for (const s of ["[role=tabpanel]", ".tabs", ".tabbar"]) expect(rule(s)).not.toMatch(/display: (block|grid)/);
		expect(rules.filter((r) => /\.snippet/.test(r.selector))).toEqual([]);
	});

	it("sets the chat transcript", () => {
		expectDecls(".chat", ["background: var(--surface)", "border: 1px solid var(--border)", "border-radius: 12px", "overflow: hidden", "max-width: 680px"]);
		expectDecls(".chat-head", [
			"display: flex",
			"justify-content: space-between",
			"background: var(--code-bg)",
			"border-bottom: 1px solid var(--border)",
			"padding: 10px 16px",
			`font-family: ${ui}`,
			"font-size: 13px",
			"color: var(--muted)",
		]);
		expectDecls(".chat-body", ["padding: 20px 16px", "display: flex", "flex-direction: column", "gap: 14px"]);
		expectDecls(".msg p", ["margin: 0", `font-family: ${ui}`, "font-size: 15px", "line-height: 1.55", "overflow-wrap: anywhere"]);
		expectDecls(".msg.user", ["align-self: flex-end", "max-width: 80%", "background: var(--accent)", "color: #FFFFFF", "border-radius: 16px 16px 4px 16px", "padding: 10px 14px"]);
		expectDecls(".msg.bot", [
			"align-self: flex-start",
			"max-width: 92%",
			"background: var(--bg)",
			"border: 1px solid var(--border)",
			"color: var(--fg)",
			"border-radius: 16px 16px 16px 4px",
			"padding: 10px 14px 12px",
		]);
		expectDecls(".who", ["display: block", `font-family: ${ui}`, "font-size: 12px", "font-weight: 600", "color: var(--muted)", "margin-bottom: 4px"]);
		expect(rules.filter((r) => /(^|[\s,])\.(q|a|exchange)\b/.test(r.selector))).toEqual([]);
	});

	it("sets code blocks, tables, links and the switch", () => {
		expectDecls("pre", ["background: var(--code-bg)", "border: 1px solid var(--border)", "border-radius: 8px", "padding: 14px 16px", "overflow-x: auto"]);
		expectDecls(".table-wrap", ["border: 1px solid var(--border)", "border-radius: 8px", "overflow-x: auto"]);
		expectDecls("table", ["border-collapse: collapse", "width: 100%"]);
		expectDecls("th, td", ["padding: 10px 14px", "border-bottom: 1px solid var(--border)", "text-align: left"]);
		expectDecls("th", ["background: var(--code-bg)"]);
		expectDecls("td", ["background: var(--surface)"]);
		expectDecls("tbody tr:last-child td", ["border-bottom: none"]);
		expectDecls("td code", ["overflow-wrap: anywhere"]);
		expectDecls("a", ["color: var(--accent)", "text-decoration: underline", "text-underline-offset: 2px"]);
		expectDecls('.lang a[aria-current="true"]', ["font-weight: 700", "text-decoration: none"]);
		expectDecls(".sr-only", ["position: absolute", "width: 1px", "height: 1px", "overflow: hidden"]);
	});

	it("(d) uses none of the rejected CSS patterns", () => {
		expect(CSS).not.toMatch(/gradient/i);
		expect(CSS).not.toMatch(/box-shadow/i);
		expect(CSS).not.toMatch(/backdrop-filter/i);
		expect(CSS).not.toMatch(/text-transform:\s*uppercase/i);
		expect(CSS).not.toMatch(/border-left/i);
		const withTop = rules.filter((r) => /border-top/i.test(r.body));
		expect(withTop.map((r) => [r.media, r.selector])).toEqual([
			[null, "section"],
			[null, "footer"],
		]);
		for (const r of withTop) expect(r.body.match(/border-top[^;]*;/g)).toEqual(["border-top: 1px solid var(--border);"]);
	});
});

describe("copy script", () => {
	const script = PAGES.fr.slice(PAGES.fr.indexOf("<script>") + 8, PAGES.fr.indexOf("</script>"));

	it("is the same in both languages and holds no text of its own", () => {
		expect(PAGES.en).toContain(`<script>${script}</script>`);
		expect(script).toContain('addEventListener("DOMContentLoaded"');
		expect(script).toContain("var clip = !!(navigator.clipboard && navigator.clipboard.writeText);");
		expect(script).toContain('if (clip) document.querySelectorAll("button.copy")');
		expect(script.indexOf("if (clip)")).toBeLessThan(script.indexOf("b.hidden = false"));
		expect(script).toContain('querySelectorAll("button.copy")');
		expect(script).toContain('document.querySelector("p[aria-live]")');
		expect(script).toContain("navigator.clipboard.writeText(b.dataset.copy)");
		expect(script).toContain("b.textContent = b.dataset.done");
		expect(script).toContain("live.textContent = b.dataset.done");
		expect(script).toContain("1500");
		expect(script).not.toMatch(/Copi|Copy|fetch\(|import|https?:/);
	});

	it("turns the install snippets into tabs", () => {
		expect(script).toContain('tabs.classList.add("js")');
		expect(script).toContain(`tabs.querySelector('[role="tablist"]').hidden = false`);
		expect(script).toContain(`querySelectorAll('[role="tab"]')`);
		expect(script).toContain('t.setAttribute("aria-selected", j === i ? "true" : "false")');
		expect(script).toContain('t.setAttribute("tabindex", j === i ? "0" : "-1")');
		expect(script).toContain("panelOf(t).hidden = j !== i");
		for (const key of ["ArrowRight", "ArrowLeft", "Home", "End", "Enter"]) expect(script).toContain(`e.key === "${key}"`);
		expect(script).toContain("copyBtn.hidden = !(clip && pre)");
		expect(script).toContain("copyBtn.dataset.copy = pre.textContent");
		expect(script).toContain('copyBtn.setAttribute("aria-label", panel.dataset.label)');
		expect(script).toContain("if (b !== copyBtn) b.hidden = false");
		expect(script).toContain("select(0)");
	});
});

describe("renderers", () => {
	it("escapes markup, ampersands and non-breaking spaces in the rendered texts", () => {
		const raw = "<b>A</b> & B\u00A0C";
		const outputs = [renderExamples([{ question: raw, behaviour: raw }]), renderRealAnswers([{ question: raw, answer: raw }])];
		for (const out of outputs) {
			expect(out).toContain("&lt;b&gt;A&lt;/b&gt;");
			expect(out).toContain("&amp;");
			expect(out).toContain("&nbsp;");
			expect(out).not.toContain("<b>");
			expect(out).not.toContain("\u00A0");
		}
	});

	it("puts narrow no-break spaces around French punctuation after escaping", () => {
		expect(frenchSpacing("« A ? » B : C ; D ! E")).toBe("« A ? » B : C ; D ! E");
		expect(formatText("fr")("« <b> ? »")).toBe("« &lt;b&gt; ? »");
		expect(formatText("en")("A : B")).toBe("A : B");
	});
});
