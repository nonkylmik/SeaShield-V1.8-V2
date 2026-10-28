import { FORM_ENDPOINT } from "./config.js";
import { STATUS_MESSAGES, submitLead, validateLead } from "./form.js";

document.documentElement.classList.replace("no-js", "js");

// --- Mobile navigation -------------------------------------------------------------------------

const toggle = document.querySelector("[data-nav-toggle]");
const menu = document.getElementById("site-menu");
if (toggle && menu) {
  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    menu.dataset.open = String(open);
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  menu.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      toggle.focus();
    }
  });
}

// --- Early-access form -------------------------------------------------------------------------

const form = document.getElementById("lead-form");
if (form instanceof HTMLFormElement) {
  const status = document.getElementById("lead-status");
  const submit = form.querySelector('button[type="submit"]');
  const fields = ["name", "email", "company", "role", "message", "consent"];

  if (!FORM_ENDPOINT) form.dataset.state = "unconfigured";
  form.noValidate = true; // Validation messages come from validateLead, shown next to each field.

  const showErrors = (errors) => {
    for (const name of fields) {
      const input = form.elements.namedItem(name);
      const message = document.getElementById(`${name}-error`);
      if (!(input instanceof HTMLElement) || !message) continue;
      message.textContent = errors[name] ?? "";
      if (errors[name]) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const values = Object.fromEntries(fields.map((name) => [name, data.get(name) ?? ""]));
    values.consent = data.get("consent") === "yes";
    values.website = data.get("website") ?? "";

    const errors = validateLead(values);
    showErrors(errors);
    const firstInvalid = fields.find((name) => errors[name]);
    if (firstInvalid) {
      status.textContent = "Please correct the highlighted fields.";
      status.dataset.tone = "error";
      const input = form.elements.namedItem(firstInvalid);
      if (input instanceof HTMLElement) input.focus();
      return;
    }

    submit.disabled = true;
    status.dataset.tone = "pending";
    status.textContent = FORM_ENDPOINT ? "Sending…" : "";
    const outcome = await submitLead(values, { endpoint: FORM_ENDPOINT });
    status.textContent = STATUS_MESSAGES[outcome];
    status.dataset.tone =
      outcome === "sent" ? "success" : outcome === "unconfigured" ? "notice" : "error";
    submit.disabled = false;
    if (outcome === "sent") form.reset();
  });
}
