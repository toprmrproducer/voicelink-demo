import type { VoiceClone, VoiceProvider } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { CloneVoiceForm } from "./clone-voice-form";
import { CloneList } from "./clone-list";

interface LibraryVoice {
  provider: VoiceProvider;
  providerVoiceId: string;
  name: string;
  language?: string;
  gender?: string;
}

async function fetchStockVoices(): Promise<LibraryVoice[]> {
  try {
    const { voices } = await api.get<{ voices: LibraryVoice[] }>("/voices");
    return voices;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

async function fetchVoiceClones(): Promise<VoiceClone[]> {
  try {
    const { voiceClones } = await api.get<{ voiceClones: VoiceClone[] }>(
      "/voice-clones",
    );
    return voiceClones;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export default async function VoicesPage() {
  const [stock, clones] = await Promise.all([
    fetchStockVoices(),
    fetchVoiceClones(),
  ]);

  const byProvider = new Map<VoiceProvider, LibraryVoice[]>();
  for (const v of stock) {
    const list = byProvider.get(v.provider) ?? [];
    list.push(v);
    byProvider.set(v.provider, list);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-2">Voices</h1>
        <p className="text-sm text-zinc-500">
          Stock catalog used in agent editors. Cloned voices appear below
          once you upload a sample.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clone a voice</CardTitle>
          <CardDescription>
            Upload a 10-30 second clean speech sample. The cloned voice
            becomes available in the agent editor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CloneVoiceForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your cloned voices</CardTitle>
        </CardHeader>
        <CardContent>
          <CloneList clones={clones} />
        </CardContent>
      </Card>

      {[...byProvider.entries()].map(([provider, voices]) => (
        <Card key={provider}>
          <CardHeader>
            <CardTitle className="capitalize">{provider}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="font-normal py-1.5">Name</th>
                  <th className="font-normal py-1.5">Voice id</th>
                  <th className="font-normal py-1.5">Gender</th>
                  <th className="font-normal py-1.5">Language</th>
                </tr>
              </thead>
              <tbody>
                {voices.map((v) => (
                  <tr
                    key={`${v.provider}:${v.providerVoiceId}`}
                    className="border-t border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="font-medium py-1.5">{v.name}</td>
                    <td className="font-mono text-xs py-1.5">
                      {v.providerVoiceId}
                    </td>
                    <td className="py-1.5">{v.gender ?? "—"}</td>
                    <td className="py-1.5">{v.language ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
