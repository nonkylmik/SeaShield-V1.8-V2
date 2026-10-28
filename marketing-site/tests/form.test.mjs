// Early-access form: validation, spam check, and that nothing is sent or reported as sent unless an
// endpoint is configured and confirms receipt.
import assert from "node:assert/strict";
import { test } from "node:test";

import { FORM_ENDPOINT } from "../config.js";
import { isLikelySpam, LIMITS, STATUS_MESSAGES, submitLead, validateLead } from "../form.js";

const VALID = {
  name: "Ada Example",
  email: "ada@example.com",
  company: "Example Shipping",
  role: "Fleet security manager",
  message: "",
  consent: true,
  website: "",
};

test("the form ships unconfigured", () => {
  assert.equal(FORM_ENDPOINT, null);
});

test("a complete request is valid; the workflow question is optional", () => {
  assert.deepEqual(validateLead(VALID), {});
  assert.deepEqual(validateLead({ ...VALID, message: "Too many separate tools." }), {});
});

test("every required field is reported when missing", () => {
  const errors = validateLead({ consent: false });
  assert.deepEqual(Object.keys(errors).sort(), ["company", "consent", "email", "name", "role"]);
  assert.ok(validateLead({ ...VALID, name: "   " }).name, "whitespace is not a name");
});

test("email addresses must look valid", () => {
  for (const email of ["ada", "ada@", "@example.com", "ada@example", "ada example@example.com"]) {
    assert.ok(validateLead({ ...VALID, email }).email, email);
  }
  assert.equal(validateLead({ ...VALID, email: " ada@example.co.uk " }).email, undefined);
});

test("length limits match the inputs' maxlength", () => {
  for (const [field, max] of Object.entries(LIMITS)) {
    const value = field === "email" ? `${"a".repeat(max)}@example.com` : "a".repeat(max + 1);
    assert.ok(validateLead({ ...VALID, [field]: value })[field], field);
  }
});

test("consent must be explicitly given", () => {
  for (const consent of [false, undefined, "yes", "true"]) {
    assert.ok(validateLead({ ...VALID, consent }).consent, String(consent));
  }
});

test("the honeypot field flags automated submissions", () => {
  assert.equal(isLikelySpam(VALID), false);
  assert.equal(isLikelySpam({ ...VALID, website: "https://spam.example" }), true);
});

test("without an endpoint nothing is sent, and the visitor is told so", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(null, { status: 200 });
  };
  for (const endpoint of [null, undefined, ""]) {
    assert.equal(await submitLead(VALID, { endpoint, fetchImpl }), "unconfigured");
  }
  assert.equal(calls, 0);
  assert.match(STATUS_MESSAGES.unconfigured, /not been sent or stored/);
  assert.doesNotMatch(STATUS_MESSAGES.unconfigured, /thank|received/i);
});

test("success is reported only when the endpoint confirms receipt", async () => {
  const requests = [];
  const respond = (status) => async (url, init) => {
    requests.push({ url, init });
    return new Response(null, { status });
  };
  const endpoint = "https://forms.example.test/lead";
  assert.equal(await submitLead(VALID, { endpoint, fetchImpl: respond(201) }), "sent");
  assert.equal(await submitLead(VALID, { endpoint, fetchImpl: respond(500) }), "failed");
  assert.equal(await submitLead(VALID, { endpoint, fetchImpl: respond(302) }), "failed");
  const thrown = async () => {
    throw new TypeError("network down");
  };
  assert.equal(await submitLead(VALID, { endpoint, fetchImpl: thrown }), "failed");

  const sent = JSON.parse(requests[0].init.body);
  assert.deepEqual(Object.keys(sent).sort(), [
    "company",
    "consent",
    "email",
    "message",
    "name",
    "role",
  ]);
  assert.equal(requests[0].init.method, "POST");
});

test("a flagged submission is never sent", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(null, { status: 200 });
  };
  const outcome = await submitLead(
    { ...VALID, website: "x" },
    { endpoint: "https://forms.example.test/lead", fetchImpl },
  );
  assert.equal(outcome, "rejected");
  assert.equal(calls, 0);
  assert.doesNotMatch(STATUS_MESSAGES.rejected, /thank|received/i);
});
