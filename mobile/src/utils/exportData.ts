import { Share } from "react-native";
import * as Sharing from "expo-sharing";
import { writeAsStringAsync, cacheDirectory } from "expo-file-system/legacy";
import { getMyData } from "../services/api";

/** Build the dated export filename, e.g. veradic-data-2026-06-24.json. */
export function exportFilename(isoDate: string): string {
  return `veradic-data-${isoDate.slice(0, 10)}.json`;
}

/**
 * Fetch the user's personal data and hand it off via the native share sheet as
 * a pretty-printed .json file (web parity — web triggers a file download). Falls
 * back to sharing the JSON as text if the OS share-to-file isn't available.
 */
export async function exportMyData(): Promise<void> {
  const data = await getMyData();
  const json = JSON.stringify(data, null, 2);
  const name = exportFilename(new Date().toISOString());

  if (cacheDirectory && (await Sharing.isAvailableAsync())) {
    const uri = `${cacheDirectory}${name}`;
    await writeAsStringAsync(uri, json);
    await Sharing.shareAsync(uri, {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: "Your Veradic data",
    });
    return;
  }
  // Fallback: no file sharing available → share the JSON as text.
  await Share.share({ message: json });
}
