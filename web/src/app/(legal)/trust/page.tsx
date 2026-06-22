import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";
import { LegalPage } from "@/components/landing/legal-page";

export const metadata: Metadata = {
  title: "Trust & Security",
  description:
    "How Veradic AI protects student data, secures the platform, and supports school district trust requirements. Privacy, security, compliance, and incident response in plain English.",
  alternates: {
    canonical: `${SITE_URL}/trust`,
  },
};

const sections = [
  {
    id: "overview",
    title: "Overview",
    content: `
      <p>Veradic is built for use in K-12 education. Protecting student data and supporting the trust of teachers, administrators, and families is foundational to how we design, build, and operate the platform.</p>
      <p>This page summarizes Veradic's security and trust posture in plain English. It is intentionally non-technical and high-level. For technical detail, vendor questionnaires, data privacy agreements, or other procurement documentation, contact <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a> and we will respond promptly.</p>
    `,
  },
  {
    id: "data-handling",
    title: "How Veradic Handles Student Data",
    content: `
      <p>Veradic acts as a school official under the direction of each contracting district. Student work, grades, and related records remain under the district's control and are used solely to provide the contracted service.</p>
      <p><strong>Student data is never used to train AI models</strong>, ours or anyone else's. This applies to student work, conversations with the AI tutor, integrity-review transcripts, grades, and any other student-generated content.</p>
      <p>Third-party AI service providers used by Veradic to generate tutoring responses receive only the content necessary to do so. They do not receive student identity.</p>
      <p>Veradic does not sell personal information to third parties. We do not use student data for advertising.</p>
    `,
  },
  {
    id: "authentication",
    title: "Account Security & Authentication",
    content: `
      <p>Veradic uses modern, industry-standard methods to protect user accounts:</p>
      <ul>
        <li>Passwords are protected using current cryptographic standards. Plaintext passwords are never stored or logged.</li>
        <li>Access tokens are short-lived. If a token were compromised, the window of risk is small.</li>
        <li>Repeated failed login attempts trigger automatic protective measures.</li>
        <li>Account deactivation takes effect immediately across all sessions.</li>
      </ul>
    `,
  },
  {
    id: "access-control",
    title: "Authorization & Access Controls",
    content: `
      <p>Veradic uses role-based access control. Every request is checked against the user's role and permissions before sensitive data is returned.</p>
      <ul>
        <li><strong>Students</strong> access only their own work and assigned coursework.</li>
        <li><strong>Teachers</strong> access only the students enrolled in their assigned sections.</li>
        <li><strong>Administrators</strong> have scoped administrative access necessary for their role.</li>
      </ul>
      <p>Cross-account access is prevented by application authorization checks on every request. Attempting to access another user's resources returns a permission-denied response without revealing whether the resource exists.</p>
    `,
  },
  {
    id: "encryption",
    title: "Encryption",
    content: `
      <p>All data transmitted between Veradic and user devices is encrypted in transit using current Transport Layer Security standards. HTTPS is enforced across the platform.</p>
      <p>Data stored by Veradic is encrypted at rest using industry-standard encryption methods provided by our cloud infrastructure.</p>
    `,
  },
  {
    id: "infrastructure",
    title: "Infrastructure & Operations",
    content: `
      <p>Veradic operates on established cloud infrastructure providers with mature compliance programs. Production systems are continuously monitored, with automated alerting on operational and security events.</p>
      <p>System secrets and credentials are managed using current secure-storage practices and are never embedded in client-side code.</p>
    `,
  },
  {
    id: "application-security",
    title: "Application Security",
    content: `
      <p>Veradic applies industry-standard web application security practices, including:</p>
      <ul>
        <li>Modern HTTP security headers across all responses</li>
        <li>Strict input validation on all user-submitted content</li>
        <li>Parameterized database queries to prevent injection</li>
        <li>File-upload validation that inspects content rather than relying on file extension</li>
        <li>Bounded request and field sizes to prevent resource exhaustion</li>
      </ul>
      <p>We track the OWASP Top 10 and broader industry guidance as part of our ongoing engineering practice.</p>
    `,
  },
  {
    id: "monitoring",
    title: "Monitoring & Auditing",
    content: `
      <p>Authenticated activity is logged with traceable per-request identifiers, enabling end-to-end tracing of any individual interaction. Logs are structured for analysis and stored securely.</p>
      <p>AI service calls made on behalf of users are recorded with sufficient detail to support debugging, cost accounting, and post-incident review.</p>
    `,
  },
  {
    id: "incident-response",
    title: "Incident Response",
    content: `
      <p>In the event of a confirmed data security incident affecting customer data, Veradic will notify affected districts within <strong>72 hours</strong> of confirmation and provide a written summary describing the nature of the incident, the data affected, and the remediation steps taken or planned.</p>
      <p>Our incident response procedures are available on request as part of procurement documentation.</p>
    `,
  },
  {
    id: "privacy-compliance",
    title: "Privacy & Compliance",
    content: `
      <p>Veradic is designed to support common education-sector privacy requirements:</p>
      <ul>
        <li><strong>FERPA</strong> — Veradic operates as a school official under the direction of each district. Student education records remain under district control.</li>
        <li><strong>COPPA</strong> — For students under 13, Veradic relies on the school-consent exception standard for classroom-deployed educational technology.</li>
        <li><strong>State-level laws</strong> — Veradic supports state-specific data privacy addenda on request, including New York Education Law §2-d, California SOPIPA, Illinois SOPPA, and others.</li>
        <li><strong>Data Privacy Agreements</strong> — Veradic will sign your district's standard data privacy agreement, including the National Data Privacy Agreement (NDPA) template used by most US districts.</li>
      </ul>
      <p>Refer to the <a href="/privacy" class="text-primary hover:underline">Privacy Policy</a> for details on data collection, use, retention, and user rights.</p>
    `,
  },
  {
    id: "responsible-disclosure",
    title: "Responsible Disclosure",
    content: `
      <p>If you discover a security vulnerability in Veradic, please contact <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a> with the details. We commit to acknowledging reports within 5 business days and will work in good faith to address valid issues.</p>
      <p>Please do not publicly disclose vulnerabilities before we have had a reasonable opportunity to investigate and remediate.</p>
    `,
  },
  {
    id: "documentation-requests",
    title: "Documentation & Procurement Support",
    content: `
      <p>Veradic supports district procurement processes. The following documentation is available on request:</p>
      <ul>
        <li>Data Privacy Agreement (DPA) template and state-specific addenda</li>
        <li>Security questionnaire responses</li>
        <li>Incident response procedure</li>
        <li>Accessibility statement</li>
        <li>Subprocessor list and data flow summary</li>
      </ul>
      <p>To request any of the above or to discuss district-specific requirements, contact <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a>.</p>
    `,
  },
  {
    id: "contact",
    title: "Contact",
    content: `
      <p>For all trust, security, privacy, and procurement inquiries, contact:</p>
      <ul>
        <li><strong>Email:</strong> <a href="mailto:support@veradicai.com" class="text-primary hover:underline">support@veradicai.com</a></li>
        <li><strong>Website:</strong> <a href="https://veradicai.com/support" class="text-primary hover:underline">veradicai.com/support</a></li>
      </ul>
    `,
  },
];

export default function TrustPage() {
  return <LegalPage title="Trust & Security" lastUpdated="May 23, 2026" sections={sections} />;
}
