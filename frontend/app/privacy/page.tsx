import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — Groville",
};

export default function PrivacyPage() {
  return (
    <LegalPage>
      <h1>Privacy Policy</h1>
      <p className="gv-legal-meta">
        <strong>Groville</strong> — a product of The ALPHAs
        <br />
        <strong>Last updated:</strong> 26 October 2026
      </p>

      <p>
        Groville (&quot;Groville&quot;, &quot;we&quot;, &quot;us&quot;, &quot;our&quot;) helps Nigerian small and medium businesses find
        customer and search gaps and drafts marketing campaigns for the business owner to review and approve. This Privacy
        Policy explains what personal data we collect, how we use it, who we share it with, and the rights you have. It is
        written to meet the Nigeria Data Protection Act, 2023 (NDPA) and, where you connect Google Search Console, Google&apos;s
        API Services User Data Policy.
      </p>

      <p>If you do not agree with this policy, please do not use Groville.</p>

      <p>
        <strong>Contact / data requests:</strong>{" "}
        <a href="mailto:joshua.nicholas@student.aul.edu.ng">joshua.nicholas@student.aul.edu.ng</a>
      </p>

      <h2>1. Who we are</h2>
      <p>
        Groville is operated by The ALPHAs, a registered entity in Nigeria. For the purposes of the NDPA, we act as the{" "}
        <strong>data controller</strong> for the account and business data you provide, and as a <strong>data processor</strong>{" "}
        acting on your instructions when we read and analyse data from services you connect (such as Google Search Console and
        GitHub).
      </p>

      <h2>2. Information we collect</h2>
      <p>
        <strong>a. Account information.</strong> Your name, email address, and a password (stored only as a secure cryptographic
        hash — we never store your password in plain text). We also set a session cookie to keep you signed in.
      </p>
      <p>
        <strong>b. Business information.</strong> The business details you enter, including your business name and website URL.
      </p>
      <p>
        <strong>c. Website content we analyse.</strong> When you ask Groville to analyse a website, we fetch its publicly
        available pages (HTML and text) and capture screenshots of the page for visual analysis.
      </p>
      <p>
        <strong>d. Google Search Console data (only if you connect it).</strong> With your explicit authorisation, and using
        read-only access, we read your list of verified properties and your search-analytics data (search queries, pages,
        clicks, impressions, and average position). See Section 4 for how we handle this data.
      </p>
      <p>
        <strong>e. GitHub data (only if you connect it).</strong> With your explicit authorisation, we store an encrypted access
        token, your selected repository, and your account identifier, so that Groville can update files in a repository you
        choose — but only when you explicitly approve an action.
      </p>
      <p>
        <strong>f. Competitor and public web data.</strong> To benchmark your business, Groville searches for and reads publicly
        accessible competitor websites and captures screenshots of them.
      </p>
      <p>
        <strong>g. Generated content.</strong> The opportunities, campaign drafts, analyses, dossiers, and image tiles that
        Groville produces for you.
      </p>
      <p>
        <strong>h. Payment information.</strong> Subscription payments are processed by our third-party payment provider, BMONI.
        Groville does not collect or store your card or bank-account numbers; BMONI handles payment details directly.
      </p>
      <p>
        <strong>i. Technical and usage data.</strong> Basic logs, device/browser information, and a theme preference stored in
        your browser&apos;s local storage.
      </p>

      <h2>3. How we use your data and our lawful basis</h2>
      <p>We use your data to:</p>
      <ul>
        <li>
          provide the service — analyse your website and connected data, identify gaps, and draft campaigns for your review
          (lawful basis: performance of our contract with you);
        </li>
        <li>authenticate you and keep your account secure (contract / legitimate interest);</li>
        <li>process your subscription payments (contract);</li>
        <li>maintain, debug, and improve the service, and protect it from abuse (legitimate interest);</li>
        <li>comply with legal obligations (legal obligation).</li>
      </ul>
      <p>
        Where we rely on your <strong>consent</strong> — for example, when you connect Google Search Console or GitHub — you may
        withdraw that consent at any time by disconnecting the service or deleting your account.
      </p>
      <p>
        <strong>
          Groville never automatically sends, publishes, or posts anything on your behalf, and never spends your money. Every
          campaign and recommendation is a draft that you review and approve.
        </strong>{" "}
        The only changes Groville makes to a connected service (such as updating a file in a GitHub repository) happen after you
        explicitly approve that specific action.
      </p>

      <h2>4. Google user data and Limited Use</h2>
      <p>
        If you connect Google Search Console, Groville requests <strong>read-only</strong> access to your Search Console data
        (the <code>webmasters.readonly</code> scope). We use this data solely to show you your own search performance and to
        inform the analysis and recommendations presented to you inside Groville.
      </p>
      <p>
        Groville&apos;s use of information received from Google APIs adheres to the Google API Services User Data Policy (
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          https://developers.google.com/terms/api-services-user-data-policy
        </a>
        ), including the <strong>Limited Use</strong> requirements. Specifically:
      </p>
      <ul>
        <li>
          we do <strong>not</strong> sell Google user data;
        </li>
        <li>
          we do <strong>not</strong> use Google user data for advertising;
        </li>
        <li>
          we do <strong>not</strong> transfer Google user data except as necessary to provide or improve the features you use, to
          comply with applicable law, or as part of a merger or acquisition with your consent;
        </li>
        <li>
          we do <strong>not</strong> use Google user data to train generalised artificial-intelligence or machine-learning
          models;
        </li>
        <li>
          humans do <strong>not</strong> read your Google user data unless we have your consent for specific messages, it is
          necessary for security or to comply with the law, or the data has been aggregated and anonymised for internal
          operations.
        </li>
      </ul>
      <p>
        You can revoke Groville&apos;s access to your Google data at any time by disconnecting Search Console in the app or
        through your Google Account security settings.
      </p>

      <h2>5. AI processing of your content</h2>
      <p>
        To produce analyses and drafts, Groville sends relevant content — including text and screenshots from your website and
        from competitor websites — to our third-party large-language-model provider, <strong>Groq</strong>, which processes it to
        generate the output you see. We send only what is needed to produce your results.
      </p>

      <h2>6. Who we share your data with</h2>
      <p>
        We do not sell your personal data. We share data only with service providers who help us run Groville, and only as
        needed:
      </p>
      <ul>
        <li>
          <strong>Google Cloud / Firestore</strong> — database and account storage;
        </li>
        <li>
          <strong>Supabase</strong> — storage of generated image tiles;
        </li>
        <li>
          <strong>Render</strong> — backend hosting and processing;
        </li>
        <li>
          <strong>Vercel</strong> — frontend hosting;
        </li>
        <li>
          <strong>Groq</strong> — AI processing of content, as described in Section 5;
        </li>
        <li>
          <strong>BMONI</strong> — payment processing;
        </li>
        <li>
          <strong>DuckDuckGo</strong> — competitor search queries.
        </li>
      </ul>
      <p>We may also disclose data if required by law, or to protect our rights, users, or the public.</p>

      <h2>7. Storage, security, and retention</h2>
      <p>
        We apply reasonable technical and organisational measures to protect your data. OAuth tokens for connected services
        (Google, GitHub) are <strong>encrypted at rest</strong>. Access to systems is restricted.
      </p>
      <p>
        We retain your data only for as long as your account is active. When you delete your account, your data is deleted
        immediately and permanently: we carry out a cascading deletion of your user record, businesses, analyses, opportunities,
        actions, connections, and stored tiles, and we keep no copies afterwards. Deleted means deleted.
      </p>

      <h2>8. International data transfers</h2>
      <p>
        Some of our service providers (such as Google Cloud, Render, Vercel, Supabase, and Groq) process data on servers located
        outside Nigeria. Where your data is transferred outside Nigeria, we rely on the lawful bases for cross-border transfer
        permitted under the NDPA, and take steps to ensure your data remains protected.
      </p>

      <h2>9. Your rights</h2>
      <p>
        Under the NDPA, you have the right to: be informed about how your data is used; access your data; have inaccurate data
        corrected; have your data erased; restrict or object to processing; data portability; and to withdraw consent at any
        time. You also have the right to lodge a complaint with the Nigeria Data Protection Commission (NDPC).
      </p>
      <p>
        To exercise any of these rights, email{" "}
        <strong>
          <a href="mailto:joshua.nicholas@student.aul.edu.ng">joshua.nicholas@student.aul.edu.ng</a>
        </strong>
        . You can also delete your account and its data directly from your account settings.
      </p>

      <h2>10. Children</h2>
      <p>
        Groville is not intended for anyone under the age of 18, and we do not knowingly collect personal data from children.
      </p>

      <h2>11. Cookies and local storage</h2>
      <p>
        We use a strictly necessary session cookie to keep you signed in. We store your theme preference in your browser&apos;s
        local storage. We do not use advertising or third-party tracking cookies.
      </p>

      <h2>12. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. We will post the updated version here with a new &quot;Last updated&quot;
        date, and where changes are significant, we will take reasonable steps to notify you.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions or data requests:{" "}
        <strong>
          <a href="mailto:joshua.nicholas@student.aul.edu.ng">joshua.nicholas@student.aul.edu.ng</a>
        </strong>
      </p>
    </LegalPage>
  );
}
