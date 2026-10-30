import { exports } from "cloudflare:workers";
import { decodeHTML, decodeHTMLAttribute } from "entities/decode";
import { describe, expect, it } from "vitest";
import { DIRECTORY_URL, formatText, frenchSpacing, type Lang, REPO_URL, renderExamples, renderLanding, renderPrivacy, renderRealAnswers, resolveLang } from "../src/landing";
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
	const body = one(tree, is("body"));
	const header = one(tree, is("header"));

	it("sets html lang, title, description and hreflang links", () => {
		expect(one(tree, is("html")).attrs.lang).toBe(lang);
		expect(text(one(tree, is("title")))).toBe("Médicaments en France");
		expect(one(tree, (e) => e.tag === "meta" && e.attrs.name === "description").attrs.content).toBe(text(one(header, is("p", "lead"))));
		const alternates = all(tree, (e) => e.tag === "link" && e.attrs.rel === "alternate").map((e) => [e.attrs.hreflang, e.attrs.href]);
		expect(alternates).toEqual([
			["fr", `${ORIGIN}/?lang=fr`],
			["en", `${ORIGIN}/?lang=en`],
			["x-default", `${ORIGIN}/`],
		]);
	});

	it("links the Claude install panel to the directory listing", () => {
		const panel = one(tree, (e) => e.attrs.id === "panel-claude");
		expect(all(panel, is("a")).map((a) => a.attrs.href)).toEqual([DIRECTORY_URL]);
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

const PRIVACY_PAGES: Record<Lang, string> = { fr: renderPrivacy("fr"), en: renderPrivacy("en") };
const PRIVACY_TREES: Record<Lang, El> = { fr: await parse(PRIVACY_PAGES.fr), en: await parse(PRIVACY_PAGES.en) };

const PRIVACY_TITLES: Record<Lang, string> = { fr: "Confidentialité · Médicaments en France", en: "Privacy · Médicaments en France" };

describe("GET /privacy", () => {
	const branches: readonly [string, Record<string, string> | undefined, Lang][] = [
		["/privacy?lang=en", { "Accept-Language": "fr-FR" }, "en"],
		["/privacy?lang=fr", { "Accept-Language": "en-GB,en;q=0.9" }, "fr"],
		["/privacy", { "Accept-Language": "en-GB,en;q=0.9" }, "en"],
		["/privacy", { "Accept-Language": "fr-FR" }, "fr"],
		["/privacy", undefined, "fr"],
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
			expect(await res.text()).toBe(PRIVACY_PAGES[lang]);
		});
	}

	it("answers HEAD with 200 and an empty body", async () => {
		const res = await exports.default.fetch(`${ORIGIN}/privacy`, { method: "HEAD" });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(await res.text()).toBe("");
	});

	it("rejects POST with 405", async () => {
		const res = await exports.default.fetch(`${ORIGIN}/privacy`, { method: "POST" });
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("GET, HEAD");
		expect(await res.json()).toEqual({ error: "method_not_allowed" });
	});
});

describe.each(LANGS)("privacy page (%s)", (lang) => {
	const html = PRIVACY_PAGES[lang];
	const tree = PRIVACY_TREES[lang];
	const main = one(tree, is("main"));

	it("sets html lang, title and hreflang links", () => {
		expect(one(tree, is("html")).attrs.lang).toBe(lang);
		expect(text(one(tree, is("title")))).toBe(PRIVACY_TITLES[lang]);
		const alternates = all(tree, (e) => e.tag === "link" && e.attrs.rel === "alternate").map((e) => [e.attrs.hreflang, e.attrs.href]);
		expect(alternates).toEqual([
			["fr", `${ORIGIN}/privacy?lang=fr`],
			["en", `${ORIGIN}/privacy?lang=en`],
			["x-default", `${ORIGIN}/privacy`],
		]);
	});

	it("links to the Cloudflare policy and the GitHub issues", () => {
		expect(all(main, is("a")).map((a) => a.attrs.href)).toEqual(["https://www.cloudflare.com/privacypolicy/", `${REPO_URL}/issues`]);
	});

	it("applies French typography on the French page only", () => {
		if (lang === "fr") {
			expect(html).toContain("\u202F:");
			expect(rawText(one(tree, is("body")), (e) => ["script", "style"].includes(e.tag))).not.toMatch(/ [:;?!»]|« /);
		} else {
			expect(html).not.toContain("\u202F");
		}
	});
});

describe.each(LANGS)("favicon (%s)", (lang) => {
	for (const [page, tree] of [
		["landing", TREES[lang]],
		["privacy", PRIVACY_TREES[lang]],
	] as const) {
		it(`links the SVG icon from the ${page} page`, () => {
			const icon = one(tree, (e) => e.tag === "link" && e.attrs.rel === "icon");
			expect(icon.attrs).toEqual({ rel: "icon", type: "image/svg+xml", href: "/icon.svg" });
		});
	}
});
