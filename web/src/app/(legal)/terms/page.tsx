import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";
import { LegalPage } from "@/components/landing/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Read the Veradic AI Terms of Service. By using Veradic AI, you agree to these terms governing your use of our AI tutoring platform.",
  alternates: {
    canonical: `${SITE_URL}/terms`,
  },
};

const sections = [
  {
    id: "acceptance",
    title: "Acceptance of Terms",
    content: `
      <p>By accessing or using Veradic AI, operated by Veradic LLC ("Veradic," "we," "us," or "our"), including our website at veradicai.com, mobile applications, and related services (collectively, the "Service"), you agree to be bound by these Terms of Service ("Terms").</p>
      <p>If you do not agree to these Terms, you may not use Veradic. If you are using Veradic on behalf of a school or organization, you represent that you have authority to bind that organization to these Terms.</p>
    `,
  },
  {
    id: "description",
    title: "Description of Veradic",
    content: `
      <p>Veradic is an AI-powered tutoring platform that helps students learn math and science by breaking problems into guided, step-by-step solutions. Veradic provides features including step-by-step learning, AI chat tutoring, work diagnosis, unlimited practice problem generation, mock exams, and session history.</p>
      <p>Veradic is a learning tool designed to support education. Veradic does not guarantee specific academic outcomes, grades, or test scores.</p>
    `,
  },
  {
    id: "accounts",
    title: "Accounts and Registration",
    content: `
      <p>To use most features of Veradic, you must create an account. When registering for Veradic, you agree to:</p>
      <ul>
        <li>Provide accurate and complete information</li>
        <li>Keep your Veradic password secure and confidential</li>
        <li>Notify Veradic immediately if you suspect unauthorized access to your account</li>
        <li>Accept responsibility for all activity that occurs under your Veradic account</li>
      </ul>
      <p>Veradic reserves the right to suspend or terminate accounts that violate these Terms.</p>
    `,
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use",
    content: `
      <p>When using Veradic, you agree not to:</p>
      <ul>
        <li>Use Veradic to cheat on graded assignments, exams, or tests where AI assistance is prohibited</li>
        <li>Submit content that is illegal, harmful, threatening, abusive, or otherwise objectionable to Veradic</li>
        <li>Attempt to reverse-engineer, decompile, or extract the underlying algorithms or models of Veradic</li>
        <li>Use automated tools, bots, or scrapers to access Veradic</li>
        <li>Interfere with or disrupt the Veradic Service or its infrastructure</li>
        <li>Impersonate another person or entity when using Veradic</li>
        <li>Use Veradic for any commercial purpose without written permission from Veradic</li>
      </ul>
      <p>Veradic is designed to help you <strong>learn</strong>, not to do your work for you. Veradic intentionally hides final answers and guides you through problems step by step to promote genuine understanding.</p>
    `,
  },
  {
    id: "subscriptions",
    title: "Subscriptions and Payments",
    content: `
      <p>Veradic offers both free and paid subscription plans. The free tier of Veradic includes a limited number of daily sessions and photo scans.</p>
      <p><strong>Paid Plans</strong></p>
      <p>Veradic paid subscriptions are billed through the Apple App Store, Google Play Store, or our web payment provider. By subscribing, you agree to the pricing and billing terms presented at the time of purchase.</p>
      <p><strong>Cancellation</strong></p>
      <p>You may cancel your Veradic subscription at any time through your device's subscription management or the Veradic account settings. Cancellation takes effect at the end of the current billing period — Veradic does not provide refunds for partial periods.</p>
      <p><strong>Price Changes</strong></p>
      <p>Veradic reserves the right to change subscription pricing. We will provide notice before any price change takes effect on your Veradic account.</p>
    `,
  },
  {
    id: "intellectual-property",
    title: "Intellectual Property",
    content: `
      <p><strong>Veradic's Property</strong></p>
      <p>The Veradic Service, including its design, code, features, content, and branding, is owned by Veradic and protected by intellectual property laws. You may not copy, modify, distribute, or create derivative works from Veradic without written permission.</p>
      <p><strong>Your Content</strong></p>
      <p>You retain ownership of the content you submit to Veradic (photos, problems, handwritten work). By submitting content to Veradic, you grant Veradic a limited license to process it for the purpose of providing the Service. Veradic does not claim ownership of your content.</p>
    `,
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    content: `
      <p>Veradic is provided "as is" and "as available" without warranties of any kind, either express or implied. Veradic does not warrant that:</p>
      <ul>
        <li>The Veradic Service will be uninterrupted, error-free, or secure</li>
        <li>AI-generated responses from Veradic will be 100% accurate in all cases</li>
        <li>Veradic will meet your specific learning requirements or expectations</li>
      </ul>
      <p>Veradic is a supplementary learning tool. It should not be used as a substitute for professional instruction, and Veradic is not responsible for academic decisions made based on its output.</p>
    `,
  },
  {
    id: "limitation-of-liability",
    title: "Limitation of Liability",
    content: `
      <p>To the maximum extent permitted by law, Veradic shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of Veradic, including but not limited to loss of data, academic outcomes, or profits.</p>
      <p>Veradic's total liability to you for any claim arising from these Terms or the Service shall not exceed the amount you have paid to Veradic in the 12 months preceding the claim.</p>
    `,
  },
  {
    id: "termination",
    title: "Termination",
    content: `
      <p>You may stop using Veradic and delete your account at any time. Veradic may also suspend or terminate your access if you violate these Terms or engage in conduct that Veradic determines is harmful to other users or the Service.</p>
      <p>Upon termination, your right to use Veradic ceases immediately. Veradic will delete your data in accordance with our <a href="/privacy" class="text-primary hover:underline">Privacy Policy</a>.</p>
    `,
  },
  {
    id: "changes",
    title: "Changes to These Terms",
    content: `
      <p>Veradic may update these Terms from time to time. When changes are made, Veradic will update the "Last updated" date at the top of this page. Continued use of Veradic after changes constitutes acceptance of the updated Terms.</p>
      <p>If Veradic makes material changes, we will notify you by email or through a notice on the Veradic platform.</p>
    `,
  },
  {
    id: "governing-law",
    title: "Governing Law",
    content: `
      <p>These Terms are governed by and construed in accordance with the laws of the United States, without regard to conflict of law principles. Any disputes arising from these Terms or your use of Veradic shall be resolved in the courts of competent jurisdiction.</p>
    `,
  },
  {
    id: "contact",
    title: "Contact Veradic",
    content: `
      <p>If you have questions about these Terms, please contact Veradic:</p>
      <ul>
        <li><strong>Email:</strong> <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a></li>
        <li><strong>Website:</strong> <a href="https://veradicai.com/support" class="text-primary hover:underline">veradicai.com/support</a></li>
      </ul>
    `,
  },
];

export default function TermsPage() {
  return <LegalPage title="Terms of Service" lastUpdated="April 3, 2026" sections={sections} />;
}
