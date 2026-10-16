import { createContext, useContext } from "react";
import { useNavigate, useLocation } from "react-router-dom";
export const RefreshContext = createContext(() => {});
export function usePathname() { return useLocation().pathname; }
export function useRouter() { const navigate = useNavigate(); const refresh = useContext(RefreshContext); return { push: (path: string) => navigate(path), replace: (path: string) => navigate(path, {replace:true}), refresh, back: () => navigate(-1) }; }
