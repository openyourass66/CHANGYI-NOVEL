import { requirePageUser } from "@/lib/auth-session";
import { readUserProfile } from "@/lib/user-profile";
import { ProfilePage } from "@/components/account/profile-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "个人信息" };
export default async function UserProfilePage() {
  const user = await requirePageUser();
  return <ProfilePage profile={await readUserProfile(user.id)} />;
}
