import { z } from "zod";

export const TUTOR_ACTIONS_WIRE = ["hint", "explain_differently", "show_source", "challenge", "reveal_solution"] as const;

export const CreateConversationSchema = z.object({ title: z.string().trim().max(120).optional() });

/** Fields of the multipart message form (the image file is read separately). */
export const SendMessageFieldsSchema = z
  .object({
    text: z.string().trim().max(4000).default(""),
    action: z.enum(TUTOR_ACTIONS_WIRE).optional(),
  })
  .refine((v) => v.text.length > 0 || v.action, "Type a message or choose an action");

export type TutorAnchorView = {
  id: string;
  ref: string;
  sourceId: string;
  sourceTitle: string;
  sourceKind: string;
  startMs: number | null;
  endMs: number | null;
  page: number | null;
  excerpt: string;
};

export type TutorMessageView = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  action: string | null;
  createdAt: string;
  images: { url: string; mimeType: string }[];
  anchors: TutorAnchorView[];
  /** True when no passage in the sources matched the question. */
  noSourceMatch?: boolean;
  /** No passage matched, but the student attached an image the answer draws on. */
  fromImageOnly?: boolean;
};

export type ConversationSummary = { id: string; title: string; updatedAt: string; messageCount: number };

export type ConversationView = { id: string; title: string; messages: TutorMessageView[]; model: string };

/** Server-sent events on POST …/messages */
export type TutorStreamEventWire =
  | { type: "user"; message: TutorMessageView }
  | { type: "sources"; anchors: TutorAnchorView[]; noSourceMatch: boolean; fromImageOnly: boolean }
  | { type: "delta"; text: string }
  | { type: "done"; message: TutorMessageView }
  | { type: "error"; message: string };
