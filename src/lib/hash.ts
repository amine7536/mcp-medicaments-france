/** SHA-256 of the UTF-8 encoding of `s`. */
export function sha256(s: string): Promise<ArrayBuffer> {
	return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
}

/** SHA-256 of the UTF-8 encoding of `s`, as lowercase hex. */
export async function sha256Hex(s: string): Promise<string> {
	return Array.from(new Uint8Array(await sha256(s)), (b) => b.toString(16).padStart(2, "0")).join("");
}
