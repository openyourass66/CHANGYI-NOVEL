import { forwardRef, type AnchorHTMLAttributes } from "react";
import { Link } from "react-router-dom";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  replace?: boolean;
  prefetch?: boolean;
};

export default forwardRef<HTMLAnchorElement, Props>(function DesktopLink(
  { href, replace, prefetch: _prefetch, ...props }, ref,
) {
  return <Link ref={ref} to={href} replace={replace} {...props} />;
});
