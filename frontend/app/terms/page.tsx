import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — Groville",
};

export default function TermsPage() {
  return (
    <LegalPage>
      <h1>Terms of Service</h1>
      <p className="gv-legal-meta">
        <strong>Groville</strong> — a product of The ALPHAs
        <br />
        <strong>Last updated:</strong> 26 October 2026
      </p>

      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of Groville (&quot;Groville&quot;, &quot;we&quot;,
        &quot;us&quot;, &quot;our&quot;), a service that analyses your business&apos;s website and connected data, identifies
        customer and search gaps, and drafts marketing campaigns for you to review and approve. Groville is operated by The
        ALPHAs, a registered entity in Nigeria. By creating an account or using Groville, you agree to these Terms. If you do not
        agree, do not use Groville.
      </p>

      <p>
        <strong>Contact:</strong>{" "}
        <a href="mailto:joshua.nicholas@student.aul.edu.ng">joshua.nicholas@student.aul.edu.ng</a>
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old to use Groville. If you use Groville on behalf of a business, you confirm that you are
        authorised to act for that business and to bind it to these Terms.
      </p>

      <h2>2. What Groville does — and does not do</h2>
      <p>
        Groville reads your website and, where you connect them, data from services such as Google Search Console, then produces
        analyses, recommendations, and campaign drafts.
      </p>
      <p>
        <strong>Groville drafts; you approve.</strong> Everything Groville produces is a draft recommendation for you to review.
        Groville does <strong>not</strong> automatically send, publish, or post anything on your behalf, and does{" "}
        <strong>not</strong> spend your money. The only change Groville makes to a connected service — such as updating a file in
        a GitHub repository you have connected — happens only after you explicitly approve that specific action. Your access to
        connected data such as Google Search Console is read-only.
      </p>

      <h2>3. Your account</h2>
      <p>
        You are responsible for the accuracy of the information you provide, for keeping your login credentials secure, and for
        all activity under your account. Tell us promptly if you suspect unauthorised use.
      </p>

      <h2>4. Connected services</h2>
      <p>
        When you connect a third-party service (such as GitHub or Google Search Console), you authorise Groville to access it as
        described in our Privacy Policy, and you confirm you have the right to connect that account and its data. You can
        disconnect a service at any time. Your use of those services remains subject to their own terms.
      </p>

      <h2>5. Acceptable use</h2>
      <p>
        You agree to use Groville only for lawful purposes and only to analyse websites and data you own or are authorised to
        analyse. You will not misuse the service, attempt to disrupt or reverse-engineer it, use it to infringe others&apos;
        rights, or use it to generate unlawful, deceptive, or harmful content.
      </p>

      <h2>6. Your content and your decisions</h2>
      <p>
        You own the content you provide and the drafts Groville produces for you. You are solely responsible for reviewing any
        draft before you act on it, and for anything you choose to publish, send, or implement based on Groville&apos;s output.
        Because recommendations and drafts are generated with the help of AI, they may contain errors or inaccuracies — you must
        review them before use.
      </p>

      <h2>7. Payments and subscriptions</h2>
      <p>
        Paid plans are billed <strong>monthly</strong> through our third-party payment provider, BMONI. By subscribing, you
        authorise the applicable monthly fee, which renews each month until you cancel. You can cancel at any time, which stops
        future charges. <strong>All fees are non-refundable</strong> — we do not provide refunds for amounts already paid,
        including for partial billing periods.
      </p>

      <h2>8. Intellectual property</h2>
      <p>
        Groville, including its software, design, and branding, belongs to us. These Terms do not grant you any rights in
        Groville other than the right to use the service as permitted here. You retain ownership of your own business content and
        the drafts generated for you.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        Groville is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, whether express or
        implied. We do not warrant that the service will be uninterrupted or error-free, or that any recommendation, analysis, or
        campaign draft will achieve any particular business result, ranking, traffic, or revenue outcome. Any results shown in
        examples or demos are illustrative only.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Groville and The ALPHAs will not be liable for any indirect, incidental, special,
        consequential, or exemplary damages, or for any loss of profits, revenue, data, or goodwill, arising from your use of the
        service.
      </p>

      <h2>11. Indemnification</h2>
      <p>
        You agree to indemnify and hold Groville and The ALPHAs harmless from claims arising out of your misuse of the service,
        your violation of these Terms, or your infringement of any third party&apos;s rights.
      </p>

      <h2>12. Termination</h2>
      <p>
        You may stop using Groville and delete your account at any time from your account settings. We may suspend or terminate
        your access if you breach these Terms or use the service unlawfully. On termination, the data-deletion practices in our
        Privacy Policy apply.
      </p>

      <h2>13. Governing law</h2>
      <p>
        These Terms are governed by the laws of the Federal Republic of Nigeria. You agree that any dispute arising from these
        Terms or your use of Groville will be subject to the jurisdiction of the courts of <strong>Lagos State, Nigeria</strong>,
        without prejudice to any mandatory consumer-protection rights you may have.
      </p>

      <h2>14. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. We will post the updated version with a new &quot;Last updated&quot; date,
        and your continued use after changes means you accept them.
      </p>

      <h2>15. Contact</h2>
      <p>
        Questions about these Terms:{" "}
        <a href="mailto:joshua.nicholas@student.aul.edu.ng">joshua.nicholas@student.aul.edu.ng</a>
      </p>
    </LegalPage>
  );
}
