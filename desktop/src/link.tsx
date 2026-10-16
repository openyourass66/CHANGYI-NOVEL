import { forwardRef, type ComponentProps } from "react";
import { Link } from "react-router-dom";
export default forwardRef<HTMLAnchorElement, Omit<ComponentProps<"a">,"href"> & {href: string; prefetch?: boolean}>(function AppLink({href, prefetch: _prefetch, ...props}, ref) { return <Link {...props} to={href} ref={ref} />; });
