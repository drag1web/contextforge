export interface IdGeneratorPort {
  next(prefix: string): string;
}
