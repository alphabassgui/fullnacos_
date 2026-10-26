import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "Groville · the customers you are missing, found",
  description:
    "Groville is the AI growth agent for small business. It reads your site and Google Search Console, finds the customers you're missing, and drafts the campaign to win them. You approve every move.",
};

// No-flash theme boot: resolve theme before first paint (?theme, then
// localStorage, then prefers-color-scheme), and track scroll for the nav.
// A valid ?theme (light|dark only) is also persisted so it survives a reload; the
// write has its own try/catch so blocked storage still leaves a working data-theme.
// Based on docs/landing-reference.html.
const THEME_BOOT = `try{var q=new URLSearchParams(location.search).get('theme');var t=q==='light'||q==='dark'?q:null;if(t){try{localStorage.setItem('groville-theme',t)}catch(e){}}else{t=localStorage.getItem('groville-theme');if(t!=='light'&&t!=='dark')t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.setAttribute('data-theme',t)}catch(e){}
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
      <body suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
