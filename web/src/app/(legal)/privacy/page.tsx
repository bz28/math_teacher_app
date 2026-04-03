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
      <p>If you subscribe to a paid Veradic plan, payment processing is handled by third-party payment processors. Veradic does not store your credit card number or payment details directly.</p>
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
      <p>Veradic relies on trusted third-party service providers to operate. These providers may process your data on behalf of Veradic in the following categories:</p>
      <ul>
        <li><strong>AI Service Providers</strong> — Veradic sends problem content to AI language model providers to generate tutoring responses.</li>
        <li><strong>Cloud Hosting Providers</strong> — Veradic uses cloud infrastructure providers to host and deliver the Service.</li>
        <li><strong>Payment Processors</strong> — Third-party payment processors and app store platforms handle subscription billing for Veradic.</li>
        <li><strong>Analytics Services</strong> — Veradic uses analytics tools to understand how the Service is used and to improve performance.</li>
      </ul>
      <p>We select service providers we believe maintain appropriate security practices. Veradic may change its service providers at any time without notice to you.</p>
    `,
  },
  {
    id: "data-retention",
    title: "Data Retention",
    content: `
      <p>Veradic retains your personal information for as long as your account is active or as needed to provide the Service. Session history and practice data are retained so you can review past work on Veradic.</p>
      <p>If you delete your Veradic account, we will delete or anonymize your personal data within a reasonable timeframe, except where Veradic is required to retain it for legal, regulatory, or legitimate business purposes.</p>
    `,
  },
  {
    id: "data-deletion",
    title: "Your Rights and Data Deletion",
    content: `
      <p>Depending on your jurisdiction, you may have rights regarding your personal data, which may include:</p>
      <ul>
        <li><strong>Access</strong> — Request a copy of the personal data Veradic holds about you</li>
        <li><strong>Correction</strong> — Ask Veradic to correct inaccurate information</li>
        <li><strong>Deletion</strong> — Request that Veradic delete your account and personal data</li>
        <li><strong>Portability</strong> — Request your data in a portable format from Veradic</li>
      </ul>
      <p>To delete your Veradic account, go to <strong>Account Settings</strong> in the Veradic app and select <strong>Delete Account</strong>. You can also contact Veradic at <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a> to request deletion.</p>
      <p>Veradic will respond to valid requests within a reasonable timeframe and in accordance with applicable law.</p>
    `,
  },
  {
    id: "childrens-privacy",
    title: "Children's Privacy",
    content: `
      <p>Veradic does not knowingly collect personal information from children under 13 without appropriate consent. When Veradic is used in a school setting, the school is responsible for providing any necessary consent for students under 13 in accordance with applicable law, including COPPA (Children's Online Privacy Protection Act).</p>
      <p>If you believe Veradic has inadvertently collected information from a child under 13 without proper consent, please contact us at <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a> and Veradic will promptly investigate and take appropriate action.</p>
    `,
  },
  {
    id: "security",
    title: "Security",
    content: `
      <p>Veradic implements commercially reasonable administrative, technical, and physical safeguards designed to protect your personal information from unauthorized access, alteration, disclosure, or destruction.</p>
      <p>However, no method of transmission over the internet or method of electronic storage is completely secure. While Veradic strives to protect your data, we cannot guarantee absolute security and are not liable for any unauthorized access that occurs despite our commercially reasonable efforts.</p>
    `,
  },
  {
    id: "changes",
    title: "Changes to This Policy",
    content: `
      <p>Veradic may update this Privacy Policy from time to time at our sole discretion. When we make changes, Veradic will update the "Last updated" date at the top of this page. Your continued use of Veradic after any changes constitutes acceptance of the updated policy.</p>
      <p>We encourage you to review this policy periodically. For material changes, Veradic will make reasonable efforts to notify you through the Service or via email.</p>
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
