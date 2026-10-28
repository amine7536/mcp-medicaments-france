/** The site icon: a white "M" on the accent green, served at `/icon.svg` and used as the favicon. */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0F5E57"/><polygon fill="#FFFFFF" points="136,376 136,136 196,136 256,248 316,136 376,136 376,376 320,376 320,232 268,328 244,328 192,232 192,376"/></svg>`;

/** `GET /icon.svg`: the site icon, cached for a day. */
export function handleIcon(): Response {
	return new Response(ICON_SVG, {
		headers: { "content-type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
	});
}
