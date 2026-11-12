# Which notification services fit Cadence?

Research for [#11](https://github.com/debora-clicksign/cohort-005-project/issues/11), part of [Map: Notifications in Cadence (#10)](https://github.com/debora-clicksign/cohort-005-project/issues/10).

Compares Knock, Novu, Courier, MagicBell and SuprSend against Cadence's criteria. It is a comparison for the service decision to rely on, not a pick. Facts were checked against each vendor's own pricing pages, docs and npm registry entries on 2026-11-12; pricing and package versions change, so re-check them before deciding.

"Notification" follows `GLOSSARY.md`: a message Cadence shows a person inside the app. Email is a separate channel that a service may also deliver.

## Summary

| | Knock | Novu | Courier | MagicBell | SuprSend |
| --- | --- | --- | --- | --- | --- |
| Free tier | 10,000 messages/mo | 10,000 workflow runs/mo, 5 workflows | 10,000 sends/mo | 1,000 deliveries/mo, 1 project | 10,000 notifications/mo |
| How usage is counted | Per recipient per channel | Per workflow run | Per recipient per template, all channels count as one | Per recipient per channel | Per recipient per channel |
| Prebuilt React feed | Yes | Yes | Yes | Yes | Yes |
| Headless React | Hooks in the same package | Hooks in the same package | Custom UI on the SDK datastore | No hooks in `@magicbell/react`; use `magicbell-js` | Hooks in `@suprsend/react-core` |
| Postmark as email provider | Yes | Yes | Yes | Not listed; SMTP only (unconfirmed for Postmark) | Yes |
| Push, SMS, Slack | All three | All three | All three | All three | All three |
| Node SDK | `@knocklabs/node` | `@novu/api` | `@trycourier/courier` | `magicbell-js` | `@suprsend/node-sdk` |
| Recipient ID | Your user ID | Your user ID (`subscriberId`) | Your user ID | Your user ID or email | Your user ID (`distinct_id`) |
| Client auth | RS256 JWT signed on your server (optional in dev) | HMAC of the ID (optional in dev) | JWT issued by Courier's API call | HS256 JWT signed on your server | ES256 JWT signed on your server (optional in dev) |
| Real-time feed | WebSocket | WebSocket | WebSocket | WebSocket | WebSocket |
| Run without the live service | No; sandbox mode and separate environments | Yes, self-hosted with Docker Compose (open source) | No; Test environment | Nothing found | Self-hosting is Enterprise-only; Sandbox and Staging workspaces plus Test Mode |

Every option still needs a Cadence-side seam for unit tests: the service is called through an injected client, the way `app/lib/mailer.server.ts` takes a `MailTransport` and falls back to `.outbox/` without a token. None of the five ships an official in-process mock of its Node SDK that I could find.

## 1. Free tier that covers development

- **Knock**: Free plan is $0 with up to 10,000 messages sent a month, unlimited workflows, channels, team members and environments. A message is "a single message delivered to a single user on a single channel", so one in-app Notification plus one email counts as two. There is no hard cap over the limit. Batching/digests, preferences and end-to-end testing are on Free. The free feed shows Knock branding. [knock.app/pricing](https://knock.app/pricing)
- **Novu**: Free plan is $0 with 10,000 workflow runs a month, up to 5 workflows, 2 environments (Dev and Prod), 24-hour activity feed retention, up to 3 team members, and all channels. Branding can only be removed on a paid plan. [novu.co/pricing](https://novu.co/pricing), [Prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production)
- **Courier**: Developer plan is free with 10,000 sends a month. "One send is one template sent to one recipient", and a template that goes to email, SMS, push, Slack and in-app "still counts as one send". Sends from Test and custom environments count the same as Production. [courier.com/pricing](https://www.courier.com/pricing)
- **MagicBell**: Builder plan is $0 with 1,000 deliveries a month, 1 project, all integrations and unlimited users. Deliveries count every channel a user receives a notification on. The next tier is Startup at $249/month. [magicbell.com/pricing](https://www.magicbell.com/pricing)
- **SuprSend**: Free plan is $0 with 10,000 notifications a month. Each channel counts separately, and the in-app feed carries SuprSend branding. All features are unlocked for a 30-day trial, then the account drops to Free. **Batching & Digest and User Preferences are listed under Business ($250/month)**, not Free, which matters for map #10's open questions on preferences and grouping. [suprsend.com/pricing](https://www.suprsend.com/pricing)

## 2. Prebuilt React feed and headless option

Cadence runs React 19 (`package.json`). All five React packages accept React 19 in their peer dependencies, except MagicBell, which declares no React peer dependency at all (checked with `npm view <pkg> peerDependencies`).

- **Knock**: `@knocklabs/react` (v0.15.1) ships `NotificationFeedPopover`, `NotificationFeed` and `NotificationIconButton`, plus "a complete set of React hooks" for headless UI from the same package. Its `next` and `@tanstack/react-router` peer dependencies are marked optional. [React overview](https://docs.knock.app/in-app-ui/react/overview)
- **Novu**: `@novu/react` (v3.19.2) ships a composable `<Inbox />` made of Bell, Notifications, InboxContent and Preferences. Headless mode uses `useNotifications`, `useCounts` and `useNovu` from the same package; `@novu/js` is the framework-agnostic option. [Inbox overview](https://docs.novu.co/platform/inbox/overview), [Headless mode](https://docs.novu.co/platform/inbox/headless-mode)
- **Courier**: `@trycourier/courier-react` (v9.3.5) ships `CourierInbox` and toasts. A custom UI can either swap parts of the built-in inbox or be built on the low-level APIs. The older `@trycourier/react-inbox` packages are deprecated. [In-app overview](https://www.courier.com/docs/platform/inbox/inbox-overview), [Inbox runtime behavior](https://www.courier.com/docs/in-app/how-the-inbox-behaves)
- **MagicBell**: `@magicbell/react` (v1.14.0) ships `ContextProvider`, `FloatingInbox`, `Inbox`, `InlineNotification`, `UserPreferences` and toasts. Its exports contain no hooks. For headless UI, `magicbell-js` provides a `UserClient` and a WebSocket `Realtime` client. A separate `@magicbell/react-headless` (v5.5.1, "Hooks to build a notification inbox") exists on npm, but the current docs don't mention it. [React components](https://www.magicbell.com/docs/libraries/react), [Browser/Node client](https://www.magicbell.com/docs/libraries/magicbell-js)
- **SuprSend**: `@suprsend/react` (v1.5.0) ships drop-in components. Headless uses `SuprSendProvider`, `SuprSendFeedProvider`, `useFeedClient` and `useFeedData` from `@suprsend/react-core`. The older `@suprsend/react-inbox` has reached end of support. `@suprsend/react` pulls in Emotion and `react-markdown` 6 as dependencies. [React inbox overview](https://docs.suprsend.com/docs/inbox-react), [Headless feed](https://docs.suprsend.com/docs/react-sdk-headless-feed)

## 3. Email and other channels

Cadence already sends email through Postmark. All five are orchestration layers: you bring your own provider account and keep paying for it ([Knock FAQ](https://knock.app/pricing), [SuprSend FAQ](https://www.suprsend.com/pricing)). If email moved into the service, Postmark would be configured as the service's provider rather than called from `mailer.server.ts`.

- **Knock**: has a Postmark integration ([docs](https://docs.knock.app/integrations/email/postmark)). Delivery channels are unlimited on every plan, including SMS, push and Slack/Teams ([pricing](https://knock.app/pricing), [React overview](https://docs.knock.app/in-app-ui/react/overview) for SlackKit and TeamsKit).
- **Novu**: has a Postmark integration ([docs](https://docs.novu.co/platform/integrations/email/postmark)). The Free plan covers email, in-app, SMS, chat and push ([pricing](https://novu.co/pricing)).
- **Courier**: has a Postmark integration that supports overriding `MessageStream` ([docs](https://www.courier.com/docs/integrations/email/postmark)). Channels are email, SMS, push, Slack and MS Teams, and in-app, with no per-channel fees ([pricing](https://www.courier.com/pricing)).
- **MagicBell**: lists Mailgun, Ping Email, SendGrid, SES and SMTP as email providers, but **not Postmark** ([docs navigation](https://www.magicbell.com/docs), [SMTP provider](https://www.magicbell.com/docs/channels/email/smtp)). Postmark accepts SMTP, so the SMTP provider would likely work, but I didn't test it. Other channels are mobile push (APNs, FCM, Expo), web push, Slack, Teams and SMS through Twilio.
- **SuprSend**: has a Postmark integration ([docs](https://docs.suprsend.com/docs/postmark)). Channels include email, SMS, WhatsApp, mobile and web push, Slack, MS Teams, in-app and webhook ([pricing](https://www.suprsend.com/pricing)).

## 4. Node SDK for a React Router v8 SSR server

Cadence's server is `@react-router/node` 8.3.0. Every SDK below is a plain HTTP client that ships TypeScript types and can be called from a loader or action. None is tied to Next.js.

- **Knock**: `@knocklabs/node` (v1.41.1). It includes `signUserToken` for the client JWT ([security docs](https://docs.knock.app/in-app-ui/security-and-authentication)). The feed can also be read server-side with `GET /v1/users/{user_id}/feeds/{id}` using the secret key, which would let a loader render the first page of Notifications ([API reference](https://docs.knock.app/api-reference/users/feeds/list_items)).
- **Novu**: `@novu/api` (v3.19.1). `@novu/node` is deprecated ("March 20, 2025 marks the end of support", per its npm `deprecated` field). Novu also offers `@novu/framework` for workflows defined in code, which needs a "bridge" HTTP endpoint in your app; there's a Remix quickstart, the closest to React Router framework mode ([Framework Remix quickstart](https://docs.novu.co/framework/quickstart/remix), [Local development](https://docs.novu.co/framework/studio)). Dashboard-built workflows don't need the bridge.
- **Courier**: `@trycourier/courier` (v10.0.0). Needs Node.js 20+ and TypeScript 4.9+; it also runs on Deno, Bun and edge runtimes ([Node SDK](https://www.courier.com/docs/sdk-libraries/node)).
- **MagicBell**: `magicbell-js` (v1.8.0) exports `project-client`, `user-client` and `realtime` as ESM and CommonJS with types ([docs](https://www.magicbell.com/docs/libraries/magicbell-js)).
- **SuprSend**: `@suprsend/node-sdk` (v1.15.1, with types). It is initialised with a workspace key and secret, and the docs show CommonJS `require` ([Node SDK](https://docs.suprsend.com/docs/integrate-node-sdk)).

## 5. How recipients are identified (and the DevUI)

All five identify a recipient by an ID that Cadence chooses, and recommend using the app's own user ID. The browser component gets that ID plus a server-made credential that proves it.

- **Knock**: user `id`. With **enhanced security mode off (the default)**, the public key alone can act as any user, which is convenient in development. With it on, the server signs an RS256 JWT with `sub` = user ID, using `signUserToken` and `KNOCK_SIGNING_KEY`. Calling `authenticate` again restarts the real-time connection. If a user has never been identified in Knock, their feed comes back empty. [Security](https://docs.knock.app/in-app-ui/security-and-authentication), [feed API](https://docs.knock.app/api-reference/users/feeds/list_items)
- **Novu**: `subscriberId`. The server computes `HMAC-SHA256(secretKey, subscriberId)` and passes it as `subscriberHash`. HMAC is enabled with a dashboard toggle; without it, anyone who guesses an ID can read that feed. Subscribers are created on the fly at trigger time or on the first Inbox session. [Prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production), [Subscribers](https://docs.novu.co/platform/concepts/subscribers)
- **Courier**: `userId`. The server calls Courier's Issue Token API (`client.auth.issueToken`) with a scope such as `user_id:<id> inbox:read:messages inbox:write:events`. **That is a network round-trip to Courier for each token**, where the other four sign locally. Omitting `expires_in` mints a token that never expires. Signing in registers the user, and the SDKs don't refresh tokens themselves. [Authentication](https://www.courier.com/docs/platform/inbox/authentication)
- **MagicBell**: `user_external_id` or `user_email` in an HS256 JWT, signed on the server with the project's secret key. The docs don't describe an unauthenticated dev mode. [User JWT](https://www.magicbell.com/docs/api/authentication/user)
- **SuprSend**: `distinct_id`. With enhanced security mode on, the server signs an ES256 JWT with `entity_type: "subscriber"` and `entity_id`. `identify` takes a `refreshUserToken` callback. [Client authentication](https://docs.suprsend.com/docs/client-authentication)

**What this means for Cadence's DevUI.** The DevUI's "Switch user" is a `<Form method="post">` to `/api/switch-user`. That route sets the session cookie and redirects (`app/components/dev-ui.tsx`, `app/routes/api.switch-user.ts`), so loaders run again and can pass the new user's ID and token to the provider. Two things the docs don't settle:

- Whether each React provider tears down and re-authenticates when its user prop changes, or whether it has to be remounted (for example with `key={user.id}`). Knock says calling `authenticate` again restarts the connection, and Courier says to call `signIn` again when the user changes. I didn't verify the prop-change behaviour of the React providers for any of the five.
- Cadence user IDs are auto-increment integers (`app/db/schema.ts`), so every developer's seeded database has a user `1`. If several developers share one development environment in the service, their Notifications would land in the same feeds. Options are an environment per developer (Knock: unlimited environments; Novu Free: 2; SuprSend: custom workspaces; MagicBell Free: 1 project) or prefixing recipient IDs.

## 6. Real-time updates or fetch on page load

All five push new Notifications to the open page over a WebSocket that the client SDK manages. None depends on polling.

- **Knock**: managed WebSocket that emits `new-message` with badge counts, not the full message, and "might be throttled". Options cover auto-disconnect for inactive tabs and syncing feeds across browser tabs. [In-app API](https://docs.knock.app/in-app-ui/api-overview), [Socket behavior](https://docs.knock.app/in-app-ui/feeds/socket-behavior)
- **Novu**: real-time unread count and updates; the self-hosted socket defaults to port 3002 (`socketUrl`). [Inbox overview](https://docs.novu.co/platform/inbox/overview), [Deploy with Docker](https://docs.novu.co/community/self-hosting-novu/deploy-with-docker)
- **Courier**: real-time connection opens on sign-in using the same JWT; read and archive states sync across devices. [Inbox runtime behavior](https://www.courier.com/docs/in-app/how-the-inbox-behaves)
- **MagicBell**: persistent WebSocket connection, also available on its own as `magicbell-js/realtime`. [In-app channel](https://www.magicbell.com/docs/channels/in_app), [JS client](https://www.magicbell.com/docs/libraries/magicbell-js)
- **SuprSend**: feed socket; an optional `reachability` state reports socket and API health. [Headless feed](https://docs.suprsend.com/docs/react-sdk-headless-feed)

On rendering the feed during SSR: the components are browser-side and open sockets. I confirmed a server-side feed read only for Knock. For the other four, I didn't check whether a loader can fetch a user's Notifications with the secret key.

## 7. Running locally or in tests without the live service

- **Knock**: no self-hosting or local emulator. What it offers instead: unlimited isolated environments; **sandbox mode** per channel, which generates and records messages without delivering them; `settings.sandbox_mode` and `settings.skip_delay` on an API trigger for programmatic tests; and a built-in test email channel limited to 100 emails a month to Knock account members. Every call still goes to Knock's servers. [Testing workflows](https://docs.knock.app/send-notifications/testing-workflows), [Knock test email](https://docs.knock.app/integrations/email/knock-test)
- **Novu**: open source, with a **Community Self-Hosted** edition run via Docker Compose (API, worker, dashboard, WebSocket service, MongoDB, Redis). It lacks some Cloud features: no branding removal, no snooze, 1 team member, no custom environments, no email activity tracking. `npx novu dev` (Local mode) still runs through Novu Cloud via a tunnel, so it is not offline. [Self-hosted vs Cloud](https://docs.novu.co/community/self-hosted-and-novu-cloud), [Deploy with Docker](https://docs.novu.co/community/self-hosting-novu/deploy-with-docker), [Local development](https://docs.novu.co/framework/studio)
- **Courier**: no self-hosting found. A Test environment has its own keys; the inbox and email work in Test with no provider connected. Test sends count against the 10,000 free sends. [Send your first in-app message](https://www.courier.com/docs/guides/send-your-first-in-app-message), [pricing](https://www.courier.com/pricing)
- **MagicBell**: I found no self-hosting, emulator, sandbox mode or test environment in the docs. The Free plan has one project, so development and production can't be separated without paying ($99 per extra project on Startup). [pricing](https://www.magicbell.com/pricing)
- **SuprSend**: self-hosted and Bring Your Own Cloud are **Enterprise-only** and run on Kubernetes with Helm plus PostgreSQL, Redis, NATS, ClickHouse, OpenSearch and Temporal. That is not a practical local-dev option. Every account gets Sandbox, Staging and Production workspaces. Sandbox only sends email, SMS and WhatsApp to up to 5 verified addresses per channel type. Staging supports **Test Mode**, which blocks or diverts email, SMS and WhatsApp to testers or a catch-all address. [Workspaces](https://docs.suprsend.com/docs/workspaces), [Test Mode](https://docs.suprsend.com/docs/developer/test-mode), [Self-hosted](https://docs.suprsend.com/docs/self-hosted/introduction), [pricing](https://www.suprsend.com/pricing)

## Unconfirmed or open

- **MagicBell with Postmark**: Postmark isn't a listed provider; the SMTP route is inferred, not tested.
- **MagicBell headless**: it's unclear whether `@magicbell/react-headless` is meant to be used with the current `@magicbell/react` and v2 API; the current docs only describe `magicbell-js` for custom UI.
- **MagicBell's React peer dependency**: `@magicbell/react` declares no React peer dependency, so React 19 support is assumed from its use of hooks, not stated.
- **Novu Free feature gating**: the pricing comparison table rendered without values, so I couldn't confirm whether digest, preferences and headless hooks are on Free. The plan cards list Inbox and all channels on Free.
- **Courier digest and batching per plan**: the pricing page lists "Digest & batching" in the platform rows without a per-plan value.
- **Provider behaviour on user switch**: whether each React provider re-authenticates when its user prop changes (see section 5).
- **Server-side feed reads for SSR**: confirmed for Knock only.
- **Inline recipient creation at trigger time**: documented for Novu; I didn't check it for Knock, Courier, MagicBell or SuprSend. They may require an identify or upsert call before the first trigger.
- **SSR safety of the components**: none of the docs I read covered rendering the components during server render under React Router. Assume they need to render client-only until tested.
