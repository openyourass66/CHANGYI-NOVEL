"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Camera, KeyRound, LoaderCircle, Save, UserRound } from "lucide-react";
import type { NovelGenre, UserProfileView } from "@contracts/api";
import { NOVEL_GENRES } from "@contracts/api";
import { apiFetch, apiJson } from "@/lib/client-api";
import { authClient } from "@/lib/auth-client";
import { notify } from "@/components/operation-prompt";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { profile: UserProfileView };
type ProfileResponse = { profile: UserProfileView };

export function ProfilePage({ profile: initialProfile }: Props) {
  const [profile, setProfile] = useState(initialProfile);
  const [name, setName] = useState(initialProfile.name);
  const [gender, setGender] = useState(initialProfile.gender ?? "");
  const [age, setAge] = useState(initialProfile.age?.toString() ?? "");
  const [genres, setGenres] = useState<NovelGenre[]>(initialProfile.favoriteGenres);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (!profile.avatarUrl) return;
    let objectUrl: string | undefined;
    let active = true;
    void apiFetch(profile.avatarUrl).then(async response => {
      if (!response.ok) throw new Error("头像暂时无法读取。");
      return URL.createObjectURL(await response.blob());
    }).then(url => {
      if (active) { objectUrl = url; setAvatarUrl(url); }
      else URL.revokeObjectURL(url);
    }).catch(() => { if (active) setAvatarUrl(null); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [profile.avatarUrl]);

  function toggleGenre(genre: NovelGenre) {
    setGenres(current => current.includes(genre) ? current.filter(item => item !== genre)
      : current.length >= 8 ? current : [...current, genre]);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await apiJson<ProfileResponse>("/api/v1/profile", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, gender: gender || null, age: age ? Number(age) : null, favoriteGenres: genres }) });
      setProfile(result.profile);
      setName(result.profile.name);
      await authClient.getSession();
      notify.success("个人信息已保存。");
    } catch (error) { notify.error(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { setSaving(false); }
  }

  async function uploadAvatar(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { notify.error("头像大小不能超过 5 MB。"); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { notify.error("请选择 JPG、PNG 或 WebP 图片。"); return; }
    setUploading(true);
    try {
      const response = await apiFetch("/api/v1/profile/avatar", { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "头像上传失败。");
      setProfile(current => ({ ...current, avatarUrl: `${result.avatarUrl}?v=${Date.now()}` }));
      window.dispatchEvent(new Event("changyi:avatar-updated"));
      notify.success("头像已更新。");
    } catch (error) { notify.error(error instanceof Error ? error.message : "头像上传失败，请重试。"); }
    finally { setUploading(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) { notify.error("两次输入的新密码不一致。"); return; }
    if (newPassword.length < 8 || newPassword.length > 20) { notify.error("新密码需为 8 到 20 个字符。"); return; }
    setChangingPassword(true);
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (result.error) throw new Error(result.error.message ?? "密码修改失败。");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      notify.success("密码已修改，其他登录会话已退出。");
    } catch (error) { notify.error(error instanceof Error ? error.message : "密码修改失败，请重试。"); }
    finally { setChangingPassword(false); }
  }

  return <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 md:px-8">
    <header className="space-y-2">
      <p className="text-sm font-medium text-primary">账号设置</p>
      <h1 className="text-3xl font-semibold tracking-tight">个人信息</h1>
      <p className="text-sm text-muted-foreground">管理你的账号资料、阅读偏好与登录密码。</p>
    </header>

    <Card>
      <CardHeader><CardTitle>个人资料</CardTitle><CardDescription>这些信息用于个性化你的长忆体验。</CardDescription></CardHeader>
      <CardContent>
        <form className="space-y-7" onSubmit={saveProfile}>
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex size-24 items-center justify-center overflow-hidden rounded-full border bg-muted text-muted-foreground">
              {avatarUrl ? <img src={avatarUrl} alt="个人头像" className="size-full object-cover" /> : <UserRound className="size-10" aria-hidden />}
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-avatar" className="cursor-pointer">
                <span className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
                  {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}
                  {uploading ? "正在上传…" : "更换头像"}
                </span>
              </Label>
              <Input id="profile-avatar" type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={uploading}
                onChange={event => { void uploadAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
              <p className="text-xs text-muted-foreground">支持 JPG、PNG、WebP，最大 5 MB。</p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="profile-name">姓名</Label><Input id="profile-name" value={name} onChange={event => setName(event.target.value)} required maxLength={40} /></div>
            <div className="space-y-2"><Label htmlFor="profile-email">邮箱</Label><Input id="profile-email" value={profile.email} readOnly disabled /><p className="text-xs text-muted-foreground">{profile.emailVerified ? "邮箱已验证" : "邮箱尚未验证"}</p></div>
            <div className="space-y-2"><Label htmlFor="profile-gender">性别</Label><select id="profile-gender" value={gender} onChange={event => setGender(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">不填写</option><option value="female">女</option><option value="male">男</option><option value="other">其他</option></select></div>
            <div className="space-y-2"><Label htmlFor="profile-age">年龄</Label><Input id="profile-age" type="number" min={1} max={120} value={age} onChange={event => setAge(event.target.value)} placeholder="选填" /></div>
          </div>

          <fieldset className="space-y-3">
            <div><legend className="text-sm font-medium">喜欢的小说题材</legend><p className="mt-1 text-xs text-muted-foreground">最多选择 8 项，帮助我们了解你的阅读兴趣。</p></div>
            <div className="flex flex-wrap gap-2">{NOVEL_GENRES.map(genre => {
              const selected = genres.includes(genre);
              return <button key={genre} type="button" aria-pressed={selected} onClick={() => toggleGenre(genre)} disabled={!selected && genres.length >= 8}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 ${selected ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"}`}>{genre}</button>;
            })}</div>
          </fieldset>

          <div className="flex justify-end border-t pt-5"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />}保存资料</Button></div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-5" />修改密码</CardTitle><CardDescription>修改后，其他设备上的登录会话将退出。</CardDescription></CardHeader>
      <CardContent>
        <form className="max-w-xl space-y-4" onSubmit={changePassword}>
          <div className="space-y-2"><Label htmlFor="current-password">当前密码</Label><Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="new-password">新密码</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={20} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /><p className="text-xs text-muted-foreground">长度为 8 到 20 个字符。</p></div>
          <div className="space-y-2"><Label htmlFor="confirm-password">确认新密码</Label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={20} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required /></div>
          <Button type="submit" variant="outline" disabled={changingPassword}>{changingPassword && <LoaderCircle className="animate-spin" />}修改密码</Button>
        </form>
      </CardContent>
    </Card>
  </main>;
}
