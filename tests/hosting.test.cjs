const test = require("node:test");
const assert = require("node:assert/strict");

// Hosted configuration: a listed site may call the server, others may not; the live AI needs the
// access code; each visitor has a request budget.
process.env.OPENAI_API_KEY = "";
process.env.ACCESS_CODE = "synthetic-code";
process.env.ALLOWED_ORIGINS = "https://example-user.github.io";
process.env.REQUESTS_PER_10_MIN = "3";
const server = require("../server/index.cjs");

test("published site rules: CORS allow-list, access code and rate limit", async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const site = "https://example-user.github.io";
  try {
    const preflight = await fetch(`${base}/api/profile`, { method: "OPTIONS", headers: { Origin: site, "Access-Control-Request-Method": "POST" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), site);
    assert.match(preflight.headers.get("access-control-allow-headers"), /X-Access-Code/);
    assert.equal((await fetch(`${base}/api/profile`, { method: "OPTIONS", headers: { Origin: "https://elsewhere.example" } })).status, 403);

    const capabilities = await (await fetch(`${base}/api/capabilities`, { headers: { Origin: site } })).json();
    assert.equal(capabilities.accessCode, true);

    const post = (code, origin = site) => fetch(`${base}/api/simulation`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(code ? { "X-Access-Code": code } : {}) }, body: "{}" });
    assert.equal((await post("", "https://elsewhere.example")).status, 403);
    const missing = await post("");
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).code, "access_code_required");
    assert.equal((await post("wrong-code")).status, 401);
    // With the code, requests reach validation (400 for this empty body) until the budget of 3 is spent.
    for (let i = 0; i < 3; i++) assert.equal((await post("synthetic-code")).status, 400);
    const limited = await post("synthetic-code");
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "rate_limit");
  } finally { await new Promise(resolve => server.close(resolve)); }
});
