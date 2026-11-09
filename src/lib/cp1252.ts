export function decodeCp1252(bytes: Uint8Array | ArrayBuffer): string {
	return new TextDecoder("windows-1252").decode(bytes);
}
