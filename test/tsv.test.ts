import { describe, expect, it } from "vitest";
import { parseTsv } from "../src/lib/tsv";

describe("parseTsv skipEmptyLines", () => {
	it("drops every empty line and numbers the kept lines", () => {
		expect(parseTsv("a\tb\r\n\r\nc\td\n", 2, "F.txt", { skipEmptyLines: true })).toEqual([
			["a", "b"],
			["c", "d"],
		]);
		expect(() => parseTsv("a\tb\n\nc\n", 2, "F.txt", { skipEmptyLines: true })).toThrow("F.txt: line 2 has 1 columns, expected 2");
	});

	it("rejects an inner empty line by default", () => {
		expect(() => parseTsv("a\tb\n\nc\td\n", 2, "F.txt")).toThrow("F.txt: line 2 has 1 columns, expected 2");
	});

	it("drops lines of stray carriage returns or spaces", () => {
		expect(parseTsv("a\tb\r\n\r\r\n  \r\nc\td\r\n\r\r\n", 2, "F.txt", { skipEmptyLines: true })).toEqual([
			["a", "b"],
			["c", "d"],
		]);
	});

	it("rejects whitespace-only lines by default", () => {
		expect(() => parseTsv("a\tb\r\n\r\r\nc\td\r\n", 2, "F.txt")).toThrow("F.txt: line 2 has 1 columns, expected 2");
		expect(() => parseTsv("a\tb\n  \nc\td\n", 2, "F.txt")).toThrow("F.txt: line 2 has 1 columns, expected 2");
	});
});
