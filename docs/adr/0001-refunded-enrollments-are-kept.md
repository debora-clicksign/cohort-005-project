# Refunded enrollments are kept, not deleted

When a Refund Request is approved, the learner's Enrollment is marked Refunded instead of the row being deleted. Deleting it would have worked with every existing access check for free, but it throws away when the learner enrolled and whether they completed, hides refunded learners from instructors, and makes "one Refund per learner per course" impossible to enforce on a later purchase.

## Consequences

Access is no longer "an enrollment row exists". Every place that decides whether a learner can see a course, or counts a course's learners, has to skip Refunded Enrollments. The enrollment check that was copied into individual routes goes through `app/lib/access.server.ts` instead, so there is one place to get this right; a check that still reads `enrollments` directly is a bug that lets a refunded learner keep watching.
