import { type Fetcher, get } from "../../src/ingest/http";

/** Downloads `url` through the shared GET (User-Agent + timeout); throws on a non-200 status. */
export async function fetchBytes(fetcher: Fetcher, url: string): Promise<Uint8Array> {
	const res = await get(fetcher, url);
	if (res.status !== 200) {
		await res.body?.cancel();
		throw new Error(`${url}: HTTP ${res.status}`);
	}
	return new Uint8Array(await res.arrayBuffer());
}
