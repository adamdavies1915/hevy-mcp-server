import { describe, it, expect, vi, beforeEach } from "vitest";
import { HevyClient } from "../../src/lib/client.js";

function page(templates: any[], pageCount: number) {
	return { page: 1, page_count: pageCount, exercise_templates: templates };
}

const t = (id: string, title: string, extra: Record<string, any> = {}) => ({
	id,
	title,
	type: "weight_reps",
	primary_muscle_group: "chest",
	equipment: "barbell",
	is_custom: false,
	...extra,
});

describe("HevyClient.searchExerciseTemplates", () => {
	let client: HevyClient;

	beforeEach(() => {
		client = new HevyClient({ apiKey: "test" });
	});

	it("should match titles case-insensitively on a substring", async () => {
		vi.spyOn(client, "getExerciseTemplates").mockResolvedValue(
			page([t("1", "Bench Press"), t("2", "Squat"), t("3", "Incline Bench Press")], 1),
		);

		const { results } = await client.searchExerciseTemplates("bench");

		expect(results.map((r) => r.title)).toEqual(["Bench Press", "Incline Bench Press"]);
	});

	it("should rank exact matches above prefix above substring", async () => {
		vi.spyOn(client, "getExerciseTemplates").mockResolvedValue(
			page([t("1", "Squat Row"), t("2", "Goblet Squat"), t("3", "Squat")], 1),
		);

		const { results } = await client.searchExerciseTemplates("squat");

		expect(results.map((r) => r.title)).toEqual(["Squat", "Squat Row", "Goblet Squat"]);
	});

	it("should rank a custom exercise above a built-in of equal match quality", async () => {
		vi.spyOn(client, "getExerciseTemplates").mockResolvedValue(
			page([t("1", "Squat"), t("2", "Squat", { is_custom: true })], 1),
		);

		const { results } = await client.searchExerciseTemplates("squat");

		expect(results[0].is_custom).toBe(true);
	});

	it("should page through the whole catalogue", async () => {
		const spy = vi
			.spyOn(client, "getExerciseTemplates")
			.mockResolvedValueOnce(page([t("1", "Ab Wheel")], 3))
			.mockResolvedValueOnce(page([t("2", "Bench Press")], 3))
			.mockResolvedValueOnce(page([t("3", "Bench Dip")], 3));

		const { results, scanned } = await client.searchExerciseTemplates("bench");

		expect(spy).toHaveBeenCalledTimes(3);
		expect(scanned).toBe(3);
		// Equal-rank prefix matches keep the order the API returned them in,
		// which is alphabetical for the live catalogue.
		expect(results.map((r) => r.title)).toEqual(["Bench Press", "Bench Dip"]);
	});

	it("should stop at maxPages rather than paging forever", async () => {
		const spy = vi.spyOn(client, "getExerciseTemplates").mockResolvedValue(page([t("1", "X")], 999));

		await client.searchExerciseTemplates("x", { maxPages: 4 });

		expect(spy).toHaveBeenCalledTimes(4);
	});

	it("should cap results at the limit and flag truncation", async () => {
		vi.spyOn(client, "getExerciseTemplates").mockResolvedValue(
			page(
				Array.from({ length: 30 }, (_, i) => t(String(i), `Curl ${i}`)),
				1,
			),
		);

		const { results, truncated } = await client.searchExerciseTemplates("curl", { limit: 5 });

		expect(results).toHaveLength(5);
		expect(truncated).toBe(true);
	});

	it("should return no results for a term that matches nothing", async () => {
		vi.spyOn(client, "getExerciseTemplates").mockResolvedValue(page([t("1", "Squat")], 1));

		const { results, truncated } = await client.searchExerciseTemplates("kayaking");

		expect(results).toEqual([]);
		expect(truncated).toBe(false);
	});

	it("should tolerate a page with no templates key", async () => {
		vi.spyOn(client, "getExerciseTemplates").mockResolvedValue({ page: 1, page_count: 1 });

		const { results, scanned } = await client.searchExerciseTemplates("bench");

		expect(results).toEqual([]);
		expect(scanned).toBe(0);
	});
});
