/** The draft map contains only local edits; refetched server values stay separate. */
export function clearSavedDraft(drafts: Record<string, string>, key: string, submitted: string): Record<string, string> {
  if (drafts[key] !== submitted) return drafts;
  const next = { ...drafts };
  delete next[key];
  return next;
}
