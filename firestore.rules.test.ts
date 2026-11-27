/**
 * Security Rules Behavioral Assertion Matrix for MiniSketch Firestore
 * Maps directly to /security_spec.md and /firestore.rules invariants.
 * Evaluated against the Firestore Emulator or audited statically during CI.
 */
export interface SecurityAssertionCase {
  name: string;
  actor: 'anonymous' | 'userA_unverified' | 'userA_verified' | 'userB_verified';
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  expected: 'allow' | 'deny';
  note: string;
}

export const SECURITY_ASSERTIONS: SecurityAssertionCase[] = [
  // 1. User Profile PII isolation
  {
    name: 'Anonymous cannot read user profile',
    actor: 'anonymous',
    operation: 'get',
    path: '/users/userA',
    expected: 'deny',
    note: 'Private PII isolation'
  },
  {
    name: 'User B cannot read User A profile',
    actor: 'userB_verified',
    operation: 'get',
    path: '/users/userA',
    expected: 'deny',
    note: 'Cross-tenant read blocked'
  },
  {
    name: 'User A unverified cannot create own profile',
    actor: 'userA_unverified',
    operation: 'create',
    path: '/users/userA',
    expected: 'deny',
    note: 'Requires email_verified == true'
  },
  {
    name: 'User A verified can create & update own profile with server timestamps',
    actor: 'userA_verified',
    operation: 'create',
    path: '/users/userA',
    expected: 'allow',
    note: 'Owner with uid == userA and createdAt == request.time'
  },
  // 2. Private User Sync Collections (preferences, extensions, sketches, chat_sessions)
  {
    name: 'User B cannot read User A sketches',
    actor: 'userB_verified',
    operation: 'list',
    path: '/users/userA/sketches',
    expected: 'deny',
    note: 'Cross-tenant subcollection read blocked'
  },
  {
    name: 'User B cannot write User A extensions',
    actor: 'userB_verified',
    operation: 'create',
    path: '/users/userA/extensions/coaster-maker',
    expected: 'deny',
    note: 'Cross-tenant subcollection write blocked'
  },
  {
    name: 'User A cannot create unknown docId in sync_docs',
    actor: 'userA_verified',
    operation: 'create',
    path: '/users/userA/sync_docs/arbitrary',
    expected: 'deny',
    note: 'sync_docs restricted to docId == preferences'
  },
  // 3. Community Marketplace Ownership
  {
    name: 'Anyone can read marketplace catalog',
    actor: 'anonymous',
    operation: 'list',
    path: '/marketplace_extensions',
    expected: 'allow',
    note: 'Public read-only catalog for offline/online guests'
  },
  {
    name: 'Anonymous cannot publish to marketplace',
    actor: 'anonymous',
    operation: 'create',
    path: '/marketplace_extensions/my-tool',
    expected: 'deny',
    note: 'Publishing requires Google verified account'
  },
  {
    name: 'User A cannot spoof authorUid as User B on publish',
    actor: 'userA_verified',
    operation: 'create',
    path: '/marketplace_extensions/spoof-tool',
    expected: 'deny',
    note: 'authorUid must equal request.auth.uid'
  },
  {
    name: 'User B cannot update User A marketplace extension',
    actor: 'userB_verified',
    operation: 'update',
    path: '/marketplace_extensions/usera-tool',
    expected: 'deny',
    note: 'Existing resource.data.authorUid == request.auth.uid enforced'
  },
  {
    name: 'User B cannot delete User A marketplace extension',
    actor: 'userB_verified',
    operation: 'delete',
    path: '/marketplace_extensions/usera-tool',
    expected: 'deny',
    note: 'Owner-only delete enforced'
  },
  {
    name: 'User A can update own marketplace extension without mutating authorUid or createdAt',
    actor: 'userA_verified',
    operation: 'update',
    path: '/marketplace_extensions/usera-tool',
    expected: 'allow',
    note: 'Creator ownership verified'
  },
  // 4. Catch-All Fail-Closed Rule
  {
    name: 'Arbitrary root collection read/write denied',
    actor: 'userA_verified',
    operation: 'get',
    path: '/admin_logs/latest',
    expected: 'deny',
    note: 'Explicit catch-all deny rule'
  }
];
