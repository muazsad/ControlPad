// Shared by the special-day sender (server) and the Settings form (client).

/**
 * Local (Eastern) time on the evening before a special day when the automatic
 * parent text goes out. Must fall inside the attendance tick's hours
 * (10:00–23:50 UTC ≈ 6am–7:50pm EDT / 5am–6:50pm EST).
 */
export const SPECIAL_DAY_NOTICE_TIME = "18:00";

/** Parents aren't re-texted the same message for this long. */
export const SPECIAL_DAY_DEDUPE_HOURS = 24 * 14;

/** Longest parent message accepted (≈ 3 SMS segments). */
export const SPECIAL_DAY_MESSAGE_MAX_LENGTH = 450;
