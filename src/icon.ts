/** The site icon: a medicine box with a capsule and a barcode, served at `/icon.svg` and used as the favicon. */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#E6F0EE"/><path d="M72 184 L128 136 H448 L392 184 Z" fill="#FFFFFF" stroke="#0F5E57" stroke-width="16" stroke-linejoin="round"/><path d="M392 184 L448 136 V328 L392 376 Z" fill="#CFE3DF" stroke="#0F5E57" stroke-width="16" stroke-linejoin="round"/><rect x="72" y="184" width="320" height="192" fill="#FFFFFF" stroke="#0F5E57" stroke-width="16" stroke-linejoin="round"/><rect x="80" y="192" width="304" height="44" fill="#0F5E57"/><g transform="rotate(-35 150 300)"><rect x="110" y="282" width="80" height="36" rx="18" fill="#FFFFFF" stroke="#0F5E57" stroke-width="12"/><path d="M150 282 H172 A18 18 0 0 1 172 318 H150 Z" fill="#0F5E57"/></g><g fill="#0F5E57"><rect x="232" y="268" width="8" height="80"/><rect x="248" y="268" width="6" height="80"/><rect x="262" y="268" width="14" height="80"/><rect x="284" y="268" width="6" height="80"/><rect x="298" y="268" width="10" height="80"/><rect x="316" y="268" width="14" height="80"/><rect x="338" y="268" width="6" height="80"/><rect x="352" y="268" width="10" height="80"/></g></svg>`;

/** `GET /icon.svg`: the site icon, cached for a day. */
export function handleIcon(): Response {
	return new Response(ICON_SVG, {
		headers: { "content-type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
	});
}
