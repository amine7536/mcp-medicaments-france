import { describe, expect, it } from "vitest";
import { check } from "../scripts/golden-check";

describe("golden check", () => {
	it("fails an answer whose only near-referral words are depuis/puis", () => {
		expect(check("Le Brevibloc est en rupture depuis mars, puis il reviendra.")).toBe("no pharmacist or doctor referral");
	});

	it("passes an answer that refers to a pharmacien", () => {
		expect(check("Demandez à votre pharmacien.")).toBeNull();
	});

	it("fails an answer that names Esmocard", () => {
		expect(check("Votre médecin peut prescrire Esmocard.")).toBe("names ESMOCARD");
	});
});
