# SMS Opt-In and Consent Flow for ReguGuard

## Brand and Messaging Details

- **Company Name:** SecTek
- **AI Agent Name:** Chris (AI Compliance Agent)
- **Purpose:** 24/7 assistance in managing security guard license compliance and renewals
- **Message Frequency:** Varies based on employee license status (transactional/alert-based)
- **Messaging Numbers:** +1 202-410-8833

## Opt-In Process

Our opt-in process is **100% employee-initiated**. We do not send any messages to an employee until they have texted our number first.

Explicit consent for ongoing, recurring compliance notification messages is captured via a keyword (**START** or **JOIN**) confirmation, as detailed in the flow below.

## Employee-Initiated Opt-In Flow

| Step | Sender | Message Content / Action | Compliance Analysis |
|------|--------|--------------------------|---------------------|
| 1 | Employee | Employee texts SecTek number (e.g., "Hello", "Hi", or any message) | The user initiated the contact, providing implicit consent for the initial response. This establishes a communication channel. |
| 2 | System | Verifies employee by phone number in system | Employee identity verification required before providing service. If not found, proceed to step 2b. |
| 2a | Chris | (If employee found) "👋 Hi [FirstName]! I'm Chris, your AI compliance agent from SecTek. I help you stay compliant with your security guard license requirements. You'll receive alerts about license expirations, renewal deadlines, and compliance updates. Reply START to opt in." | Provides clear disclosure of message purpose and requests explicit opt-in. No consent assumed - explicit opt-in required. |
| 2b | Chris | (If employee not found) "We can't verify your employment status based on this phone number. If you believe this is an error, please update your phone number in eHub and try again, or contact your supervisor for assistance." | Informs unknown users that service requires verified employee status. Protects against unauthorized access. |
| 3 | Employee | Employee replies "START" or "JOIN" | Explicit, affirmative consent captured via keyword. Employee has clear understanding of what they're consenting to. |
| 4 | System | Creates conversation record and marks employee as opted-in | Consent is logged with timestamp and phone number for compliance documentation. |
| 5 | Chris | "Thanks, [FirstName]! You're now enrolled. I'll send you alerts about your license status as renewal deadlines approach and can help you through the process. Reply HELP anytime for assistance, or STOP to opt out." | Confirmation message that reinforces opt-out mechanism and provides support contact. |
| 6 | Chris | [Ongoing compliance notifications and Q&A support] | All subsequent messages are sent under explicit consent obtained in Step 3. Each message includes opt-out instructions. |

## Alternative: Onboarding-Initiated Flow

If employees are informed during onboarding documentation about the SMS service:

| Step | Sender | Message Content / Action | Compliance Analysis |
|------|--------|--------------------------|---------------------|
| 1 | HR/Onboarding | Employee completes onboarding form that mentions: "You can opt in to receive compliance notifications via SMS by texting [number] with START" | Employee is informed about SMS service during onboarding, but no consent is assumed. |
| 2 | Employee | Employee texts SecTek number with "START" | Employee initiates contact after being informed during onboarding. Explicit consent via keyword. |
| 3 | System | Verifies employee by phone number | Same verification as primary flow - ensures only verified employees can opt in. |
| 4 | Chris | "Thanks, [FirstName]! You're now enrolled. I'll send you alerts about your license status as renewal deadlines approach and can help you through the process. Reply HELP anytime for assistance, or STOP to opt out." | Confirmation with clear disclosure and opt-out mechanism. |
| 5 | Chris | [Ongoing compliance notifications and Q&A support] | All messages sent under explicit consent. |

## Key Compliance Features

1. **100% User-Initiated:** No unsolicited messages sent
2. **Explicit Consent:** Keyword-based opt-in (START/JOIN)
3. **Clear Disclosure:** Purpose, frequency, and opt-out mechanism explained upfront
4. **Persistent Opt-Out:** Every message includes "Reply STOP to opt out"
5. **Documentation:** All opt-ins logged with timestamp and phone number
6. **Honor Opt-Outs Immediately:** STOP requests processed within 24 hours

## Message Examples

### Initial Opt-In Request (First Contact from Known Employee)
```
👋 Hi [FirstName]! I'm Chris, your AI compliance agent from SecTek. I help you stay compliant with your security guard license requirements. You'll receive alerts about license expirations, renewal deadlines, and compliance updates. Reply START to opt in.
```

### Unknown Employee Response
```
We can't verify your employment status based on this phone number. If you believe this is an error, please update your phone number in eHub and try again, or contact your supervisor for assistance.
```

### Welcome Message (After START Confirmation)
```
Thanks, [FirstName]! You're now enrolled. I'll send you alerts about your license status as renewal deadlines approach and can help you through the process. Reply HELP anytime for assistance, or STOP to opt out.
```

### Compliance Alert
```
Chris - SecTek: Your [License Type] expires on [date]. Please renew to maintain compliance. Reply STOP to opt out.
```

### Renewal Reminder
```
Chris - SecTek: Your license renewal deadline is approaching. Renew by [date] to avoid expiration. Reply STOP to opt out.
```

### Opt-Out Confirmation
```
You have been unsubscribed from SecTek compliance notifications. You will no longer receive alerts from Chris. Text START anytime to re-enroll.
```

## A2P 10DLC Campaign Description

**For use in Twilio A2P 10DLC registration:**

This campaign sends compliance notifications and license expiration reminders to security guard employees. Messages include alerts about upcoming license expirations, renewal deadlines, and compliance status updates to help ensure employees maintain valid credentials required for their positions. All messages are sent only to employees who have explicitly opted in by texting START to our number, as disclosed during onboarding or through other communication channels.

## End User Consent Description

**For use in Twilio A2P 10DLC registration:**

Employees opt in to receive compliance notifications by initiating contact via SMS. During onboarding documentation, employees are informed that they can opt in to receive compliance notifications by texting our number with the keyword START. Employees may also discover the service through other company communications. Once an employee texts our number, they receive a welcome message explaining the service, message frequency, and how to opt out. Explicit consent is captured when the employee replies with START or JOIN. All messages include opt-out instructions (Reply STOP), and opt-out requests are honored immediately. Employees can re-enroll at any time by texting START again.

