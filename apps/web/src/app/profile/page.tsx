import { Suspense } from "react";
import { Card, Chip, EmptyState, LoadingRows, PageHeader } from "@/components/ui";
import { getProfile } from "@/lib/data";

export default function ProfilePage() {
  return (
    <>
      <PageHeader
        title="Profile"
        description="What Kira matches jobs against. Editing will go through the agent API once it exists."
      />
      <Suspense fallback={<LoadingRows />}>
        <ProfileDetails />
      </Suspense>
    </>
  );
}

async function ProfileDetails() {
  const profile = await getProfile();
  if (!profile) return <EmptyState>No profile saved yet.</EmptyState>;

  const salary =
    profile.salaryMin === null ? null : `${profile.salaryMin.toLocaleString("en-IN")} ${profile.salaryCurrency ?? ""}`.trim();
  const sponsorship = profile.needsSponsorship === null ? null : profile.needsSponsorship ? "Needs sponsorship" : "No sponsorship needed";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card title="Target roles">
        <ChipList items={profile.targetRoles} />
      </Card>
      <Card title="Skills">
        <ChipList items={profile.skills} />
      </Card>
      <Card title="Experience">
        <Field
          value={[profile.experienceYears === null ? null : `${profile.experienceYears} years`, profile.seniority]
            .filter(Boolean)
            .join(" · ")}
        />
      </Card>
      <Card title="Preferred locations">
        <ChipList items={profile.locations} />
      </Card>
      <Card title="Work style">
        <ChipList items={profile.remoteTypes} />
      </Card>
      <Card title="Minimum salary">
        <Field value={salary} />
      </Card>
      <Card title="Work authorisation">
        <Field value={[profile.workAuth, sponsorship].filter(Boolean).join(" · ")} />
      </Card>
      <Card title="Deal-breakers">
        <ChipList items={profile.dealBreakers} />
      </Card>
    </div>
  );
}

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) return <Field value={null} />;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Chip key={item}>{item}</Chip>
      ))}
    </div>
  );
}

function Field({ value }: { value: string | null }) {
  return value ? <p className="text-sm">{value}</p> : <p className="text-sm text-zinc-400">Not set</p>;
}
