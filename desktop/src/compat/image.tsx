import type { ImgHTMLAttributes } from "react";
import appIcon from "../../../web/public/app-icon-v2.png";

export default function Image({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  return <img {...props} src={src === "/app-icon-v2.png" ? appIcon : src} />;
}
