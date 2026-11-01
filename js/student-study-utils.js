(() => {
  "use strict";

  const SESSION_STATUSES = new Set(["active", "completed", "abandoned", "paused"]);

  function parseUtcTimestamp(value) {
    const raw = String(value ?? "").trim();
    const timestamp = raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(timestamp)) {
      return null;
    }

    const normalized = timestamp.replace(
      /([+-])(\d{2})(?::?(\d{2}))?$/,
      (_, sign, hours, minutes = "00") => `${sign}${hours}:${minutes}`,
    );
    const milliseconds = Date.parse(normalized);
    return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
  }

  function getVerifiedSegments(sessions, records) {
    const sessionsById = new Map(
      sessions
        .filter((session) => SESSION_STATUSES.has(String(session.status || "").toLowerCase()))
        .map((session) => [String(session.id), session]),
    );
    const seenIds = new Set();
    const seenRanges = new Set();
    const segments = [];

    for (const record of records) {
      const session = sessionsById.get(String(record.session_id));
      if (!session) continue;

      const durationSeconds = Number(record.duration_seconds);
      const start = parseUtcTimestamp(record.started_at);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !start) continue;

      const end = record.ended_at
        ? parseUtcTimestamp(record.ended_at)
        : new Date(start.getTime() + durationSeconds * 1000);
      if (!end || end <= start) continue;

      if (record.id != null) {
        const id = String(record.id);
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }

      const rangeKey = [
        session.id,
        start.getTime(),
        end.getTime(),
        durationSeconds,
      ].join(":");
      if (seenRanges.has(rangeKey)) continue;
      seenRanges.add(rangeKey);
      segments.push({ session, start, end, durationSeconds });
    }

    segments.sort((left, right) =>
      left.start.getTime() - right.start.getTime() ||
      String(left.session.id).localeCompare(String(right.session.id)),
    );

    const nonOverlappingSegments = [];
    let coveredUntil = -Infinity;
    for (const segment of segments) {
      const originalStart = segment.start.getTime();
      const originalEnd = segment.end.getTime();
      if (originalEnd <= coveredUntil) continue;
      if (originalStart < coveredUntil) {
        const originalInterval = originalEnd - originalStart;
        const retainedInterval = originalEnd - coveredUntil;
        segment.durationSeconds *= retainedInterval / originalInterval;
        segment.start = new Date(coveredUntil);
      }
      coveredUntil = segment.end.getTime();
      nonOverlappingSegments.push(segment);
    }
    return nonOverlappingSegments;
  }

  window.StudentStudyTimeUtils = Object.freeze({ getVerifiedSegments });
})();
