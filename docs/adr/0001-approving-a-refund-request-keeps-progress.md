# Approving a Refund Request ends the Enrollment but keeps the Student's progress

The buyer keeps their Enrollment while their Refund Request is Open and loses it the moment a Platform Admin approves it, not when the Refund is issued. Their lesson progress, watch history, quiz attempts, comments and rating stay. Deleting them can't be undone, the watch history is the evidence the approval was decided on, and a Student who buys again or claims a Seat later should pick up where they left off. Rows for a Student with no Enrollment are expected, not orphans to clean up.

## Considered Options

- **End the Enrollment when the request is raised**: rejected, because a buyer whose request is declined would have been locked out for nothing.
- **End the Enrollment when the Refund is issued**: rejected, because a Failed Refund would leave the buyer holding both an Enrollment and an Approved Refund Request, and it would tie the Enrollment to money movement that is handled separately.
