import { HTTP_STATUS } from "./runtimeConfig.js";
import { RESPONSES_ITEM } from "../translator/schema/blocks.js";
import { RESPONSES_EVENT } from "../translator/schema/streamEvents.js";

export const RESPONSES_STATE_FIELDS = ["previous_response_id"];
export const RESPONSES_ENCRYPTED_FIELDS = ["encrypted_content", "reasoning_encrypted_content"];
export const RESPONSES_ITEM_STATE_FIELDS = ["id", "status", "internal_chat_message_metadata_passthrough"];
export const RESPONSES_FINGERPRINT_OMIT_FIELDS = new Set([
  ...RESPONSES_ITEM_STATE_FIELDS, ...RESPONSES_ENCRYPTED_FIELDS, "annotations", "phase",
]);

// Deliberately exclude generic validation, model-not-found, image limits,
// throttling and capacity failures: they do not establish a backend change.
export const RESPONSES_BACKEND_ERROR_PATTERNS = [
  {
    statuses: [HTTP_STATUS.BAD_REQUEST],
    message: /(?:requested )?item was created under a different[^\r\n]*OpenAI resource/i,
  },
  {
    statuses: [HTTP_STATUS.BAD_REQUEST],
    message: /use the same resource that created the item to access it/i,
  },
  {
    statuses: [HTTP_STATUS.BAD_REQUEST, HTTP_STATUS.NOT_FOUND],
    message: /(?:no response found with id|previous response[^\r\n]*(?:not found|does not exist))/i,
    reference: "response",
  },
  {
    statuses: [HTTP_STATUS.BAD_REQUEST, HTTP_STATUS.NOT_FOUND],
    message: /(?:no item found with id|item with id[^\r\n]*(?:not found|does not exist))/i,
    reference: "item",
  },
  {
    statuses: [HTTP_STATUS.BAD_REQUEST],
    code: "invalid_encrypted_content",
    message: /encrypted content[^\r\n]*(?:could not be verified|cannot be verified|failed verification)/i,
  },
];

// HTTP-200 failures need an explicit Responses error code/status as well as
// the resource-specific message; a message alone cannot authorize a replay.
export const RESPONSES_STATE_ERROR_CODES = new Map([
  ["invalid_request", HTTP_STATUS.BAD_REQUEST],
  ["invalid_request_error", HTTP_STATUS.BAD_REQUEST],
  ["invalid_encrypted_content", HTTP_STATUS.BAD_REQUEST],
  ["response_not_found", HTTP_STATUS.NOT_FOUND],
  ["item_not_found", HTTP_STATUS.NOT_FOUND],
]);

export const RESPONSES_SETUP_EVENTS = new Set([
  RESPONSES_EVENT.CREATED, RESPONSES_EVENT.QUEUED, RESPONSES_EVENT.IN_PROGRESS,
]);
export const RESPONSES_CALL_OUTPUT_TYPES = new Map([
  [RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, RESPONSES_ITEM.FUNCTION_CALL],
  [RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT, RESPONSES_ITEM.CUSTOM_TOOL_CALL],
]);
export const RESPONSES_CALL_TYPES = new Set(RESPONSES_CALL_OUTPUT_TYPES.values());
export const RESPONSES_SSE_FRAME_SEPARATOR = /\r\n\r\n|\n\n|\r\r/;
export const RESPONSES_SSE_DONE = "[DONE]";
