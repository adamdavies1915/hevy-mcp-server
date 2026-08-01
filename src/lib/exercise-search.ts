/**
 * Local search over the exercise template catalogue.
 *
 * GET /v1/exercise_templates has no search parameter, so matching happens here
 * against the cached catalogue rather than at the API.
 */

export interface ExerciseTemplate {
	id: string;
	title: string;
	type?: string;
	primary_muscle_group?: string;
	secondary_muscle_groups?: string[];
	equipment?: string;
	is_custom?: boolean;
}

export interface SearchResult {
	results: ExerciseTemplate[];
	scanned: number;
	truncated: boolean;
}

/** Lower ranks sort first: exact title, then prefix, then substring. */
function rankTemplate(template: ExerciseTemplate, needle: string): number {
	const title = String(template.title ?? "").toLowerCase();

	let rank: number;
	if (title === needle) rank = 0;
	else if (title.startsWith(needle)) rank = 2;
	else rank = 4;

	// A user's own exercises outrank built-ins at the same match quality.
	return template.is_custom ? rank : rank + 1;
}

export function filterExerciseTemplates(
	templates: ExerciseTemplate[],
	query: string,
	limit = 25,
): SearchResult {
	const needle = query.trim().toLowerCase();

	const matches = templates.filter((template) =>
		String(template.title ?? "")
			.toLowerCase()
			.includes(needle),
	);

	// Stable sort, so equal-ranked matches keep the catalogue's own ordering.
	matches.sort((a, b) => rankTemplate(a, needle) - rankTemplate(b, needle));

	return {
		results: matches.slice(0, limit),
		scanned: templates.length,
		truncated: matches.length > limit,
	};
}
