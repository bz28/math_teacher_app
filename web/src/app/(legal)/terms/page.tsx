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
      <p>Veradic is a supplementary learning tool designed to support education. Veradic does not provide professional educational, academic, or tutoring advice. The Service is for informational and supplementary purposes only. Veradic does not guarantee specific academic outcomes, grades, or test scores.</p>
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
      <p>Veradic reserves the right to suspend or terminate accounts that violate these Terms or for any other reason at our sole discretion, with or without notice.</p>
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
      <p><strong>Paid Plans and Auto-Renewal</strong></p>
      <p>Veradic paid subscriptions are billed through the applicable app store or our website. By subscribing, you agree to the pricing and billing terms presented at the time of purchase. <strong>Paid subscriptions automatically renew unless canceled at least 24 hours before the end of the current billing period.</strong> You will be charged the applicable subscription fee at the start of each renewal period.</p>
      <p><strong>Cancellation</strong></p>
      <p>You may cancel your Veradic subscription at any time through your device's subscription management settings or the Veradic account settings. Cancellation takes effect at the end of the current billing period. Veradic does not provide refunds for partial billing periods unless required by applicable law.</p>
      <p><strong>Price Changes</strong></p>
      <p>Veradic reserves the right to change subscription pricing at any time. We will make reasonable efforts to provide notice before any price change takes effect. Your continued subscription after a price change constitutes acceptance of the new pricing.</p>
    `,
  },
  {
    id: "intellectual-property",
    title: "Intellectual Property",
    content: `
      <p><strong>Veradic's Property</strong></p>
      <p>The Veradic Service, including its design, code, features, content, and branding, is owned by Veradic and protected by intellectual property laws. You may not copy, modify, distribute, or create derivative works from Veradic without written permission.</p>
      <p><strong>Your Content</strong></p>
      <p>You retain ownership of the content you submit to Veradic (photos, problems, handwritten work). By submitting content to Veradic, you grant Veradic a worldwide, non-exclusive, royalty-free license to use, process, store, and reproduce your content for the purpose of providing, improving, and developing the Service. This license survives termination of your account with respect to anonymized or aggregated data. Veradic does not claim ownership of your content.</p>
    `,
  },
  {
    id: "ai-content",
    title: "AI-Generated Content",
    content: `
      <p>Veradic uses artificial intelligence to generate tutoring responses, step-by-step solutions, practice problems, and other educational content. You acknowledge and agree that:</p>
      <ul>
        <li>AI-generated content may contain errors, inaccuracies, or incomplete information</li>
        <li>You are solely responsible for verifying any information provided by Veradic before relying on it</li>
        <li>Veradic does not guarantee the accuracy, completeness, or suitability of AI-generated content for any particular purpose</li>
        <li>AI-generated content does not constitute professional educational advice</li>
      </ul>
      <p>Veradic is not liable for any decisions, actions, or outcomes based on AI-generated content provided through the Service.</p>
    `,
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    content: `
      <p><strong>THE VERADIC SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.</strong></p>
      <p>Veradic does not warrant that:</p>
      <ul>
        <li>The Service will be uninterrupted, timely, error-free, or secure</li>
        <li>The results obtained from using the Service will be accurate or reliable</li>
        <li>The Service will meet your specific requirements or expectations</li>
        <li>Any errors in the Service will be corrected</li>
      </ul>
      <p>Your use of Veradic is at your sole risk. Veradic is a supplementary learning tool and should not be used as a substitute for professional instruction.</p>
    `,
  },
  {
    id: "limitation-of-liability",
    title: "Limitation of Liability",
    content: `
      <p><strong>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, VERADIC SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF OR INABILITY TO USE VERADIC, INCLUDING BUT NOT LIMITED TO LOSS OF DATA, LOSS OF PROFITS, ACADEMIC OUTCOMES, OR ANY OTHER INTANGIBLE LOSSES.</strong></p>
      <p>Veradic's total aggregate liability to you for any and all claims arising from these Terms or the Service shall not exceed the greater of (a) the amount you have paid to Veradic in the 12 months preceding the claim, or (b) one hundred dollars ($100).</p>
      <p>Some jurisdictions do not allow the exclusion or limitation of certain damages, so some of the above limitations may not apply to you. In such jurisdictions, Veradic's liability shall be limited to the maximum extent permitted by law.</p>
    `,
  },
  {
    id: "indemnification",
    title: "Indemnification",
    content: `
      <p>You agree to indemnify, defend, and hold harmless Veradic, its officers, directors, employees, agents, and affiliates from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising from or related to:</p>
      <ul>
        <li>Your use of the Veradic Service</li>
        <li>Your violation of these Terms</li>
        <li>Your violation of any third-party rights</li>
        <li>Any content you submit to Veradic</li>
      </ul>
      <p>This indemnification obligation shall survive the termination of your Veradic account and these Terms.</p>
    `,
  },
  {
    id: "arbitration",
    title: "Dispute Resolution and Arbitration",
    content: `
      <p><strong>PLEASE READ THIS SECTION CAREFULLY — IT AFFECTS YOUR LEGAL RIGHTS, INCLUDING YOUR RIGHT TO FILE A LAWSUIT IN COURT.</strong></p>
      <p><strong>Binding Arbitration</strong></p>
      <p>You and Veradic agree that any dispute, claim, or controversy arising out of or relating to these Terms or the use of the Veradic Service ("Dispute") shall be resolved exclusively through final and binding individual arbitration, rather than in court, except that either party may bring an individual action in small claims court if the claim qualifies.</p>
      <p><strong>Class Action Waiver</strong></p>
      <p><strong>YOU AND VERADIC AGREE THAT EACH PARTY MAY BRING CLAIMS AGAINST THE OTHER ONLY IN YOUR OR ITS INDIVIDUAL CAPACITY, AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS, CONSOLIDATED, OR REPRESENTATIVE ACTION.</strong> The arbitrator may not consolidate more than one person's claims and may not preside over any form of class or representative proceeding.</p>
      <p><strong>Arbitration Procedures</strong></p>
      <p>Arbitration shall be administered by the American Arbitration Association ("AAA") under its Consumer Arbitration Rules then in effect. The arbitration shall be conducted in English. The arbitrator's decision shall be final and binding and may be entered as a judgment in any court of competent jurisdiction.</p>
      <p><strong>Informal Resolution First</strong></p>
      <p>Before initiating arbitration, you agree to first contact Veradic at <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a> and attempt to resolve the Dispute informally for at least 30 days. If the Dispute is not resolved within 30 days, either party may proceed with arbitration.</p>
      <p><strong>Opt-Out</strong></p>
      <p>You may opt out of this arbitration agreement by sending written notice to <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a> within 30 days of first accepting these Terms. If you opt out, you and Veradic may pursue claims in court.</p>
    `,
  },
  {
    id: "termination",
    title: "Termination",
    content: `
      <p>You may stop using Veradic and delete your account at any time. Veradic may suspend or terminate your access at any time, for any reason, at our sole discretion, including but not limited to violation of these Terms or conduct that Veradic determines is harmful to other users or the Service. Veradic may also discontinue the Service entirely with 30 days notice.</p>
      <p>Upon termination, your right to use Veradic ceases immediately. Veradic will handle your data in accordance with our <a href="/privacy" class="text-primary hover:underline">Privacy Policy</a>. Sections that by their nature should survive termination (including Disclaimers, Limitation of Liability, Indemnification, Arbitration, and Governing Law) shall survive.</p>
    `,
  },
  {
    id: "changes",
    title: "Changes to These Terms",
    content: `
      <p>Veradic may update these Terms from time to time at our sole discretion. When changes are made, Veradic will update the "Last updated" date at the top of this page. Your continued use of Veradic after any changes constitutes acceptance of the updated Terms.</p>
      <p>For material changes, Veradic will make reasonable efforts to notify you through the Service or via email. If you do not agree to the updated Terms, you must stop using Veradic.</p>
    `,
  },
  {
    id: "governing-law",
    title: "Governing Law",
    content: `
      <p>These Terms are governed by and construed in accordance with the laws of the state in which Veradic LLC is organized, without regard to conflict of law principles. Subject to the arbitration agreement above, any legal action not subject to arbitration shall be brought in the courts located in the jurisdiction where Veradic LLC is organized.</p>
    `,
  },
  {
    id: "severability",
    title: "Severability",
    content: `
      <p>If any provision of these Terms is held to be invalid, illegal, or unenforceable, the remaining provisions shall continue in full force and effect. The invalid provision shall be modified to the minimum extent necessary to make it valid and enforceable while preserving its original intent.</p>
    `,
  },
  {
    id: "entire-agreement",
    title: "Entire Agreement",
    content: `
      <p>These Terms, together with the <a href="/privacy" class="text-primary hover:underline">Privacy Policy</a>, constitute the entire agreement between you and Veradic regarding the Service and supersede any prior agreements or understandings.</p>
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
