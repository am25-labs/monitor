export function pageMonitors<
  T extends { id: string; project_id: string; group_id: string | null }
>(monitors: T[], project: string, groups: string[]) {
  return monitors.filter(
    (m) =>
      m.project_id === project &&
      (!groups.length || groups.includes(m.group_id ?? ""))
  );
}
