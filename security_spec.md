# MiniSketch Security Rules Specification (Phase 0)

## 1. Roles & Authentication Model
- **Unauthenticated / Local Guest**:
  - Full offline/local MiniSketch usage via `localStorage` & `IndexedDB` (zero Firestore access required).
  - Read-only access to public `marketplace_extensions` catalog when online.
- **Authenticated User (`request.auth != null && request.auth.token.email_verified == true`)**:
  - Full read/write ownership over `/users/{userId}` and its subcollections (`sync_docs`, `extensions`, `sketches`, `chat_sessions`), strictly when `request.auth.uid == userId`.
  - Can publish new extensions to `/marketplace_extensions/{extId}` with `authorUid == request.auth.uid`.
  - Can update/delete ONLY `/marketplace_extensions/{extId}` documents where existing `resource.data.authorUid == request.auth.uid`.

## 2. Core Invariants
1. **Fail-Closed Catch-All**: `match /{document=**} { allow read, write: if false; }`.
2. **PII Isolation**: User email, displayName, photoURL exist strictly in `/users/{userId}` readable/writable ONLY by `isOwner(userId)`. Public `marketplace_extensions` stores only public author display alias and `authorUid`.
3. **Immutable Ownership & Timestamps**:
   - `uid`, `id`, `authorUid`, and `createdAt` cannot be modified after creation.
   - `createdAt == request.time` on create; `updatedAt == request.time` on create & update.
4. **Strict Schema Enforcement**:
   - Required fields checked with `keys().hasAll(...)` and bounded allowed keys via `keys().hasOnly(...)` on create, and `diff().affectedKeys().hasOnly(...)` on update.
   - String and list length limits on every text/code/array field.
5. **Email Verification Required**:
   - Every authenticated write requires `request.auth.token.email_verified == true`.
6. **Marketplace Anti-Hijack**:
   - User A cannot create a marketplace extension pretending `authorUid = User B`, nor overwrite/delete User B's extension.

## 3. Dirty Dozen Attack Vectors Audited
- Unauthenticated write to `/users/*` or `/marketplace_extensions/*`.
- Cross-tenant read/write (`/users/otherUid/...`).
- Spoofed `authorUid` on marketplace create or update.
- Mass-assignment of arbitrary fields or overwriting `createdAt`.
- Unbounded code/title/array sizes (>220KB code, >200 messages, >128 char IDs).
- Path traversal / invalid IDs containing `/` or spaces (`isValidId`).
- Missing `email_verified` claim on write requests.
- Unlisted subcollections or wildcard leaks.
