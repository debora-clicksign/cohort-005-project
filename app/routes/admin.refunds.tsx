import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/admin.refunds";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { db } from "~/db";
import { RefundStatus, UserRole, users } from "~/db/schema";
import {
  approveRefundRequest,
  declineRefundRequest,
  listDecidedRefundRequests,
  listOpenRefundRequests,
  listUnsentRefunds,
  markRefundFailed,
  markRefundIssued,
} from "~/lib/refunds.server";
import { formatPrice } from "~/lib/utils";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { RefundStatusBadge } from "~/components/refund-status-badge";
import { AlertTriangle, Undo2 } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";

const adminRefundActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    requestId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("decline"),
    requestId: z.coerce.number().int(),
    declineReason: z
      .string()
      .trim()
      .min(10, "Tell the learner why — they will see this.")
      .max(1000, "Please keep the reason under 1000 characters."),
  }),
  z.object({
    intent: z.literal("mark-issued"),
    refundId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("mark-failed"),
    refundId: z.coerce.number().int(),
  }),
]);

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function requireAdminId(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to manage refunds.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can manage refunds.", { status: 403 });
  }

  return currentUser.id;
}

export function meta() {
  return [
    { title: "Refunds — Cadence" },
    { name: "description", content: "Decide refund requests and send refunds" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminId(request);

  return {
    openRequests: listOpenRefundRequests(),
    unsentRefunds: listUnsentRefunds(),
    decidedRequests: listDecidedRefundRequests(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const adminId = await requireAdminId(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, adminRefundActionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  switch (parsed.data.intent) {
    case "approve":
      approveRefundRequest(parsed.data.requestId, adminId);
      return { success: "Refund request approved." };
    case "decline":
      declineRefundRequest(
        parsed.data.requestId,
        adminId,
        parsed.data.declineReason
      );
      return { success: "Refund request declined." };
    case "mark-issued":
      markRefundIssued(parsed.data.refundId, adminId);
      return { success: "Refund marked as issued." };
    case "mark-failed":
      markRefundFailed(parsed.data.refundId, adminId);
      return { success: "Refund marked as failed." };
  }
}

type ActionResult = { success?: string; error?: string };

function useActionToast(fetcher: ReturnType<typeof useFetcher<ActionResult>>) {
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.success) toast.success(fetcher.data.success);
    if (fetcher.data.error) toast.error(fetcher.data.error);
  }, [fetcher.state, fetcher.data]);
}

type OpenRequest = Route.ComponentProps["loaderData"]["openRequests"][number];

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function OpenRequestCard({ request }: { request: OpenRequest }) {
  const fetcher = useFetcher<ActionResult>();
  const [mode, setMode] = useState<"idle" | "approving" | "declining">("idle");
  const isSubmitting = fetcher.state !== "idle";
  useActionToast(fetcher);

  const windowLabel =
    request.daysLeftInWindow < 0
      ? `Closed ${Math.abs(request.daysLeftInWindow)}d ago`
      : request.daysLeftInWindow === 0
        ? "Last day"
        : `${request.daysLeftInWindow} days`;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">{request.learnerName}</p>
            <p className="text-xs text-muted-foreground">
              {request.learnerEmail}
            </p>
          </div>
          <div className="text-right">
            <Link
              to={`/courses/${request.courseSlug}`}
              className="text-sm font-medium hover:underline"
            >
              {request.courseTitle}
            </Link>
            <p className="text-xs text-muted-foreground">
              Raised {formatDate(request.requestedAt)}
            </p>
          </div>
        </div>

        <blockquote className="border-l-2 pl-3 text-sm">
          {request.reason}
        </blockquote>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Fact label="Amount paid" value={formatPrice(request.amountPaid)} />
          <Fact label="Purchased" value={formatDate(request.purchasedAt)} />
          <Fact label="Left in window" value={windowLabel} />
          <Fact label="Watched" value={`${request.hoursWatched}h`} />
          <Fact
            label="Lessons completed"
            value={`${request.lessonsCompleted} of ${request.lessonCount}`}
          />
        </div>

        {mode === "idle" && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setMode("approving")}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMode("declining")}
            >
              Decline
            </Button>
          </div>
        )}

        {mode === "approving" && (
          <fetcher.Form method="post" className="space-y-2">
            <input type="hidden" name="intent" value="approve" />
            <input type="hidden" name="requestId" value={request.id} />
            <p className="text-sm">
              Approving starts a {formatPrice(request.amountPaid)} refund and
              ends {request.learnerName}&apos;s access to the course straight
              away.
            </p>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? "Approving..." : "Confirm approval"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setMode("idle")}
              >
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        )}

        {mode === "declining" && (
          <fetcher.Form method="post" className="space-y-2">
            <input type="hidden" name="intent" value="decline" />
            <input type="hidden" name="requestId" value={request.id} />
            <Textarea
              name="declineReason"
              required
              minLength={10}
              maxLength={1000}
              placeholder="Why are we declining? The learner will see this."
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Declining..." : "Decline request"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setMode("idle")}
              >
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        )}
      </CardContent>
    </Card>
  );
}

type UnsentRefund = Route.ComponentProps["loaderData"]["unsentRefunds"][number];

function UnsentRefundRow({ refund }: { refund: UnsentRefund }) {
  const fetcher = useFetcher<ActionResult>();
  const isSubmitting = fetcher.state !== "idle";
  useActionToast(fetcher);

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <p className="text-sm font-medium">{refund.learnerName}</p>
        <p className="text-xs text-muted-foreground">{refund.learnerEmail}</p>
      </td>
      <td className="px-4 py-3 text-sm">{refund.courseTitle}</td>
      <td className="px-4 py-3 text-sm font-medium">
        {formatPrice(refund.amount)}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatDate(refund.approvedAt)}
      </td>
      <td className="px-4 py-3">
        {refund.status === RefundStatus.Failed ? (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
            Failed {formatDate(refund.failedAt)}
          </span>
        ) : (
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
            Pending
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <fetcher.Form method="post" className="flex gap-2">
          <input type="hidden" name="refundId" value={refund.id} />
          <Button
            type="submit"
            name="intent"
            value="mark-issued"
            size="sm"
            className="h-7 text-xs"
            disabled={isSubmitting}
          >
            Mark issued
          </Button>
          {refund.status === RefundStatus.Pending && (
            <Button
              type="submit"
              name="intent"
              value="mark-failed"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={isSubmitting}
            >
              Mark failed
            </Button>
          )}
        </fetcher.Form>
      </td>
    </tr>
  );
}

function TableHead({ columns }: { columns: string[] }) {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/50">
        {columns.map((column) => (
          <th
            key={column}
            className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-8 text-center">
        <Undo2 className="mx-auto mb-3 size-8 text-muted-foreground/50" />
        <p className="text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { openRequests, unsentRefunds, decidedRequests } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refunds</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refunds</h1>
        <p className="mt-1 text-muted-foreground">
          Decide refund requests, then record when the money has gone back
        </p>
      </div>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">
            Open requests ({openRequests.length})
          </TabsTrigger>
          <TabsTrigger value="unsent">
            Pending refunds ({unsentRefunds.length})
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-6 space-y-4">
          {openRequests.length === 0 ? (
            <EmptyState message="No refund requests are waiting on a decision." />
          ) : (
            openRequests.map((request) => (
              <OpenRequestCard key={request.id} request={request} />
            ))
          )}
        </TabsContent>

        <TabsContent value="unsent" className="mt-6">
          {unsentRefunds.length === 0 ? (
            <EmptyState message="Every approved refund has been sent." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead
                      columns={[
                        "Learner",
                        "Course",
                        "Amount",
                        "Approved",
                        "State",
                        "Actions",
                      ]}
                    />
                    <tbody>
                      {unsentRefunds.map((refund) => (
                        <UnsentRefundRow key={refund.id} refund={refund} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          {decidedRequests.length === 0 ? (
            <EmptyState message="No refund requests have been decided yet." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead
                      columns={[
                        "Learner",
                        "Course",
                        "Amount",
                        "Decided",
                        "Outcome",
                        "Reasons",
                      ]}
                    />
                    <tbody>
                      {decidedRequests.map((request) => (
                        <tr
                          key={request.id}
                          className="border-b border-border align-top last:border-0"
                        >
                          <td className="px-4 py-3 text-sm font-medium">
                            {request.learnerName}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {request.courseTitle}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {formatPrice(request.amountPaid)}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">
                            {formatDate(request.decidedAt)}
                            {request.decidedByName && (
                              <p className="text-xs">
                                by {request.decidedByName}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <RefundStatusBadge
                              status={request.status}
                              refundStatus={request.refundStatus}
                              audience="admin"
                            />
                          </td>
                          <td className="max-w-sm px-4 py-3 text-sm">
                            <p className="text-muted-foreground">
                              {request.reason}
                            </p>
                            {request.declineReason && (
                              <p className="mt-1">
                                <span className="font-medium">Declined: </span>
                                {request.declineReason}
                              </p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refunds.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else if (error.status === 409) {
      title = "Already done";
      message = typeof error.data === "string" ? error.data : error.statusText;
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/admin/refunds">
            <Button variant="outline">Back to refunds</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
