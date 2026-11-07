/** An optional output field added after the published schema: `property` with JSON Schema `schema`, under the `properties` of the node at `path` of `tool`'s schema. */
export interface AddedOutputField {
	tool: string;
	/** JSON Pointer into the tool's published schema, to an object node with `properties`. */
	path: string;
	property: string;
	schema: Record<string, unknown>;
}

/** The output fields served beyond the published schema fixture; none of them is required. */
export const ADDED_OUTPUT_FIELDS: readonly AddedOutputField[] = [
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
 * never to `required`. Throws when a path does not resolve to a node with `properties`, or when the property is already there.
 */
export function withAddedFields<T extends Record<string, unknown>>(fixtures: T, fields: readonly AddedOutputField[] = ADDED_OUTPUT_FIELDS): T {
	const copy = structuredClone(fixtures);
	for (const { tool, path, property, schema } of fields) {
		const node = resolvePointer(copy[tool], path);
		if (!isObject(node) || !isObject(node.properties)) throw new Error(`${tool} ${path}: no object node with properties`);
		if (property in node.properties) throw new Error(`${tool} ${path}: property ${property} already exists`);
		node.properties[property] = structuredClone(schema);
	}
	return copy;
}
