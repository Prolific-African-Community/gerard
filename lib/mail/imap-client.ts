import { ImapFlow } from "imapflow";

import type { NormalizedMailMessage } from "./types";

export type ImapImportStep =
  | "config"
  | "connect"
  | "mailbox"
  | "mailbox_count"
  | "fetch"
  | "parse"
  | "logout";

type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  limit: number;
};

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (!value) {
    return defaultValue;
  }

  return value.trim().toLowerCase() === "true";
}

function parsePositiveInteger(value: string | undefined, defaultValue: number) {
  if (!value) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : defaultValue;
}

export function getImapConfig() {
  if (process.env.MAIL_IMPORT_PROVIDER?.trim().toLowerCase() !== "imap") {
    return null;
  }

  const host = process.env.MAIL_IMPORT_HOST?.trim();
  const user = process.env.MAIL_IMPORT_USER?.trim();
  const password = process.env.MAIL_IMPORT_PASSWORD;

  if (!host || !user || !password) {
    return null;
  }

  const config: ImapConfig = {
    host,
    port: parsePositiveInteger(process.env.MAIL_IMPORT_PORT, 993),
    secure: parseBoolean(process.env.MAIL_IMPORT_SECURE, true),
    user,
    password,
    limit: parsePositiveInteger(process.env.MAIL_IMPORT_LIMIT, 50),
  };

  return config;
}

export class ImapImportError extends Error {
  step: ImapImportStep;
  causeValue: unknown;

  constructor(step: ImapImportStep, message: string, causeValue?: unknown) {
    super(message);
    this.name = "ImapImportError";
    this.step = step;
    this.causeValue = causeValue;
  }
}

function getObjectProperty(value: unknown, key: string) {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return null;
  }

  return (value as Record<string, unknown>)[key];
}

function getErrorDetails(error: unknown) {
  return {
    name: error instanceof Error ? error.name : null,
    message: error instanceof Error ? error.message : String(error),
    code: getObjectProperty(error, "code"),
    response: getObjectProperty(error, "response"),
    stack: error instanceof Error ? error.stack ?? null : null,
  };
}

export function logImapError(
  step: ImapImportStep,
  config: Pick<ImapConfig, "host" | "port" | "user">,
  error: unknown,
) {
  console.error("IMAP import failed", {
    step,
    provider: "imap",
    host: config.host,
    port: config.port,
    user: config.user,
    ...getErrorDetails(error),
  });
}

function stripQuotes(value: string) {
  return value.replace(/^<|>$/g, "").trim();
}

function parseAddressHeaderValue(value: string | null) {
  if (!value) {
    return [];
  }

  return decodeHeaderValue(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const emailMatch = part.match(/<([^>]+)>/);
      return (emailMatch?.[1] ?? part).replace(/^"+|"+$/g, "").trim();
    })
    .filter(Boolean);
}

function decodeQuotedPrintable(value: string) {
  const normalizedValue = value
    .replace(/=\r?\n/g, "")
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );

  return Buffer.from(normalizedValue, "latin1").toString("utf8");
}

function decodeBodySection(value: string, encoding: string | null) {
  if (!encoding) {
    return value;
  }

  const normalizedEncoding = encoding.toLowerCase();

  if (normalizedEncoding === "base64") {
    try {
      return Buffer.from(value.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return value;
    }
  }

  if (normalizedEncoding === "quoted-printable") {
    return decodeQuotedPrintable(value);
  }

  return value;
}

function decodeHeaderValue(value: string) {
  return value.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g,
    (_match, charset: string, encoding: string, encodedValue: string) => {
      try {
        if (encoding.toUpperCase() === "B") {
          return Buffer.from(encodedValue, "base64").toString("utf8");
        }

        return decodeQuotedPrintable(encodedValue.replace(/_/g, " "));
      } catch {
        return charset ? encodedValue : encodedValue;
      }
    },
  );
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function getHeaderValue(headers: Map<string, string>, key: string) {
  return headers.get(key.toLowerCase()) ?? null;
}

function parseHeaders(rawHeaders: string) {
  const headers = new Map<string, string>();
  let currentKey: string | null = null;

  for (const rawLine of rawHeaders.split(/\r?\n/)) {
    if (/^\s/.test(rawLine) && currentKey) {
      headers.set(
        currentKey,
        `${headers.get(currentKey) ?? ""} ${rawLine.trim()}`.trim(),
      );
      continue;
    }

    const separatorIndex = rawLine.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    currentKey = rawLine.slice(0, separatorIndex).trim().toLowerCase();
    headers.set(currentKey, rawLine.slice(separatorIndex + 1).trim());
  }

  return headers;
}

function splitMimeSections(body: string, boundary: string) {
  const marker = `--${boundary}`;
  return body
    .split(marker)
    .map((section) => section.trim())
    .filter((section) => section && section !== "--");
}

function parseMimePart(rawPart: string): { textParts: string[]; htmlParts: string[] } {
  const [rawHeaders = "", ...rest] = rawPart.split(/\r?\n\r?\n/);
  const body = rest.join("\n\n").trim();
  const headers = parseHeaders(rawHeaders);
  const contentTypeHeader = getHeaderValue(headers, "content-type") ?? "text/plain";
  const contentTransferEncoding = getHeaderValue(
    headers,
    "content-transfer-encoding",
  );
  const boundaryMatch = contentTypeHeader.match(/boundary="?([^";]+)"?/i);

  if (boundaryMatch) {
    return splitMimeSections(body, boundaryMatch[1]).reduce(
      (result, section) => {
        const nested = parseMimePart(section);
        result.textParts.push(...nested.textParts);
        result.htmlParts.push(...nested.htmlParts);
        return result;
      },
      { textParts: [] as string[], htmlParts: [] as string[] },
    );
  }

  const decodedBody = decodeBodySection(body, contentTransferEncoding).trim();

  if (/text\/html/i.test(contentTypeHeader)) {
    return { textParts: [], htmlParts: [decodedBody] };
  }

  if (/text\/plain/i.test(contentTypeHeader)) {
    return { textParts: [decodedBody], htmlParts: [] };
  }

  return { textParts: [], htmlParts: [] };
}

function parseRawMessage(source: string) {
  const [rawHeaders = "", ...rest] = source.split(/\r?\n\r?\n/);
  const headers = parseHeaders(rawHeaders);
  const body = rest.join("\n\n");
  const contentTypeHeader = getHeaderValue(headers, "content-type") ?? "text/plain";
  const boundaryMatch = contentTypeHeader.match(/boundary="?([^";]+)"?/i);
  const contentTransferEncoding = getHeaderValue(
    headers,
    "content-transfer-encoding",
  );

  let textParts: string[] = [];
  let htmlParts: string[] = [];

  if (boundaryMatch) {
    const parsedParts = splitMimeSections(body, boundaryMatch[1]).reduce(
      (result, section) => {
        const nested = parseMimePart(section);
        result.textParts.push(...nested.textParts);
        result.htmlParts.push(...nested.htmlParts);
        return result;
      },
      { textParts: [] as string[], htmlParts: [] as string[] },
    );

    textParts = parsedParts.textParts;
    htmlParts = parsedParts.htmlParts;
  } else {
    const decodedBody = decodeBodySection(body, contentTransferEncoding).trim();

    if (/text\/html/i.test(contentTypeHeader)) {
      htmlParts = [decodedBody];
    } else {
      textParts = [decodedBody];
    }
  }

  const bodyText = textParts.join("\n\n").trim() || stripHtml(htmlParts.join("\n\n"));
  const bodyHtml = htmlParts.join("\n\n").trim() || null;
  const messageIdHeader = getHeaderValue(headers, "message-id");
  const subjectHeader = getHeaderValue(headers, "subject");
  const toHeader = getHeaderValue(headers, "to");
  const ccHeader = getHeaderValue(headers, "cc");
  const fromHeader = getHeaderValue(headers, "from");
  const fromNameMatch = fromHeader ? decodeHeaderValue(fromHeader).match(/^"?([^"<]+)"?\s*</) : null;
  const fromAddressMatch = fromHeader ? decodeHeaderValue(fromHeader).match(/<([^>]+)>/) : null;

  return {
    messageId: messageIdHeader ? stripQuotes(decodeHeaderValue(messageIdHeader)) : null,
    subject: subjectHeader ? decodeHeaderValue(subjectHeader) : "",
    fromName: fromNameMatch?.[1]?.trim() ?? null,
    fromAddress: fromAddressMatch?.[1]?.trim() ?? null,
    toAddresses: parseAddressHeaderValue(toHeader),
    ccAddresses: parseAddressHeaderValue(ccHeader),
    bodyText,
    bodyHtml,
  };
}

function buildBodyPreview(bodyText: string) {
  return bodyText.replace(/\s+/g, " ").trim().slice(0, 220);
}

function toIsoDate(value: string | Date | undefined) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsedDate = new Date(value);
    return Number.isNaN(parsedDate.getTime())
      ? new Date().toISOString()
      : parsedDate.toISOString();
  }

  return new Date().toISOString();
}

export async function fetchRecentImapMessages(
  config: ImapConfig,
): Promise<NormalizedMailMessage[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    logger: false,
  });

  try {
    console.info("IMAP import step", {
      step: "connect",
      provider: "imap",
      host: config.host,
      port: config.port,
      user: config.user,
    });

    try {
      await client.connect();
    } catch (error) {
      logImapError("connect", config, error);
      throw new ImapImportError("connect", "Authentification IMAP refusée", error);
    }

    console.info("IMAP import step", {
      step: "mailbox",
      provider: "imap",
      mailbox: "INBOX",
      user: config.user,
    });

    let mailbox;
    try {
      mailbox = await client.mailboxOpen("INBOX", { readOnly: true });
    } catch (error) {
      logImapError("mailbox", config, error);
      throw new ImapImportError("mailbox", "Boîte INBOX inaccessible", error);
    }

    const messageCount = mailbox.exists ?? 0;

    console.info("IMAP import step", {
      step: "mailbox_count",
      provider: "imap",
      user: config.user,
      messageCount,
    });

    if (messageCount === 0) {
      return [];
    }

    const start = Math.max(1, messageCount - config.limit + 1);
    const messages: NormalizedMailMessage[] = [];

    console.info("IMAP import step", {
      step: "fetch",
      provider: "imap",
      user: config.user,
      range: `${start}:*`,
      limit: config.limit,
    });

    try {
      for await (const message of client.fetch(
        `${start}:*`,
        {
          uid: true,
          envelope: true,
          source: true,
          internalDate: true,
        },
        { uid: false },
      )) {
        try {
          const rawSource = message.source?.toString("utf8") ?? "";
          const parsedMessage = parseRawMessage(rawSource);
          const from = message.envelope?.from?.[0];
          const sourceEmailId =
            parsedMessage.messageId || `imap:${message.uid ?? message.seq}`;
          const subject =
            parsedMessage.subject ||
            message.envelope?.subject ||
            "(Sans objet)";
          const bodyText = parsedMessage.bodyText || "";

          messages.push({
            sourceEmailId,
            messageId: parsedMessage.messageId,
            subject,
            fromName:
              parsedMessage.fromName ??
              (from?.name ? decodeHeaderValue(from.name) : null),
            fromAddress: parsedMessage.fromAddress ?? from?.address ?? null,
            toAddresses: parsedMessage.toAddresses,
            ccAddresses: parsedMessage.ccAddresses,
            receivedAt: toIsoDate(message.internalDate),
            bodyText,
            bodyHtml: parsedMessage.bodyHtml,
            rawBodyText: bodyText,
            rawBodyHtml: parsedMessage.bodyHtml,
            bodyPreview: buildBodyPreview(bodyText),
          });
        } catch (error) {
          logImapError("parse", config, error);
          throw new ImapImportError("parse", "Parsing email impossible", error);
        }
      }
    } catch (error) {
      if (error instanceof ImapImportError) {
        throw error;
      }

      logImapError("fetch", config, error);
      throw new ImapImportError("fetch", "Lecture des emails impossible", error);
    }

    return messages.sort((left, right) =>
      right.receivedAt.localeCompare(left.receivedAt),
    );
  } finally {
    console.info("IMAP import step", {
      step: "logout",
      provider: "imap",
      user: config.user,
    });
    await client.logout().catch((error) => {
      logImapError("logout", config, error);
    });
  }
}
