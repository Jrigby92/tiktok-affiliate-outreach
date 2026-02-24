export interface RegulatoryChunk {
  text: string;
  sourceAuthority: "MHRA" | "ASA" | "CAP";
  ruleNumber?: string;
  sectionTitle?: string;
  lastAccessed: Date;
}
