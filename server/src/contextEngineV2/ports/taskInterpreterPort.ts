import type {
  EngineTaskInput,
  EngineTaskUnderstanding,
} from "../contracts/index.js";

export interface TaskInterpreterPort {
  interpret(input: EngineTaskInput): Promise<EngineTaskUnderstanding>;
}
