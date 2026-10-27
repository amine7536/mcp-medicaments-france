import { ANSM_SOURCE_URL, BDPM_SOURCE_URL, COVERAGE_NOTE, DISCLAIMER } from "./mcp/envelope";

export const MCP_ENDPOINT = "https://ruptures-medicaments.a3e.dev/mcp";
export const REPO_URL = "https://github.com/amine7536/mcp-ruptures-medicaments";
export const NON_ENDORSEMENT = "Ce service n'est ni approuvé ni soutenu par l'ANSM, la HAS ou l'UNCAM.";

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
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1a1a1a; --muted: #5a5a5a; --code: #f3f3f3; --link: #0b57d0; }
@media (prefers-color-scheme: dark) { :root { --bg: #121212; --fg: #e8e8e8; --muted: #a8a8a8; --code: #222222; --link: #8ab4f8; } }
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
</style>
</head>
<body>
<main>
<h1>Ruptures de médicaments (France)</h1>
<p class="subtitle">MCP server: medicine shortages in France (ANSM + BDPM).</p>

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
