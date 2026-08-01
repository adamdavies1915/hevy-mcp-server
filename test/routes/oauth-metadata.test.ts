import { describe, it, expect } from "vitest";
import githubHandler from "../../src/github-handler.js";

const env = {
	OAUTH_KV: {} as any,
	GITHUB_CLIENT_ID: "id",
	GITHUB_CLIENT_SECRET: "secret",
	COOKIE_ENCRYPTION_KEY: "a".repeat(64),
};

async function metadata(headers: Record<string, string>) {
	const response = await githubHandler.fetch(
		new Request("http://hevy.internal:3000/.well-known/oauth-authorization-server", {
			headers,
		}),
		env,
	);
	return (await response.json()) as Record<string, string>;
}

describe("OAuth discovery metadata", () => {
	it("should advertise https endpoints when the proxy forwards a TLS request", async () => {
		// Traefik terminates TLS, so the request arriving here is plain HTTP.
		// Advertising http:// URLs would break clients that require HTTPS.
		const body = await metadata({
			"X-Forwarded-Proto": "https",
			"X-Forwarded-Host": "hevy.cargobay.dev",
		});

		expect(body.issuer).toBe("https://hevy.cargobay.dev");
		expect(body.authorization_endpoint).toBe("https://hevy.cargobay.dev/authorize");
		expect(body.token_endpoint).toBe("https://hevy.cargobay.dev/token");
		expect(body.registration_endpoint).toBe("https://hevy.cargobay.dev/register");
	});

	it("should use the first value when forwarding headers are chained", async () => {
		const body = await metadata({
			"X-Forwarded-Proto": "https, http",
			"X-Forwarded-Host": "hevy.cargobay.dev, internal.local",
		});

		expect(body.issuer).toBe("https://hevy.cargobay.dev");
	});

	it("should fall back to the request URL without forwarding headers", async () => {
		const body = await metadata({});

		expect(body.issuer).toBe("http://hevy.internal:3000");
	});

	it("should honour a forwarded host even when the proto header is absent", async () => {
		const body = await metadata({ "X-Forwarded-Host": "hevy.cargobay.dev" });

		expect(body.issuer).toBe("http://hevy.cargobay.dev");
	});

	it("should advertise the protected resource on the same origin", async () => {
		const response = await githubHandler.fetch(
			new Request("http://hevy.internal:3000/.well-known/oauth-protected-resource", {
				headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "hevy.cargobay.dev" },
			}),
			env,
		);
		const body = (await response.json()) as any;

		expect(body.resource).toBe("https://hevy.cargobay.dev");
		expect(body.authorization_servers).toEqual(["https://hevy.cargobay.dev"]);
	});
});
