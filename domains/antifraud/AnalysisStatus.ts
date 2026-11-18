export const ANALYSIS_STATUSES = ["Pending", "Approved", "Rejected"] as const;

export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
