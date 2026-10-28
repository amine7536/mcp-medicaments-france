import { exports } from "cloudflare:workers";
import { decodeHTML } from "entities/decode";
import { escapeText } from "entities/escape";
import { describe, expect, it } from "vitest";
import { EXAMPLES, LANDING_HTML, MCP_ENDPOINT, NON_ENDORSEMENT, REAL_ANSWERS, REAL_ANSWERS_NOTE } from "../src/landing";
import { ANSM_SOURCE_URL, BDPM_SOURCE_URL, COVERAGE_NOTE, DISCLAIMER } from "../src/mcp/envelope";

describe("GET /", () => {
	it("returns the landing page as cacheable HTML", async () => {
		const res = await exports.default.fetch("https://ruptures-medicaments.a3e.dev/");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
		const html = await res.text();
		for (const s of [MCP_ENDPOINT, COVERAGE_NOTE, DISCLAIMER, NON_ENDORSEMENT, ANSM_SOURCE_URL, BDPM_SOURCE_URL, "Ruptures de médicaments (France)"]) {
			expect(html).toContain(s);
		}
		expect(res.headers.get("set-cookie")).toBeNull();
	});

	it("loads no external script, stylesheet, font or image", () => {
		expect(LANDING_HTML).not.toMatch(/<script|<link|<img|@import|url\(/i);
	});

	it("keeps the content order", () => {
		const headings = [...LANDING_HTML.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
		expect(headings).toEqual(["What it is", "Endpoint", "Connect", "Tools", "Exemples / Examples", "Coverage", "Sources", "Licence", "Privacy", "Links"]);
	});

	const BANNER_FR =
		"Information uniquement, pas un avis médical. Ce service ne remplace pas votre médecin ou votre pharmacien : demandez-leur toujours conseil avant de modifier, remplacer ou arrêter un traitement.";
	const BANNER_EN =
		"Information only, not medical advice. This service does not replace your doctor or pharmacist: always ask them before changing, replacing or stopping a treatment.";
	const text = (html: string) => decodeHTML(html.replace(/<[^>]+>/g, ""));

	it("shows the bilingual medical disclaimer banner right after the subtitle", async () => {
		const html = await (await exports.default.fetch("https://ruptures-medicaments.a3e.dev/")).text();
		const banner = html.match(/<div class="banner" role="note">([\s\S]*?)<\/div>/);
		expect(banner).not.toBeNull();
		const bannerText = text(banner![1]);
		expect(bannerText).toContain(BANNER_FR);
		expect(bannerText).toContain(BANNER_EN);
		expect(banner![1]).toContain('<p lang="fr"><strong>Information uniquement, pas un avis médical.</strong>');
		expect(banner![1]).toContain('<p lang="en"><strong>Information only, not medical advice.</strong>');
		const subtitleEnd = html.indexOf("</p>", html.indexOf('<p class="subtitle">')) + "</p>".length;
		expect(html.slice(subtitleEnd).trimStart().startsWith('<div class="banner" role="note">')).toBe(true);
		expect(html.indexOf('<div class="banner"')).toBeLessThan(html.indexOf("<h2>What it is</h2>"));
	});

	it("lists the example questions with their expected behaviour", async () => {
		const html = await (await exports.default.fetch("https://ruptures-medicaments.a3e.dev/")).text();
		expect(EXAMPLES).toHaveLength(6);
		for (const e of EXAMPLES) {
			expect(html).toContain(`<dt>${escapeText(e.question)}</dt>`);
			expect(html).toContain(`<dd>${escapeText(e.behaviour)}</dd>`);
		}
		expect(text(html)).toContain(REAL_ANSWERS_NOTE);
		expect(html).toContain("capturées le 28/10/2026");
		expect(html).toContain("Les données ont pu changer depuis.");
	});

	it("shows the three dated real answers as plain escaped text", async () => {
		const html = await (await exports.default.fetch("https://ruptures-medicaments.a3e.dev/")).text();
		expect(REAL_ANSWERS.map((a) => a.question)).toEqual([
			"« L'Aspirine est-elle en rupture ? »",
			"« Quels sont les médicaments en tension pour la cardiologie ? »",
			"« Par quoi remplacer le Brevibloc ? »",
		]);
		for (const a of REAL_ANSWERS) {
			expect(html).toContain(`<figcaption>${escapeText(a.question)}</figcaption>`);
			expect(html).toContain(`<blockquote>${escapeText(a.answer)}</blockquote>`);
			expect(a.answer).not.toMatch(/\*\*|\]\(/);
		}
		expect(html).not.toContain("**");
		expect(html).not.toContain("](");
		expect(html).not.toMatch(/<a [^>]*href="https:\/\/ansm\.sante\.fr\/disponibilites-des-produits-de-sante\/medicaments\/(acide|brevibloc)/);
		expect(html.indexOf(REAL_ANSWERS_NOTE)).toBeLessThan(html.indexOf("<figure>"));
	});

	it("escapes every example text", () => {
		const samples = [...EXAMPLES.flatMap((e) => [e.question, e.behaviour]), ...REAL_ANSWERS.flatMap((a) => [a.question, a.answer])];
		for (const s of samples) expect(LANDING_HTML).toContain(escapeText(s));
		expect(escapeText("a < b & c")).toBe("a &lt; b &amp; c");
		const sample = REAL_ANSWERS[0].answer;
		expect(sample).toMatch(/'/);
		expect(LANDING_HTML).toContain(escapeText(sample));
		expect(LANDING_HTML).toContain("« L'Aspirine est-elle en rupture ? »");
		// No raw `<` from texts: the examples section holds only the expected tags.
		const section = LANDING_HTML.slice(LANDING_HTML.indexOf("<h2>Exemples / Examples</h2>"), LANDING_HTML.indexOf("<h2>Coverage</h2>"));
		const tags = new Set([...section.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]));
		expect([...tags].sort()).toEqual(["blockquote", "dd", "dl", "dt", "figcaption", "figure", "h2", "h3", "p"]);
	});

	it("styles the banner and quotes for small screens and both color schemes", () => {
		const css = LANDING_HTML.slice(LANDING_HTML.indexOf("<style>"), LANDING_HTML.indexOf("</style>"));
		const [light, dark] = [css.match(/^:root \{[^}]*\}/m)![0], css.match(/@media \(prefers-color-scheme: dark\) \{ :root \{[^}]*\}/)![0]];
		for (const [block, values] of [
			[light, ["#fff4e5", "#b45309", "#5c2c00"]],
			[dark, ["#2b1d0e", "#f59e0b", "#fde7c8"]],
		] as const) {
			expect(block).toContain(`--warn-bg: ${values[0]};`);
			expect(block).toContain(`--warn-border: ${values[1]};`);
			expect(block).toContain(`--warn-fg: ${values[2]};`);
		}
		expect(css).toContain(
			".banner { background: var(--warn-bg); color: var(--warn-fg); border-left: 4px solid var(--warn-border); padding: .75rem 1rem; border-radius: 4px; margin: 0 0 1.5rem; }",
		);
		expect(css).toMatch(/blockquote \{[^}]*overflow-wrap: anywhere;[^}]*\}/);
		expect(css).toContain(".note { color: var(--muted); font-size: .9em; }");
		for (const sel of [".banner", "dl", "dd", "dt", "figure", "figcaption", "blockquote", ".note"]) {
			for (const m of css.matchAll(new RegExp(`(?:^|[\\s,}])${sel.replace(".", "\\.")}\\s*\\{([^}]*)\\}`, "g"))) {
				expect(m[1]).not.toMatch(/(^|[\s;])(min-)?width\s*:/);
			}
		}
	});
});
