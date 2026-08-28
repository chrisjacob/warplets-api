export function getNotificationPromptText({
  appName,
  notificationsOnlyPrompt,
  baseAppContext,
}: {
  appName: string;
  notificationsOnlyPrompt: boolean;
  baseAppContext: boolean;
}): string {
  if (baseAppContext) {
    return `To receive notifications in Base, open the ⋮ menu, tap "Save", then return here. Saving adds ${appName} to your Bookmarks.`;
  }
  return notificationsOnlyPrompt
    ? "Please turn on notifications so you don't miss important 10X market updates."
    : "Please add this Mini App & enable notifications so you don't miss important 10X updates 👀";
}

export function getNotificationPromptConfirmLabel(baseAppContext: boolean): string {
  return baseAppContext ? "I've saved it" : "Ok, let's go!";
}
