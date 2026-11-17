# Review approval email setup

This site now has a Netlify Function workflow for review moderation. New `Review Request` submissions are saved as pending, and a custom email is sent with Approve and Reject links. Each link opens a confirmation page; opening the email link alone does not change or publish a review. Approved reviews appear on the Reviews page. Rejected reviews stay private.

## Netlify requirements

The site must be deployed as a Netlify build so that Netlify can install the dependency and publish the function. A static drag-and-drop upload will not deploy functions. Connect the project to a Git repository or deploy it with the Netlify CLI. In Netlify Forms, make sure form detection is enabled so Netlify registers the `Review Request` form after deployment.

In Netlify, add these environment variables for the production deploy context:

- `RESEND_API_KEY`: API key from the Resend account used to send the moderation emails.
- `REVIEW_EMAIL_FROM`: a sender address verified in that Resend account, for example `TorquedByMB Reviews <reviews@your-verified-domain>`.
- `REVIEW_NOTIFICATION_EMAIL`: the address that should receive the approval requests.
- `REVIEW_APPROVAL_SECRET`: a private random value of at least 32 bytes. Do not put this value in site files or share it in chat.
- `SITE_URL`: `https://torquedbymb.co.uk`.

One way to generate a 32-byte secret in PowerShell is:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

After adding the variables, deploy the site. In Netlify Forms, disable the old email notification for the `Review Request` form so it does not send a duplicate notification. Leave the existing booking notification unchanged.

## Approval behavior

- New reviews are private until approved.
- The email has Approve and Reject links. Each opens a confirmation screen before it changes anything, which prevents mail security link scanners from accidentally taking the action.
- Approval publishes the review on the Reviews page. Rejection keeps it private.
- The links expire after 14 days. Only one decision can be recorded for each review.
- Netlify Forms continues to retain its own form submission record under the normal Netlify retention settings.
