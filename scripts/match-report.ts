import { execFileSync } from "node:child_process";

// Read-only match report: remote D1 by default, local D1 with --local.
const target = process.argv.includes("--local") ? "--local" : "--remote";

const QUERIES = [
	"SELECT COUNT(*) AS n FROM shortages WHERE listed = 1",
	"SELECT COUNT(DISTINCT s.id) AS n FROM shortages s JOIN shortage_matches m ON m.shortage_id = s.id WHERE s.listed = 1 AND m.is_best = 1 AND m.confidence >= 0.8",
	"SELECT m.method, COUNT(DISTINCT s.id) AS n FROM shortages s JOIN shortage_matches m ON m.shortage_id = s.id WHERE s.listed = 1 AND m.is_best = 1 GROUP BY m.method ORDER BY m.method",
	"SELECT id, raw_name FROM shortages s WHERE listed = 1 AND NOT EXISTS (SELECT 1 FROM shortage_matches m WHERE m.shortage_id = s.id) ORDER BY CAST(id AS INTEGER)",
];

const out = execFileSync("wrangler", ["d1", "execute", "ruptures", target, "--json", "--command", QUERIES.join("; ")], {
	encoding: "utf8",
	stdio: ["ignore", "pipe", "inherit"],
});
const [listed, matched, methods, unmatched] = (JSON.parse(out) as Array<{ results: Array<Record<string, unknown>> }>).map(
	(r) => r.results,
);

const listedCount = Number(listed?.[0]?.n ?? 0);
const matchedCount = Number(matched?.[0]?.n ?? 0);
const rate = listedCount === 0 ? 0 : (100 * matchedCount) / listedCount;

console.log(`listed=${listedCount}`);
console.log(`matched (confidence >= 0.8)=${matchedCount}`);
console.log(`rate=${rate.toFixed(1)}%`);
console.log(`methods: ${(methods ?? []).map((r) => `${r.method}=${r.n}`).join(" ")}`);
console.log(`unmatched=${unmatched?.length ?? 0}`);
for (const r of unmatched ?? []) console.log(`${r.id} | ${r.raw_name}`);
