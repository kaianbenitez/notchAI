import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "Notch", short_name: "Notch", display: "standalone", start_url: "/", theme_color: "#0f172a", background_color: "#020617", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] };
}
