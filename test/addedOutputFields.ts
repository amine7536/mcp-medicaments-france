/** An optional output field added after the published schema: `property` with JSON Schema `schema`, under the `properties` of the node at `path` of `tool`'s schema. */
export interface AddedOutputField {
	tool: string;
	/** JSON Pointer into the tool's published schema, to an object node with `properties`. */
	path: string;
	property: string;
	schema: Record<string, unknown>;
}

/** A value served beyond the published schema fixture in the `enum` of the node at `path` of `tool`'s schema. */
export interface AddedEnumValue {
	tool: string;
	/** JSON Pointer into the tool's published schema, to a node with an `enum` array. */
	path: string;
	value: unknown;
}

/** Every `expected_return` node of the published schema fixture, by tool. */
const EXPECTED_RETURN_NODES: ReadonlyArray<{ tool: string; path: string }> = [
	{ tool: "search_medicine", path: "/properties/data/oneOf/0/properties/results/items/properties/shortage/anyOf/0/properties/expected_return" },
	{ tool: "search_medicine", path: "/properties/data/oneOf/0/properties/unmatched_shortages/items/properties/expected_return" },
	{ tool: "get_availability", path: "/properties/data/oneOf/0/properties/shortage/anyOf/0/properties/expected_return" },
	{ tool: "get_availability", path: "/properties/data/oneOf/0/properties/possibly_related_shortages/items/properties/expected_return" },
	{ tool: "get_availability", path: "/properties/data/oneOf/1/properties/shortage/anyOf/0/properties/expected_return" },
	{ tool: "get_availability", path: "/properties/data/oneOf/1/properties/possibly_related_shortages/items/properties/expected_return" },
	{ tool: "get_availability", path: "/properties/data/oneOf/3/properties/possibly_related_shortages/items/properties/expected_return" },
	{ tool: "list_current_shortages", path: "/properties/data/oneOf/0/properties/items/items/properties/expected_return" },
	{ tool: "is_major_therapeutic_interest", path: "/properties/data/oneOf/3/properties/possibly_related_shortages/items/properties/expected_return" },
	{ tool: "get_medicine_info", path: "/properties/data/oneOf/0/properties/ansm_shortage/anyOf/0/properties/expected_return" },
	{ tool: "get_medicine_info", path: "/properties/data/oneOf/2/properties/possibly_related_shortages/items/properties/expected_return" },
];

/** The enum values served beyond the published schema fixture. */
export const ADDED_ENUM_VALUES: readonly AddedEnumValue[] = EXPECTED_RETURN_NODES.map(({ tool, path }) => ({
	tool,
	path: `${path}/properties/precision/anyOf/0`,
	value: "season",
}));

/** The substance items of `search_medicine` results. */
const SUBSTANCE_ITEMS = "/properties/data/oneOf/0/properties/results/items/properties/substances/items";

/** The served JSON Schema of a substance's `therapeutic_fractions`. */
const THERAPEUTIC_FRACTIONS = {
	type: "array",
	items: {
		type: "object",
		properties: { name: { type: "string" }, dosage: { type: ["string", "null"] }, reference: { type: "string" } },
		required: ["name", "dosage"],
		additionalProperties: {},
	},
};

/** The served JSON Schema of a HAS opinion list of `get_medicine_info`. */
const HAS_OPINION_ITEMS = {
	type: "array",
	items: {
		type: "object",
		properties: {
			date: { type: "string", format: "date", pattern: "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$" },
			dossier: { type: "string" },
			motif: { type: "string" },
			value: { type: "string" },
			ct_url: { type: "string", format: "uri" },
		},
		required: ["date", "dossier", "motif", "value"],
		additionalProperties: {},
	},
};

/** The output fields served beyond the published schema fixture; none of them is required. */
export const ADDED_OUTPUT_FIELDS: readonly AddedOutputField[] = [
	...EXPECTED_RETURN_NODES.map(({ tool, path }) => ({ tool, path, property: "likely_overdue", schema: { type: "boolean", const: true } })),
	{
		tool: "is_major_therapeutic_interest",
		path: "/properties/data/oneOf/2",
		property: "mitm_total",
		schema: { type: "integer", minimum: 0, maximum: 9007199254740991 },
	},
	{
		tool: "is_major_therapeutic_interest",
		path: "/properties/data/oneOf/2",
		property: "atc_codes",
		schema: { type: "array", items: { type: "string" } },
	},
	{
		tool: "get_availability",
		path: "/properties/data/oneOf/2",
		property: "best_match_total",
		schema: { type: "integer", minimum: 1, maximum: 9007199254740991 },
	},
	{
		tool: "get_availability",
		path: "/properties/data/oneOf/2/properties/candidates/items",
		property: "best_match",
		schema: { type: "boolean", const: true },
	},
	{
		tool: "is_major_therapeutic_interest",
		path: "/properties/data/oneOf/2",
		property: "best_match_total",
		schema: { type: "integer", minimum: 1, maximum: 9007199254740991 },
	},
	{
		tool: "is_major_therapeutic_interest",
		path: "/properties/data/oneOf/2/properties/candidates/items",
		property: "best_match",
		schema: { type: "boolean", const: true },
	},
	{
		tool: "get_medicine_info",
		path: "/properties/data/oneOf/1",
		property: "best_match_total",
		schema: { type: "integer", minimum: 1, maximum: 9007199254740991 },
	},
	{
		tool: "get_medicine_info",
		path: "/properties/data/oneOf/1/properties/candidates/items",
		property: "best_match",
		schema: { type: "boolean", const: true },
	},
	...[
		{ tool: "get_availability", path: "/properties/data/oneOf/2" },
		{ tool: "is_major_therapeutic_interest", path: "/properties/data/oneOf/2" },
		{ tool: "get_medicine_info", path: "/properties/data/oneOf/1" },
	].map(({ tool, path }) => ({ tool, path, property: "in_shortage_total", schema: { type: "integer", minimum: 1, maximum: 9007199254740991 } })),
	...["holder", "marketing_status"].map((property) => ({
		tool: "search_medicine",
		path: "/properties/data/oneOf/0/properties/results/items",
		property,
		schema: { type: "string" },
	})),
	{ tool: "search_medicine", path: SUBSTANCE_ITEMS, property: "reference", schema: { type: "string" } },
	{ tool: "search_medicine", path: SUBSTANCE_ITEMS, property: "therapeutic_fractions", schema: THERAPEUTIC_FRACTIONS },
	{ tool: "get_medicine_info", path: "/properties/data/oneOf/0/properties/medicine", property: "amm_status", schema: { type: "string" } },
	{
		tool: "get_medicine_info",
		path: "/properties/data/oneOf/0/properties/medicine",
		property: "substances",
		schema: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					dosage: { type: ["string", "null"] },
					reference: { type: "string" },
					therapeutic_fractions: THERAPEUTIC_FRACTIONS,
				},
				required: ["name", "dosage"],
				additionalProperties: {},
			},
		},
	},
	{
		tool: "get_medicine_info",
		path: "/properties/data/oneOf/0",
		property: "has_opinions",
		schema: {
			type: "object",
			properties: { smr: HAS_OPINION_ITEMS, asmr: HAS_OPINION_ITEMS },
			required: ["smr", "asmr"],
			additionalProperties: {},
		},
	},
];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The node at JSON Pointer `path` of `root`, or undefined when it does not resolve. */
function resolvePointer(root: unknown, path: string): unknown {
	if (path === "") return root;
	let node = root;
	for (const raw of path.split("/").slice(1)) {
		const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
		if (Array.isArray(node)) node = node[Number(key)];
		else if (isObject(node)) node = node[key];
		else return undefined;
	}
	return node;
}

/**
 * A deep copy of `fixtures` (tool name to output schema) with each field of `fields` added under its node's `properties`,
 * never to `required`, and each value of `enums` appended to its node's `enum`. Throws when a path does not resolve to a node
 * with `properties` (or with an `enum` array), when the property is already there, or when the value is already in the enum.
 */
export function withAddedFields<T extends Record<string, unknown>>(
	fixtures: T,
	fields: readonly AddedOutputField[] = ADDED_OUTPUT_FIELDS,
	enums: readonly AddedEnumValue[] = ADDED_ENUM_VALUES,
): T {
	const copy = structuredClone(fixtures);
	for (const { tool, path, property, schema } of fields) {
		const node = resolvePointer(copy[tool], path);
		if (!isObject(node) || !isObject(node.properties)) throw new Error(`${tool} ${path}: no object node with properties`);
		if (property in node.properties) throw new Error(`${tool} ${path}: property ${property} already exists`);
		node.properties[property] = structuredClone(schema);
	}
	for (const { tool, path, value } of enums) {
		const node = resolvePointer(copy[tool], path);
		if (!isObject(node) || !Array.isArray(node.enum)) throw new Error(`${tool} ${path}: no node with an enum array`);
		if (node.enum.includes(value)) throw new Error(`${tool} ${path}: enum value ${String(value)} already exists`);
		node.enum.push(structuredClone(value));
	}
	return copy;
}
