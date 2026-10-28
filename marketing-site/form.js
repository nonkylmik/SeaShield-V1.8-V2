/**
 * Early-access form logic, kept free of the DOM so it can be tested with node:test.
 * Nothing here stores data; submitLead only sends when an endpoint is configured.
 */

export const LIMITS = { name: 100, email: 254, company: 120, role: 100, message: 1000 };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field errors keyed by field name; an empty object means the input is valid. */
export function validateLead(values) {
  const errors = {};
  const text = (key) => String(values[key] ?? "").trim();
  const required = { name: "your name", company: "your company", role: "your role" };
  for (const [key, label] of Object.entries(required)) {
    if (!text(key)) errors[key] = `Enter ${label}.`;
    else if (text(key).length > LIMITS[key])
      errors[key] = `Use ${LIMITS[key]} characters or fewer.`;
  }
  const email = text("email");
  if (!email) errors.email = "Enter your work email address.";
  else if (email.length > LIMITS.email || !EMAIL.test(email))
    errors.email = "Enter a valid email address, like name@company.com.";
  if (text("message").length > LIMITS.message)
    errors.message = `Use ${LIMITS.message} characters or fewer.`;
  if (values.consent !== true) errors.consent = "Confirm that you have read the privacy notice.";
  return errors;
}

/** The hidden honeypot field is left empty by people and filled by many bots. */
export function isLikelySpam(values) {
  return String(values.website ?? "").trim() !== "";
}

/**
 * Sends a validated request. Returns one of:
 * - "unconfigured": no endpoint is set, so nothing was sent;
 * - "rejected": the request looked automated and was not sent;
 * - "sent": the endpoint confirmed receipt (2xx response);
 * - "failed": the request failed or the endpoint did not confirm receipt.
 */
export async function submitLead(values, { endpoint, fetchImpl = globalThis.fetch }) {
  if (!endpoint) return "unconfigured";
  if (isLikelySpam(values)) return "rejected";
  const body = {
    name: String(values.name).trim(),
    email: String(values.email).trim(),
    company: String(values.company).trim(),
    role: String(values.role).trim(),
    message: String(values.message ?? "").trim(),
    consent: true,
  };
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/** What the form tells the visitor for each outcome. */
export const STATUS_MESSAGES = {
  unconfigured: "This form isn't connected yet, so your details have not been sent or stored.",
  rejected: "Your request could not be sent.",
  sent: "Thank you. Your request has been received and we will be in touch.",
  failed: "Your request could not be sent. Please try again later.",
};
