import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";
import { LegalPage } from "@/components/landing/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Learn how Veradic AI collects, uses, and protects your personal information. Veradic AI is committed to safeguarding student data and privacy.",
  alternates: {
    canonical: `${SITE_URL}/privacy`,
  },
};

const sections = [
  {
    id: "introduction",
    title: "Introduction",
    content: `
      <p>Welcome to Veradic AI. This Privacy Policy explains how Veradic LLC ("Veradic," "we," "us," or "our") collects, uses, discloses, and safeguards your information when you use the Veradic platform, including our website, mobile applications, and related services (collectively, the "Service").</p>
      <p>By using Veradic, you agree to the collection and use of information in accordance with this policy. If you do not agree with this policy, please do not use Veradic.</p>
    `,
  },
  {
    id: "information-we-collect",
    title: "Information We Collect",
    content: `
      <p>Veradic collects several types of information to provide and improve our Service:</p>
      <p><strong>Account Information</strong></p>
      <p>When you create a Veradic account, we collect your name, email address, password, and grade level. If you register through a school, Veradic may also receive your school name and class enrollment information.</p>
      <p><strong>Usage Data</strong></p>
      <p>Veradic automatically collects information about how you interact with the Service, including problems submitted, session history, practice results, and feature usage patterns.</p>
      <p><strong>Content You Provide</strong></p>
      <p>When you use Veradic, you may upload photos of homework or worksheets, type in math and science problems, submit handwritten work for diagnosis, and chat with the AI tutor. Veradic processes this content to provide tutoring responses.</p>
      <p><strong>Device and Technical Information</strong></p>
      <p>Veradic collects device type, operating system, browser type, IP address, and general location data (country/region level) to improve performance and security.</p>
      <p><strong>Payment Information</strong></p>
      <p>If you subscribe to a paid Veradic plan, payment processing is handled by our third-party provider (RevenueCat/Apple/Google). Veradic does not store your credit card number or payment details directly.</p>
    `,
  },
  {
    id: "how-we-use-information",
    title: "How Veradic Uses Your Information",
    content: `
      <p>Veradic uses the information we collect to:</p>
      <ul>
        <li>Provide, operate, and maintain the Veradic tutoring service</li>
        <li>Generate step-by-step solutions, practice problems, and AI tutor responses</li>
        <li>Save your session history so you can resume where you left off on Veradic</li>
        <li>Process subscriptions and manage your Veradic account</li>
        <li>Send you service-related communications (e.g., password resets, account updates)</li>
        <li>Analyze usage patterns to improve Veradic and develop new features</li>
        <li>Detect and prevent fraud, abuse, or security threats to Veradic</li>
        <li>Comply with legal obligations</li>
      </ul>
      <p>Veradic does not sell your personal information to third parties.</p>
    `,
  },
  {
    id: "third-party-services",
    title: "Third-Party Services",
    content: `
      <p>Veradic relies on trusted third-party services to operate. These providers may process your data on behalf of Veradic:</p>
      <ul>
        <li><strong>AI Providers</strong> — Veradic sends problem content to AI language model providers to generate tutoring responses. This content is processed according to each provider's data handling policies.</li>
        <li><strong>Hosting</strong> — Veradic is hosted on Vercel. Your interactions with Veradic pass through their infrastructure.</li>
        <li><strong>Payment Processing</strong> — RevenueCat, Apple App Store, and Google Play handle subscription billing for Veradic.</li>
        <li><strong>Analytics</strong> — Veradic uses Vercel Analytics and Google Analytics to understand how the Service is used. These tools collect anonymized usage data.</li>
      </ul>
      <p>Veradic requires all third-party providers to handle your data securely and in accordance with applicable laws.</p>
    `,
  },
  {
    id: "data-retention",
    title: "Data Retention",
    content: `
      <p>Veradic retains your personal information for as long as your account is active or as needed to provide the Service. Session history and practice data are retained so you can review past work on Veradic.</p>
      <p>If you delete your Veradic account, we will delete or anonymize your personal data within 30 days, except where Veradic is required to retain it for legal or regulatory purposes.</p>
    `,
  },
  {
    id: "data-deletion",
    title: "Your Rights and Data Deletion",
    content: `
      <p>You have the right to:</p>
      <ul>
        <li><strong>Access</strong> — Request a copy of the personal data Veradic holds about you</li>
        <li><strong>Correction</strong> — Ask Veradic to correct inaccurate information</li>
        <li><strong>Deletion</strong> — Request that Veradic delete your account and personal data</li>
        <li><strong>Portability</strong> — Request your data in a portable format from Veradic</li>
      </ul>
      <p>To delete your Veradic account, go to <strong>Account Settings</strong> in the Veradic app and select <strong>Delete Account</strong>. You can also contact Veradic at <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a> to request deletion.</p>
    `,
  },
  {
    id: "childrens-privacy",
    title: "Children's Privacy",
    content: `
      <p>Veradic is designed for students of all ages, including those under 13. Veradic takes children's privacy seriously and complies with applicable children's privacy laws, including COPPA (Children's Online Privacy Protection Act).</p>
      <p>For users under 13, Veradic collects only the minimum information necessary to provide the tutoring service. Veradic does not knowingly collect personal information from children under 13 without parental or school consent.</p>
      <p>If you believe Veradic has collected information from a child without proper consent, please contact us at <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a> and Veradic will promptly delete the information.</p>
    `,
  },
  {
    id: "security",
    title: "Security",
    content: `
      <p>Veradic takes reasonable measures to protect your personal information from unauthorized access, alteration, disclosure, or destruction. This includes encryption of data in transit and at rest, secure authentication, and regular security reviews.</p>
      <p>However, no method of transmission over the internet is 100% secure. While Veradic strives to protect your data, we cannot guarantee absolute security.</p>
    `,
  },
  {
    id: "changes",
    title: "Changes to This Policy",
    content: `
      <p>Veradic may update this Privacy Policy from time to time. When we make changes, Veradic will update the "Last updated" date at the top of this page. We encourage you to review this policy periodically.</p>
      <p>If Veradic makes material changes, we will notify you by email or through a notice on the Veradic platform.</p>
    `,
  },
  {
    id: "contact",
    title: "Contact Veradic",
    content: `
      <p>If you have questions about this Privacy Policy or how Veradic handles your data, please contact us:</p>
      <ul>
        <li><strong>Email:</strong> <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a></li>
        <li><strong>Website:</strong> <a href="https://veradicai.com/support" class="text-primary hover:underline">veradicai.com/support</a></li>
      </ul>
    `,
  },
];

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" lastUpdated="April 3, 2026" sections={sections} />;
}
