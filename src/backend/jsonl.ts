import { StringDecoder } from "node:string_decoder";
import { isString } from "@dani-dex/contracts/runtime-values";
import { isRpcMessage, type RpcMessage } from "./protocol";

export class JsonLineDecoder {
  readonly #decoder = new StringDecoder("utf8");
  #buffer = "";

  push(chunk: Uint8Array | string): RpcMessage[] {
    this.#buffer += isString(chunk) ? chunk : this.#decoder.write(Buffer.from(chunk));
    return this.#drainCompleteLines();
  }

  end(chunk?: Uint8Array | string): RpcMessage[] {
    if (chunk) {
      this.#buffer += isString(chunk) ? chunk : this.#decoder.write(Buffer.from(chunk));
    }
    this.#buffer += this.#decoder.end();

    const messages = this.#drainCompleteLines();
    const trailing = this.#buffer.trim();
    this.#buffer = "";

    if (trailing) {
      messages.push(this.#parseLine(trailing));
    }

    return messages;
  }

  #drainCompleteLines(): RpcMessage[] {
    const messages: RpcMessage[] = [];
    let start = 0;
    try {
      for (let end = this.#buffer.indexOf("\n"); end >= 0; end = this.#buffer.indexOf("\n", start)) {
        const line = this.#buffer.slice(start, end).trim();
        start = end + 1;
        if (line) messages.push(this.#parseLine(line));
      }
    } finally {
      this.#buffer = this.#buffer.slice(start);
    }

    return messages;
  }

  #parseLine(line: string): RpcMessage {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("Invalid JSONL from Codex App Server.");
    }

    if (!isRpcMessage(parsed)) {
      throw new Error("Invalid JSON-RPC message from Codex App Server.");
    }

    return parsed;
  }
}
