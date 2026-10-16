import "server-only";
import { prisma } from "@/lib/db";
import { NOVEL_GENRES, type UserProfileView } from "@contracts/api";

export const GENDERS = ["male", "female", "other"] as const;

export async function readUserProfile(userId: string): Promise<UserProfileView> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: {
    id: true, name: true, email: true, emailVerified: true, gender: true, age: true,
    avatarKey: true, favoriteGenres: true, createdAt: true,
  } });
  let favoriteGenres: UserProfileView["favoriteGenres"] = [];
  try {
    const parsed: unknown = JSON.parse(user.favoriteGenres);
    if (Array.isArray(parsed)) favoriteGenres = parsed.filter((genre): genre is UserProfileView["favoriteGenres"][number] => NOVEL_GENRES.includes(genre));
  } catch { /* repair malformed legacy value by returning empty preferences */ }
  return {
    id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified,
    gender: GENDERS.includes(user.gender as (typeof GENDERS)[number]) ? user.gender as UserProfileView["gender"] : null,
    age: user.age, favoriteGenres,
    avatarUrl: user.avatarKey ? "/api/v1/profile/avatar" : null,
    createdAt: user.createdAt.toISOString(),
  };
}
