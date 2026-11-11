import { RefundRequestStatus, RefundStatus } from "~/db/schema";
import { cn } from "~/lib/utils";

const TONES = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  gray: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

function describe(
  status: RefundRequestStatus,
  refundStatus: RefundStatus | null,
  audience: "learner" | "admin"
): { label: string; tone: keyof typeof TONES } {
  if (status === RefundRequestStatus.Open) return { label: "Open", tone: "amber" };
  if (status === RefundRequestStatus.Declined) return { label: "Declined", tone: "gray" };
  if (refundStatus === RefundStatus.Issued) return { label: "Refunded", tone: "green" };
  // A Failed Refund is the team's problem to fix; the learner just sees it is
  // still on its way.
  if (refundStatus === RefundStatus.Failed && audience === "admin") {
    return { label: "Refund failed", tone: "red" };
  }
  return { label: "Refund pending", tone: "blue" };
}

export function RefundStatusBadge({
  status,
  refundStatus,
  audience,
}: {
  status: RefundRequestStatus;
  refundStatus: RefundStatus | null;
  audience: "learner" | "admin";
}) {
  const { label, tone } = describe(status, refundStatus, audience);
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONES[tone]
      )}
    >
      {label}
    </span>
  );
}
