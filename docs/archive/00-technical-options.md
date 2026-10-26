# Technical Options

## Current Status

The MVP technical stack has been selected.

The existing internal system uses:

- Firebase database
- React Native
- Node.js
- Multiple external API integrations

However, Foldy can be designed separately because the existing system has a different focus: price updates, occupancy, sales, inventory-related operations, and automation.

The existing stack should be considered as context, not as a constraint.

## App Options

### PWA First

Pros:

- Can start without Apple Developer account
- Can start without Google Play Console account
- Works on desktop, iPhone, and Android through browser/home screen
- Fits admin web and mobile field app in one web-based product
- Faster and cheaper for internal MVP

Cons:

- iPhone push notifications require iOS 16.4+ and adding the PWA to the Home Screen
- Native camera/notification/background behavior may be less reliable than a native app
- Some users may need installation guidance

Best fit:

- Internal free/low-cost MVP before public store release

### React Native + Expo

Pros:

- Fast development
- Good for iOS and Android
- Strong ecosystem
- Easier push notification setup
- Good fit for MVP
- Aligns well with the company's existing React Native experience

Cons:

- Native edge cases may require extra work
- Some advanced native features may need custom modules

### Flutter

Pros:

- Strong cross-platform UI consistency
- Good performance
- Good for polished native-like apps

Cons:

- Different ecosystem and language
- Team must be comfortable with Dart

### Fully Native

Pros:

- Best platform-specific control
- Strong long-term performance

Cons:

- More expensive
- Slower to build
- Requires separate iOS and Android development

## Web App Options

### Next.js

Pros:

- Strong fit for admin dashboards
- React-based
- Good routing and server-side capabilities
- Works well with Supabase, Firebase, and Node.js APIs

Cons:

- Adds a separate web app surface to maintain

### React + Vite

Pros:

- Simple and fast
- Good for internal admin tools

Cons:

- More architecture decisions must be made manually
- Less full-stack structure than Next.js

## Backend Options

### Supabase

Pros:

- Free tier available
- PostgreSQL
- Authentication
- Storage
- Realtime support
- Good for structured operational data

Cons:

- Requires careful permission and row-level security design

### Firebase

Pros:

- Free tier available
- Authentication
- Push notification ecosystem
- Realtime data
- Mature mobile support
- Already used by the existing internal system

Cons:

- NoSQL data modeling can become complex for reporting
- Vendor lock-in concerns
- Complex role-based operational data may require careful denormalization

### Custom Backend

Pros:

- Full control
- Easier to model custom business logic

Cons:

- More setup
- More maintenance
- Higher initial cost

## Early Recommendation

Not final. Current practical candidates:

### Candidate A: React Native + Expo + Supabase

Stack:

- React Native / Expo for the native app
- Next.js or React web app for admin
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage
- Node.js or serverless functions for Beds24 integration
- FCM/Expo push notifications

Why this may fit Foldy:

- Free-start friendly
- Fast MVP development
- Good multilingual app support
- PostgreSQL fits structured hotel operations data
- Easier relational modeling for properties, rooms, bookings, tasks, inventory, schedules, roles, and reports
- Easier future admin dashboard and analytics

Risks:

- Less reuse of existing Firebase infrastructure
- Supabase row-level security must be designed carefully

### Candidate B: React Native + Expo + Firebase

Stack:

- React Native / Expo for the native app
- Next.js or React web app for admin
- Firebase Auth
- Firestore
- Firebase Storage
- Cloud Functions / Node.js
- FCM push notifications

Why this may fit Foldy:

- Free-start friendly
- Strong mobile ecosystem
- Push notifications fit well
- Existing company familiarity

Risks:

- Firestore data modeling may become harder as relational operational data grows
- Reporting, complex filtering, and joins may require extra design

### Candidate C: Flutter + Supabase

Stack:

- Flutter
- Supabase
- PostgreSQL

Why this may fit Foldy:

- Strong cross-platform UI consistency
- Good long-term app polish
- Structured backend

Risks:

- Requires Dart/Flutter expertise
- May slow early development if the team is more familiar with JavaScript/TypeScript

## Current Lean

Confirmed MVP stack:

- Next.js App Router
- TypeScript
- PWA-first mobile field app and admin web
- Tailwind CSS v4
- shadcn/ui + Radix UI
- Lucide Icons
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage
- Supabase Row Level Security
- Vercel deployment
- Web Push and in-app notification center
- Beds24 webhook integration
- React Hook Form
- Zod
- TanStack Query
- TanStack Table
- ExcelJS
- Localized print-ready HTML reports with browser Print / Save as PDF; no dedicated PDF library in the current stack

Reason:

- Foldy has many relational entities: companies, properties, rooms, bookings, tasks, schedules, inventory, announcements, comments, roles, and notifications.
- Supabase/PostgreSQL may fit this operational model better than a pure NoSQL design.
- PWA-first avoids immediate Apple Developer and Google Play Console requirements.
- Next.js gives both mobile web/PWA and admin web a strong foundation.
- Multi-tenant company/workspace separation is easier to enforce with relational schema and row-level security when designed carefully.

Later native option:

- React Native + Expo can be added later when the company is ready for Apple Developer / Google Play setup and store/internal native app distribution.

## Technical Decisions Still Needed

- App framework
- Backend platform
- Database
- Authentication method
- Email authentication
- Google OAuth
- Apple Sign-In support
- Push notification architecture
- File storage for photos
- Admin web dashboard timing
- Offline support level
- Audit log strategy
- Whether to integrate with the existing internal system at all
- Whether Foldy should use Supabase or Firebase
- Whether Foldy needs a separate admin web app from the beginning
- Whether admin web should use Next.js or a simpler React/Vite setup
