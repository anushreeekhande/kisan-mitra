# Kisan Mitra Firestore Security Specification

## 1. Data Invariants
1. All writes require `request.auth != null` and `request.auth.token.email_verified == true`.
2. PII (`phone`, `email`) is isolated in `/users_private/{userId}` and readable/writable only by the owning user (`request.auth.uid == userId`) or bootstrapped admin.
3. Public non-PII profiles reside in `/users_public/{userId}` and cannot be mutated by non-owners.
4. Uploaded photos in `/uploaded_photos/{photoId}` validate `ownerUid == request.auth.uid`, bounded `photoDataUrl.size() <= 750000`, and server timestamp `capturedAt == request.time`.
5. Orders in `/orders/{orderId}` restrict list queries (`resource.data.ownerUid == request.auth.uid || isAdmin()`) and prevent updates once status reaches a terminal state (`delivered` or `cancelled`), unless admin.
6. Price alerts in `/price_alerts/{alertId}` are strictly owned and list-restricted to `resource.data.ownerUid == request.auth.uid`.
7. Document IDs are validated with `isValidId()` (`^[a-zA-Z0-9_\\-]+$`, max 128 chars).

## 2. Adversarial Payloads Blocked
1. Unauthenticated read of `/users_private/{userId}` -> DENIED
2. Non-owner read of `/users_private/{otherUserId}` -> DENIED
3. Spoofed `ownerUid` in `/listings/{listingId}` create -> DENIED
4. Unverified email user writing to `/orders/{orderId}` -> DENIED
5. Shadow field injection (`isAdmin: true`) in `/users_public/{userId}` -> DENIED
6. Oversized >1MB `photoDataUrl` payload in `/uploaded_photos/{photoId}` -> DENIED
7. Invalid document ID containing path traversal or >128 chars -> DENIED
8. Blanket list query on `/orders` without `ownerUid == request.auth.uid` -> DENIED
9. Updating immutable `createdAt` or `ownerUid` on `/orders/{orderId}` -> DENIED
10. Modifying a terminal `delivered` or `cancelled` order as non-admin -> DENIED
11. Client-forged timestamp (`updatedAt != request.time`) -> DENIED
12. Deleting another user's `/price_alerts/{alertId}` -> DENIED
