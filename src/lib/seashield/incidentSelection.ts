/**
 * Which incident the incident page shows. An incident requested by link (`/incidents?incident=<id>`) is shown only if
 * the list holds it; otherwise the page says so and never substitutes another incident. Without a request it shows
 * the incident the operator clicked, or the first one, as before.
 */
export type IncidentSelection<T> =
  | { kind: "selected"; incident: T }
  /** A linked incident the list does not hold; `loading` while no backend data has arrived to look in. */
  | { kind: "not-found"; incidentId: string; loading: boolean }
  | { kind: "none" };

export function selectIncident<T extends { id: string; ref: string }>(input: {
  rows: T[];
  /** The incident clicked or, until one is clicked, the linked one. */
  selectedId: string | null;
  /** The `incident` search parameter, if any. */
  linkedId: string | undefined;
  /** True while no backend data has arrived (the list holds demo fixtures). */
  loading: boolean;
}): IncidentSelection<T> {
  const { rows, selectedId, linkedId, loading } = input;
  if (selectedId !== null) {
    const match = rows.find((row) => row.id === selectedId || row.ref === selectedId);
    if (match) return { kind: "selected", incident: match };
    if (selectedId === linkedId) return { kind: "not-found", incidentId: selectedId, loading };
  }
  const [first] = rows;
  return first ? { kind: "selected", incident: first } : { kind: "none" };
}
