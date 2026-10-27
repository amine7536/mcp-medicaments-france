export default {
	async fetch(): Promise<Response> {
		return Response.json({ error: "not_found" }, { status: 404 });
	},

	async scheduled(): Promise<void> {
		console.log("scheduled: noop");
	},
} satisfies ExportedHandler<Env>;
