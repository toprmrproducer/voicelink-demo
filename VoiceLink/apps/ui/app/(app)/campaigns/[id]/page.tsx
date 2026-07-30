import { notFound } from "next/navigation";
import Link from "next/link";

import type { Campaign } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";

import { CampaignDetail } from "./campaign-detail";

async function fetchCampaign(id: string): Promise<Campaign | null> {
  try {
    return await api.get<Campaign>(`/campaigns/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await fetchCampaign(id);
  if (!campaign) notFound();
  return (
    <div>
      <Link
        href="/campaigns"
        className="text-sm text-zinc-500 hover:underline"
      >
        ← Back to campaigns
      </Link>
      <CampaignDetail campaign={campaign} />
    </div>
  );
}
