import type { ClientProfile } from "../dispatch/client-profiles";
import { parseFallbackTransportEmail } from "./parsers/fallback-parser";
import {
  canParseFruytierEmail,
  parseFruytierEmail,
} from "./parsers/fruytier-parser";
import { canParseHydroEmail, parseHydroEmail } from "./parsers/hydro-parser";
import { parseMinimalEmailPreview } from "./parsers/minimal-parser";
import type { MissionImportPreview, NormalizedMailMessage } from "./types";

export type MailParserContext = {
  email: NormalizedMailMessage;
  profile: ClientProfile | null;
};

export interface MailParser {
  id: string;
  priority: number;
  canParse(context: MailParserContext): boolean;
  parse(context: MailParserContext): MissionImportPreview[];
}

const parsers: MailParser[] = [
  {
    id: "fruytier",
    priority: 400,
    canParse: ({ email, profile }) => canParseFruytierEmail(email, profile),
    parse: ({ email, profile }) => parseFruytierEmail(email, profile),
  },
  {
    id: "hydro",
    priority: 300,
    canParse: ({ email, profile }) => canParseHydroEmail(email, profile),
    parse: ({ email, profile }) => parseHydroEmail(email, profile),
  },
  {
    id: "fallback",
    priority: 200,
    canParse: () => true,
    parse: ({ email, profile }) => parseFallbackTransportEmail(email, profile),
  },
  {
    id: "minimal",
    priority: 100,
    canParse: () => true,
    parse: ({ email, profile }) => parseMinimalEmailPreview(email, profile),
  },
];

export const mailParserRegistry: readonly MailParser[] = parsers.sort(
  (left, right) => right.priority - left.priority,
);
