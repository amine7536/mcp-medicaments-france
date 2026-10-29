import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { experimental_readRawConfig } from "wrangler";

// Read-only tool-call report from Workers Analytics Engine, using the Wrangler login.
let days: number;
try {
	const { values } = parseArgs({
		args: process.argv.slice(2).filter((a) => a !== "--"),
		options: { days: { type: "string", default: "30" } },
	});
	days = Number(values.days);
} catch {
	days = Number.NaN;
}
if (!Number.isInteger(days) || days < 1 || days > 90) {
	console.error("--days must be an integer from 1 to 90");
	process.exit(1);
}

const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
const accountId = rawConfig.account_id;
const dataset = rawConfig.analytics_engine_datasets?.[0]?.dataset;

let token: string | undefined;
try {
	const out = execFileSync("wrangler", ["auth", "token", "--json"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});
	token = (JSON.parse(out) as { token?: string }).token;
} catch {}
if (!token) {
	console.error('Run "npx wrangler login" first: pnpm usage uses your Wrangler login.');
	process.exit(1);
}

type Row = Record<string, string>;

async function query(sql: string): Promise<Row[]> {
	const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
		body: sql,
	});
	const body = await res.text();
	if (!res.ok) {
		console.error(`Analytics Engine SQL API returned ${res.status}: ${body}`);
		process.exit(1);
	}
	return (JSON.parse(body) as { data: Row[] }).data;
}

const sums = "SUM(_sample_interval) AS calls, sumIf(_sample_interval, blob2 = 'error') AS errors";
const where = `WHERE timestamp >= toStartOfInterval(NOW(), INTERVAL '1' DAY) - INTERVAL '${days - 1}' DAY`;
const byDay = await query(
	`SELECT toDate(timestamp) AS day, ${sums} FROM ${dataset} ${where} GROUP BY day ORDER BY day FORMAT JSON`,
);
const byTool = await query(
	`SELECT blob1 AS tool, ${sums} FROM ${dataset} ${where} GROUP BY tool ORDER BY calls DESC FORMAT JSON`,
);

const suffix = (r: Row) => (Number(r.errors) > 0 ? `  (${Number(r.errors)} errors)` : "");
const total = byDay.reduce((n, r) => n + Number(r.calls), 0);
const errors = byDay.reduce((n, r) => n + Number(r.errors), 0);

console.log(`Tool calls, last ${days} days (UTC): ${total} (${errors} errors)`);
console.log(`Days with calls: ${byDay.length} of ${days}`);
if (total === 0) process.exit(0);
console.log("By day:");
for (const r of byDay) console.log(`${r.day}  ${Number(r.calls)}${suffix(r)}`);
console.log("By tool:");
for (const r of byTool) console.log(`${r.tool}  ${Number(r.calls)}${suffix(r)}`);
