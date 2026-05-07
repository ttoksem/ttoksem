export interface HttpLedgerErrorBody {
  error?: string;
  detail?: string;
}

export class HttpLedgerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: HttpLedgerErrorBody,
  ) {
    super(message);
    this.name = "HttpLedgerError";
  }
}
