export interface LocatedJsonProperty {
  key: string;
  keyStart: number;
  keyEnd: number;
  value: LocatedJsonNode;
}

export interface LocatedJsonNode {
  kind: "object" | "array" | "string" | "number" | "boolean" | "null";
  start: number;
  end: number;
  value: unknown;
  properties?: LocatedJsonProperty[];
  elements?: LocatedJsonNode[];
}

class JsonLocatorParser {
  private offset = 0;

  constructor(private readonly source: string) {}

  parse(): LocatedJsonNode {
    const node = this.parseValue();
    this.skipWhitespace();
    if (this.offset !== this.source.length) {
      throw new Error("Unexpected trailing JSON content.");
    }
    return node;
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.source[this.offset] ?? "")) this.offset += 1;
  }

  private parseString(): LocatedJsonNode {
    this.skipWhitespace();
    const start = this.offset;
    if (this.source[this.offset] !== '"') throw new Error("Expected JSON string.");
    this.offset += 1;
    while (this.offset < this.source.length) {
      const character = this.source[this.offset];
      if (character === "\\") {
        this.offset += 2;
        continue;
      }
      this.offset += 1;
      if (character === '"') {
        const raw = this.source.slice(start, this.offset);
        return {
          kind: "string",
          start,
          end: this.offset,
          value: JSON.parse(raw) as string,
        };
      }
    }
    throw new Error("Unterminated JSON string.");
  }

  private parseObject(): LocatedJsonNode {
    this.skipWhitespace();
    const start = this.offset;
    this.offset += 1;
    const properties: LocatedJsonProperty[] = [];
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.source[this.offset] === "}") {
      this.offset += 1;
      return { kind: "object", start, end: this.offset, value: {}, properties };
    }
    while (this.offset < this.source.length) {
      const keyNode = this.parseString();
      this.skipWhitespace();
      if (this.source[this.offset] !== ":") throw new Error("Expected JSON colon.");
      this.offset += 1;
      const value = this.parseValue();
      const key = String(keyNode.value);
      if (keys.has(key)) throw new Error("Duplicate JSON object key.");
      keys.add(key);
      properties.push({
        key,
        keyStart: keyNode.start,
        keyEnd: keyNode.end,
        value,
      });
      this.skipWhitespace();
      const delimiter = this.source[this.offset];
      if (delimiter === "}") {
        this.offset += 1;
        break;
      }
      if (delimiter !== ",") throw new Error("Expected JSON object delimiter.");
      this.offset += 1;
      this.skipWhitespace();
    }
    return {
      kind: "object",
      start,
      end: this.offset,
      value: JSON.parse(this.source.slice(start, this.offset)) as unknown,
      properties,
    };
  }

  private parseArray(): LocatedJsonNode {
    this.skipWhitespace();
    const start = this.offset;
    this.offset += 1;
    const elements: LocatedJsonNode[] = [];
    this.skipWhitespace();
    if (this.source[this.offset] === "]") {
      this.offset += 1;
      return { kind: "array", start, end: this.offset, value: [], elements };
    }
    while (this.offset < this.source.length) {
      elements.push(this.parseValue());
      this.skipWhitespace();
      const delimiter = this.source[this.offset];
      if (delimiter === "]") {
        this.offset += 1;
        break;
      }
      if (delimiter !== ",") throw new Error("Expected JSON array delimiter.");
      this.offset += 1;
    }
    return {
      kind: "array",
      start,
      end: this.offset,
      value: JSON.parse(this.source.slice(start, this.offset)) as unknown,
      elements,
    };
  }

  private parsePrimitive(): LocatedJsonNode {
    this.skipWhitespace();
    const start = this.offset;
    while (
      this.offset < this.source.length &&
      !/[\s,}\]]/u.test(this.source[this.offset] ?? "")
    ) {
      this.offset += 1;
    }
    const raw = this.source.slice(start, this.offset);
    const value = JSON.parse(raw) as unknown;
    return {
      kind:
        value === null
          ? "null"
          : typeof value === "number"
            ? "number"
            : typeof value === "boolean"
              ? "boolean"
              : (() => {
                  throw new Error("Unsupported JSON primitive.");
                })(),
      start,
      end: this.offset,
      value,
    };
  }

  private parseValue(): LocatedJsonNode {
    this.skipWhitespace();
    const character = this.source[this.offset];
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === '"') return this.parseString();
    return this.parsePrimitive();
  }
}

export function locateJsonSource(source: string): LocatedJsonNode {
  JSON.parse(source);
  return new JsonLocatorParser(source).parse();
}

export function objectProperty(
  node: LocatedJsonNode,
  key: string,
): LocatedJsonProperty | undefined {
  return node.properties?.find((property) => property.key === key);
}
