/** Runs `html` through `rewriter` to the end, so every handler fires. */
export async function consume(rewriter: HTMLRewriter, html: string): Promise<void> {
	await rewriter.transform(new Response(html)).arrayBuffer();
}
