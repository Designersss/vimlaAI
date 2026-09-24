import { readOpenAiUsage } from "./usage.js";
import type { NormalizedUsage, ProviderStreamEvent } from "./types.js";

export class OpenAiCompatSseParser {
  private buffer = "";
  private terminal = false;
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });

  push(chunk: Uint8Array): ProviderStreamEvent[] {
    if (this.terminal) return [];
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  finish(): ProviderStreamEvent[] {
    if (this.terminal) return [];
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(flush: boolean): ProviderStreamEvent[] {
    const events: ProviderStreamEvent[] = [];
    this.buffer = this.buffer.replaceAll("\r\n", "\n");

    while (true) {
      const boundary = this.buffer.indexOf("\n\n");
      if (boundary === -1) {
        break;
      }

      const rawEvent = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const parsed = parseSseBlock(rawEvent);
      events.push(...parsed);
      if (parsed.some((event) => event.type === "done")) {
        this.terminal = true;
        this.buffer = "";
        break;
      }
    }

    if (flush && this.buffer.trim().length > 0) {
      events.push(...parseSseBlock(this.buffer));
      this.buffer = "";
    }

    return events;
  }
}

export function parseSseBlock(block: string): ProviderStreamEvent[] {
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return [];
  }

  const data = dataLines.join("\n").trim();
  if (data.length === 0) {
    return [];
  }

  if (data === "[DONE]") {
    return [{ type: "done" }];
  }

  let payload: unknown;
  try {
    payload = JSON.parse(data) as unknown;
  } catch {
    throw new SyntaxError("Malformed provider SSE JSON");
  }

  return eventsFromPayload(payload);
}

function eventsFromPayload(payload: unknown): ProviderStreamEvent[] {
  const events: ProviderStreamEvent[] = [];
  const text = readDeltaText(payload);
  if (text.length > 0) {
    events.push({ type: "delta", text });
  }
  events.push(...readToolCallDeltas(payload));

  try {
    const usage = readOpenAiUsage(payload);
    if (usage) {
      events.push({ type: "usage", usage });
    }
  } catch {
    throw new SyntaxError("Malformed provider usage payload");
  }

  return events;
}

function readDeltaText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("choices" in payload)) {
    return "";
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }

  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    return "";
  }

  const record = first as Record<string, unknown>;
  const delta = record.delta;
  if (typeof delta === "object" && delta !== null && "content" in delta) {
    return asText(delta.content);
  }

  const message = record.message;
  if (typeof message === "object" && message !== null && "content" in message) {
    return asText(message.content);
  }

  return "";
}

function readToolCallDeltas(payload: unknown): ProviderStreamEvent[] {
  if (typeof payload !== "object" || payload === null || !("choices" in payload)) {
    return [];
  }
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const first = choices[0];
  if (typeof first !== "object" || first === null) return [];
  const delta = (first as Record<string, unknown>).delta;
  if (typeof delta !== "object" || delta === null) return [];
  const toolCalls = (delta as Record<string, unknown>).tool_calls;
  if (!Array.isArray(toolCalls)) return [];

  const events: ProviderStreamEvent[] = [];
  for (const item of toolCalls) {
    if (typeof item !== "object" || item === null) {
      throw new SyntaxError("Malformed provider tool-call payload");
    }
    const record = item as Record<string, unknown>;
    const index = record.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      throw new SyntaxError("Malformed provider tool-call index");
    }
    const fn = record.function;
    const fnRecord =
      typeof fn === "object" && fn !== null
        ? (fn as Record<string, unknown>)
        : {};
    const id = typeof record.id === "string" ? record.id : undefined;
    const name = typeof fnRecord.name === "string" ? fnRecord.name : undefined;
    const argumentsDelta =
      typeof fnRecord.arguments === "string" ? fnRecord.arguments : "";
    events.push({
      type: "tool_call_delta",
      index,
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
      argumentsDelta,
    });
  }
  return events;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function encodeVimlaSse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export type { NormalizedUsage };
