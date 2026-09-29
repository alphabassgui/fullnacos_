import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Groville · the customers you are missing, found",
  description:
    "Groville is the AI growth agent for small business. It reads your site and Google Search Console, finds the customers you're missing, and drafts the campaign to win them. You approve every move.",
};

// No-flash theme boot: resolve theme before first paint (?theme, then
// localStorage, then prefers-color-scheme), and track scroll for the nav.
// Mirrors docs/landing-reference.html exactly.
const THEME_BOOT = `try{var t=new URLSearchParams(location.search).get('theme')||localStorage.getItem('groville-theme');if(!t)t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',t)}catch(e){}
addEventListener('scroll',function(){document.documentElement.classList.toggle('is-scrolled',scrollY>20)},{passive:true});`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the boot script sets data-theme on <html> before
    // React hydrates, so the attribute intentionally differs from the SSR default.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* type swaps to text/plain on the client so React doesn't warn about (or
            try to re-run) the script; it already executed during HTML parsing. */}
        <script
          type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_BOOT }}
        />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla's
          cz-shortcut-listen) inject attributes on <body> before React hydrates. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
