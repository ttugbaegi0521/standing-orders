/** Thrown by integrations that are typed but not connected yet. */
export class NotWiredError extends Error {
  constructor(what: string) {
    super(`${what} is not wired yet`);
    this.name = "NotWiredError";
  }
}
