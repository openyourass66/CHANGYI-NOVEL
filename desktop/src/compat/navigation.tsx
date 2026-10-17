import { useMemo } from "react";
import { useLocation, useNavigate, useRevalidator } from "react-router-dom";

export function usePathname() { return useLocation().pathname; }
export function useSearchParams() { return new URLSearchParams(useLocation().search); }
export function useRouter() {
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  return useMemo(() => ({
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    refresh: () => { void revalidate(); },
    back: () => navigate(-1),
  }), [navigate, revalidate]);
}
