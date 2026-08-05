export class SplitWeightParseError extends Error {
  constructor() {
    super("each participant needs a positive numeric weight");
    this.name = "SplitWeightParseError";
  }
}

export function parseSplitWeight(value: string): number {
  const weight = Number(value);
  if (value.trim() === "" || !Number.isFinite(weight) || weight <= 0) {
    throw new SplitWeightParseError();
  }
  return weight;
}
