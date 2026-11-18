export const ENTRY_TYPES = ["Credit", "Debit"] as const;

export type EntryType = (typeof ENTRY_TYPES)[number];
