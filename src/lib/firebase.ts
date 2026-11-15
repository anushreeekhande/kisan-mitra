import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type ConfirmationResult,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { Order, PriceAlert, ProduceListing, User } from '../types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;
export const ADMIN_EMAIL = 'anushreeekhande@gmail.com';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export function subscribeFirebaseAuth(cb: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, cb);
}

export async function signInWithGoogleFirebase(forceAccountSelect = false): Promise<FirebaseUser> {
  const provider = forceAccountSelect
    ? (() => {
        const p = new GoogleAuthProvider();
        p.setCustomParameters({ prompt: 'select_account' });
        return p;
      })()
    : googleProvider;
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Google Sign-In popup was closed before completing authentication.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('Popup was blocked by the browser. Please allow popups for this site and try again.');
    }
    throw err;
  }
}

export async function signOutFirebase(): Promise<void> {
  await firebaseSignOut(auth);
}

let activeRecaptchaVerifier: RecaptchaVerifier | null = null;

function clearRecaptchaVerifier() {
  if (activeRecaptchaVerifier) {
    try {
      activeRecaptchaVerifier.clear();
    } catch {
      // ignore cleanup error
    }
    activeRecaptchaVerifier = null;
  }
}

export type FirebaseConfirmationResult = ConfirmationResult;

export async function sendFirebaseSmsOtp(
  phone10: string,
  containerId: string
): Promise<ConfirmationResult> {
  const clean10 = phone10.replace(/\D/g, '').slice(-10);
  if (clean10.length !== 10) {
    throw new Error('Please enter a valid 10-digit Indian mobile number.');
  }
  const phoneE164 = `+91${clean10}`;

  clearRecaptchaVerifier();
  const containerEl = document.getElementById(containerId);
  if (containerEl) {
    containerEl.innerHTML = '';
  }

  try {
    activeRecaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      size: 'invisible',
    });
    const confirmation = await signInWithPhoneNumber(auth, phoneE164, activeRecaptchaVerifier);
    return confirmation;
  } catch (err: unknown) {
    clearRecaptchaVerifier();
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/operation-not-allowed') {
      throw new Error(
        'Firebase Phone Authentication is not enabled yet in Firebase Console (Authentication → Sign-in method → Phone).'
      );
    }
    if (code === 'auth/billing-not-enabled') {
      throw new Error(
        'Firebase SMS sending requires Phone Auth billing/SMS region enabled in Firebase Console.'
      );
    }
    if (code === 'auth/too-many-requests') {
      throw new Error('Too many SMS OTP requests for this number. Please wait before retrying.');
    }
    if (code === 'auth/invalid-phone-number') {
      throw new Error('Invalid mobile number format. Please enter a 10-digit Indian mobile number.');
    }
    if (code === 'auth/captcha-check-failed' || code === 'auth/invalid-app-credential') {
      throw new Error(
        'reCAPTCHA domain verification failed for Phone Auth. Check Authorized Domains in Firebase Console.'
      );
    }
    throw err;
  }
}

export async function confirmFirebaseSmsOtp(
  confirmation: ConfirmationResult,
  otpCode: string
): Promise<FirebaseUser> {
  const cleanOtp = otpCode.trim();
  if (!/^\d{6}$/.test(cleanOtp)) {
    throw new Error('Please enter the 6-digit SMS OTP sent to your mobile.');
  }
  try {
    const cred = await confirmation.confirm(cleanOtp);
    clearRecaptchaVerifier();
    return cred.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/invalid-verification-code') {
      throw new Error('Invalid 6-digit SMS OTP code. Please check your text message and try again.');
    }
    if (code === 'auth/code-expired') {
      throw new Error('SMS OTP expired. Please request a new OTP.');
    }
    throw err;
  }
}

function isVerifiedFirebaseAccount(fbUser: FirebaseUser): boolean {
  return Boolean(fbUser.emailVerified || fbUser.phoneNumber);
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export async function syncUserProfileToFirestore(appUser: User, fbUser: FirebaseUser) {
  if (!isVerifiedFirebaseAccount(fbUser)) return;
  const profileKey = sanitizeId(`${fbUser.uid}_${appUser.id}`);

  const publicPath = `users_public/${profileKey}`;
  const publicRef = doc(db, 'users_public', profileKey);
  try {
    const snap = await getDoc(publicRef);
    const mutableFields = {
      name: appUser.name.slice(0, 120),
      city: appUser.city.slice(0, 80),
      area: appUser.area.slice(0, 160),
      ...(appUser.farmName ? { farmName: appUser.farmName.slice(0, 160) } : {}),
      ...(appUser.vehicleType ? { vehicleType: appUser.vehicleType.slice(0, 120) } : {}),
      isAvailable: Boolean(appUser.isAvailable),
      ratingAvg: Number(appUser.ratingAvg || 4.8),
      ratingCount: Math.round(Number(appUser.ratingCount || 0)),
      updatedAt: serverTimestamp(),
    };
    if (!snap.exists()) {
      await setDoc(publicRef, {
        uid: fbUser.uid,
        appUserId: appUser.id,
        role: appUser.role,
        ...mutableFields,
      });
    } else {
      await updateDoc(publicRef, mutableFields);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, publicPath);
  }

  const privatePath = `users_private/${profileKey}`;
  const privateRef = doc(db, 'users_private', profileKey);
  try {
    const snap = await getDoc(privateRef);
    const mutablePrivate = {
      phone: appUser.phone.slice(0, 20),
      ...(fbUser.email ? { email: fbUser.email.slice(0, 160) } : {}),
      language: appUser.language || 'en',
      updatedAt: serverTimestamp(),
    };
    if (!snap.exists()) {
      await setDoc(privateRef, {
        uid: fbUser.uid,
        appUserId: appUser.id,
        ...mutablePrivate,
      });
    } else {
      await updateDoc(privateRef, mutablePrivate);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, privatePath);
  }
}

export async function recordSignInToFirestore(
  appUser: User,
  authMethod: 'google' | 'sms_otp',
  fbUser: FirebaseUser
) {
  if (!isVerifiedFirebaseAccount(fbUser)) return;
  const signInId = sanitizeId(`signin_${appUser.role}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const path = `sign_ins/${signInId}`;
  try {
    await setDoc(doc(db, 'sign_ins', signInId), {
      id: signInId,
      ownerUid: fbUser.uid,
      appUserId: appUser.id.slice(0, 128),
      role: appUser.role,
      authMethod,
      name: appUser.name.slice(0, 120),
      ...(fbUser.email ? { email: fbUser.email.slice(0, 160) } : {}),
      ...(appUser.phone ? { phone: appUser.phone.slice(0, 20) } : {}),
      city: appUser.city.slice(0, 80),
      ...(appUser.area ? { area: appUser.area.slice(0, 160) } : {}),
      signedInAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function syncUploadedPhotoToFirestore(
  params: {
    id: string;
    farmerId: string;
    customerId?: string;
    listingId: string;
    photoType: 'listing_batch' | 'preorder_verification';
    photoDataUrl: string;
    note?: string;
  },
  fbUser: FirebaseUser
) {
  if (!isVerifiedFirebaseAccount(fbUser)) return;
  if (!params.photoDataUrl || params.photoDataUrl.length < 10) return;

  const photoId = sanitizeId(params.id);
  const path = `uploaded_photos/${photoId}`;
  const ref = doc(db, 'uploaded_photos', photoId);
  const boundedDataUrl = params.photoDataUrl.slice(0, 740000);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
      id: photoId,
      ownerUid: fbUser.uid,
      farmerId: params.farmerId.slice(0, 128),
      ...(params.customerId ? { customerId: params.customerId.slice(0, 128) } : {}),
      listingId: params.listingId.slice(0, 128),
      photoType: params.photoType,
      photoDataUrl: boundedDataUrl,
      ...(params.note ? { note: params.note.slice(0, 300) } : {}),
      capturedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function syncListingToFirestore(listing: ProduceListing, fbUser: FirebaseUser) {
  if (!isVerifiedFirebaseAccount(fbUser)) return;
  const listingId = sanitizeId(listing.id);
  const path = `listings/${listingId}`;
  const ref = doc(db, 'listings', listingId);

  try {
    const snap = await getDoc(ref);
    const mutableFields = {
      productNameEn: listing.productNameEn.slice(0, 120),
      productNameMr: listing.productNameMr.slice(0, 120),
      variety: listing.variety.slice(0, 120),
      pricePerKg: Number(listing.pricePerKg),
      minOrderKg: Math.max(1, Math.round(Number(listing.minOrderKg))),
      availableKg: Math.max(0, Math.round(Number(listing.availableKg))),
      cancellationCutoffHours: Math.max(1, Math.round(Number(listing.cancellationCutoffHours || 2))),
      livePhotoTimestamp: String(listing.livePhotoTimestamp || new Date().toISOString()).slice(0, 64),
      isActive: Boolean(listing.isActive),
      updatedAt: serverTimestamp(),
    };

    if (!snap.exists()) {
      await setDoc(ref, {
        id: listingId,
        ownerUid: fbUser.uid,
        farmerId: listing.farmerId.slice(0, 128),
        farmerName: (listing.farmerName || 'Verified Farmer').slice(0, 120),
        ...(listing.farmName ? { farmName: listing.farmName.slice(0, 160) } : {}),
        productKey: listing.productKey.slice(0, 80),
        category: listing.category,
        ...mutableFields,
      });
    } else if (snap.data().ownerUid === fbUser.uid) {
      await updateDoc(ref, mutableFields);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }

  if (listing.livePhotoUrl && listing.livePhotoUrl.length >= 10) {
    await syncUploadedPhotoToFirestore(
      {
        id: `batch_${listing.id}_${Date.parse(listing.livePhotoTimestamp) || 1}`,
        farmerId: listing.farmerId,
        listingId: listing.id,
        photoType: 'listing_batch',
        photoDataUrl: listing.livePhotoUrl,
        note: `${listing.productNameEn} (${listing.variety}) — ₹${listing.pricePerKg}/kg`,
      },
      fbUser
    );
  }
}

export async function syncOrderToFirestore(order: Order, fbUser: FirebaseUser) {
  if (!isVerifiedFirebaseAccount(fbUser)) return;
  const orderId = sanitizeId(order.id);
  const path = `orders/${orderId}`;
  const ref = doc(db, 'orders', orderId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: orderId,
        orderCode: order.orderCode.slice(0, 40),
        ownerUid: fbUser.uid,
        customerId: order.customerId.slice(0, 128),
        farmerId: order.farmerId.slice(0, 128),
        listingId: order.listingId.slice(0, 128),
        productNameEn: order.productNameEn.slice(0, 120),
        productNameMr: order.productNameMr.slice(0, 120),
        quantityKg: Math.max(1, Math.round(Number(order.quantityKg))),
        pricePerKg: Number(order.pricePerKg),
        totalAmount: Number(order.totalAmount),
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        status: order.status,
        deliveryCity: order.deliveryCity.slice(0, 80),
        ...(order.ratingScore ? { ratingScore: Math.round(order.ratingScore) } : {}),
        ...(order.deliveryRatingScore
          ? { deliveryRatingScore: Math.round(order.deliveryRatingScore) }
          : {}),
        ...(order.ratingReview ? { ratingReview: order.ratingReview.slice(0, 500) } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existing = snap.data();
      const isTerminal = existing.status === 'delivered' || existing.status === 'cancelled';
      if (!isTerminal && existing.status !== order.status) {
        await updateDoc(ref, { status: order.status, updatedAt: serverTimestamp() });
      }
      if (!isTerminal && existing.paymentStatus !== order.paymentStatus) {
        await updateDoc(ref, {
          paymentStatus: order.paymentStatus,
          updatedAt: serverTimestamp(),
        });
      }
      if (existing.status === 'delivered' && !existing.ratingScore && order.ratingScore) {
        await updateDoc(ref, {
          ratingScore: Math.round(order.ratingScore),
          ...(order.deliveryRatingScore
            ? { deliveryRatingScore: Math.round(order.deliveryRatingScore) }
            : {}),
          ratingReview: (order.ratingReview || '').slice(0, 500),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateOrderStatusInFirestore(
  orderIdRaw: string,
  status: Order['status'],
  fbUser: FirebaseUser
) {
  if (!isVerifiedFirebaseAccount(fbUser)) return;
  const orderId = sanitizeId(orderIdRaw);
  const path = `orders/${orderId}`;
  const ref = doc(db, 'orders', orderId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const existing = snap.data();
    if (existing.status === 'delivered' || existing.status === 'cancelled') return;
    await updateDoc(ref, {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function payOrderInFirestore(orderIdRaw: string, fbUser: FirebaseUser) {
  if (!isVerifiedFirebaseAccount(fbUser)) return;
  const orderId = sanitizeId(orderIdRaw);
  const path = `orders/${orderId}`;
  const ref = doc(db, 'orders', orderId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const existing = snap.data();
    if (existing.status === 'delivered' || existing.status === 'cancelled') return;
    await updateDoc(ref, {
      paymentStatus: 'Paid',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function rateOrderInFirestore(
  orderIdRaw: string,
  ratingScore: number,
  deliveryRatingScore: number,
  ratingReview: string,
  fbUser: FirebaseUser
) {
  if (!isVerifiedFirebaseAccount(fbUser)) return;
  const orderId = sanitizeId(orderIdRaw);
  const path = `orders/${orderId}`;
  const ref = doc(db, 'orders', orderId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const existing = snap.data();
    if (existing.status !== 'delivered' || existing.ratingScore) return;
    await updateDoc(ref, {
      ratingScore: Math.min(5, Math.max(1, Math.round(ratingScore))),
      deliveryRatingScore: Math.min(5, Math.max(1, Math.round(deliveryRatingScore))),
      ratingReview: ratingReview.slice(0, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function syncPriceAlertToFirestore(alert: PriceAlert, fbUser: FirebaseUser) {
  if (!isVerifiedFirebaseAccount(fbUser)) return;
  const alertId = sanitizeId(alert.id);
  const path = `price_alerts/${alertId}`;
  const ref = doc(db, 'price_alerts', alertId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
      id: alertId,
      ownerUid: fbUser.uid,
      customerId: alert.customerId.slice(0, 128),
      productKey: alert.productKey.slice(0, 80),
      productNameEn: alert.productNameEn.slice(0, 120),
      city: alert.city.slice(0, 80),
      targetPricePerKg: Number(alert.targetPricePerKg),
      isActive: Boolean(alert.isActive),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function deletePriceAlertFromFirestore(alertIdRaw: string, fbUser: FirebaseUser) {
  if (!isVerifiedFirebaseAccount(fbUser)) return;
  const alertId = sanitizeId(alertIdRaw);
  const path = `price_alerts/${alertId}`;
  const ref = doc(db, 'price_alerts', alertId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    if (snap.data().ownerUid === fbUser.uid) {
      await deleteDoc(ref);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function syncPastRecordsToFirestore(params: {
  appUser: User;
  orders: Order[];
  listings?: ProduceListing[];
  fbUser: FirebaseUser;
}) {
  const { appUser, orders, listings = [], fbUser } = params;
  await syncUserProfileToFirestore(appUser, fbUser);

  for (const listing of listings) {
    await syncListingToFirestore(listing, fbUser);
  }

  for (const order of orders) {
    await syncOrderToFirestore(order, fbUser);
    if (order.livePhotoUrl && order.livePhotoUrl.length >= 10) {
      await syncUploadedPhotoToFirestore(
        {
          id: `ordphoto_${order.id}`,
          farmerId: order.farmerId,
          customerId: order.customerId,
          listingId: order.listingId,
          photoType: 'preorder_verification',
          photoDataUrl: order.livePhotoUrl,
          note: `Order ${order.orderCode} — ${order.productNameEn} (${order.quantityKg} kg)`,
        },
        fbUser
      );
    }
  }
}

export interface FirestoreCloudVault {
  profiles: Record<string, unknown>[];
  signIns: Record<string, unknown>[];
  listings: Record<string, unknown>[];
  uploadedPhotos: Record<string, unknown>[];
  orders: Record<string, unknown>[];
}

export async function fetchFirestoreVault(fbUser: FirebaseUser): Promise<FirestoreCloudVault> {
  const profiles: Record<string, unknown>[] = [];
  const signIns: Record<string, unknown>[] = [];
  const listings: Record<string, unknown>[] = [];
  const uploadedPhotos: Record<string, unknown>[] = [];
  const orders: Record<string, unknown>[] = [];

  try {
    const qProfiles = query(
      collection(db, 'users_public'),
      where('role', 'in', ['customer', 'farmer', 'delivery'])
    );
    const snap = await getDocs(qProfiles);
    snap.forEach((d) => profiles.push(d.data()));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users_public');
  }

  try {
    const qSignIns = query(
      collection(db, 'sign_ins'),
      where('ownerUid', '==', fbUser.uid)
    );
    const snap = await getDocs(qSignIns);
    snap.forEach((d) => signIns.push(d.data()));
    signIns.sort((a, b) => {
      const ta = (a.signedInAt as { seconds?: number } | undefined)?.seconds ?? 0;
      const tb = (b.signedInAt as { seconds?: number } | undefined)?.seconds ?? 0;
      return tb - ta;
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'sign_ins');
  }

  try {
    const qListings = query(collection(db, 'listings'), where('isActive', '==', true));
    const snap = await getDocs(qListings);
    snap.forEach((d) => listings.push(d.data()));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'listings');
  }

  try {
    const qPhotos = query(
      collection(db, 'uploaded_photos'),
      where('ownerUid', '==', fbUser.uid)
    );
    const snap = await getDocs(qPhotos);
    snap.forEach((d) => uploadedPhotos.push(d.data()));
    uploadedPhotos.sort((a, b) => {
      const ta = (a.capturedAt as { seconds?: number } | undefined)?.seconds ?? 0;
      const tb = (b.capturedAt as { seconds?: number } | undefined)?.seconds ?? 0;
      return tb - ta;
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'uploaded_photos');
  }

  try {
    const qOrders = query(
      collection(db, 'orders'),
      where('ownerUid', '==', fbUser.uid)
    );
    const snap = await getDocs(qOrders);
    snap.forEach((d) => orders.push(d.data()));
    orders.sort((a, b) => {
      const ta = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
      const tb = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
      return tb - ta;
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'orders');
  }

  return { profiles, signIns, listings, uploadedPhotos, orders };
}

export interface FirestoreAdminVault extends FirestoreCloudVault {
  privateProfiles: Record<string, unknown>[];
}

export async function fetchAllFirestoreForAdmin(
  fbUser: FirebaseUser
): Promise<FirestoreAdminVault> {
  if (!fbUser.emailVerified || fbUser.email?.toLowerCase() !== ADMIN_EMAIL) {
    throw new Error('Verified admin Google account required to inspect all Firestore collections.');
  }

  const profiles: Record<string, unknown>[] = [];
  const privateProfiles: Record<string, unknown>[] = [];
  const signIns: Record<string, unknown>[] = [];
  const listings: Record<string, unknown>[] = [];
  const uploadedPhotos: Record<string, unknown>[] = [];
  const orders: Record<string, unknown>[] = [];

  try {
    const snap = await getDocs(
      query(collection(db, 'users_public'), where('role', 'in', ['customer', 'farmer', 'delivery']))
    );
    snap.forEach((d) => profiles.push(d.data()));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users_public');
  }

  try {
    const snap = await getDocs(query(collection(db, 'users_private'), where('language', 'in', ['en', 'mr'])));
    snap.forEach((d) => privateProfiles.push(d.data()));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users_private');
  }

  try {
    const snap = await getDocs(
      query(collection(db, 'sign_ins'), where('role', 'in', ['customer', 'farmer', 'delivery']))
    );
    snap.forEach((d) => signIns.push(d.data()));
    signIns.sort((a, b) => {
      const ta = (a.signedInAt as { seconds?: number } | undefined)?.seconds ?? 0;
      const tb = (b.signedInAt as { seconds?: number } | undefined)?.seconds ?? 0;
      return tb - ta;
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'sign_ins');
  }

  try {
    const snap = await getDocs(query(collection(db, 'listings'), where('pricePerKg', '>', 0)));
    snap.forEach((d) => listings.push(d.data()));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'listings');
  }

  try {
    const snap = await getDocs(
      query(collection(db, 'uploaded_photos'), where('photoType', 'in', ['listing_batch', 'preorder_verification']))
    );
    snap.forEach((d) => uploadedPhotos.push(d.data()));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'uploaded_photos');
  }

  try {
    const snap = await getDocs(
      query(
        collection(db, 'orders'),
        where('status', 'in', [
          'placed',
          'accepted_by_farmer',
          'awaiting_delivery',
          'out_for_delivery',
          'delivered',
          'cancelled',
        ])
      )
    );
    snap.forEach((d) => orders.push(d.data()));
    orders.sort((a, b) => {
      const ta = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
      const tb = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
      return tb - ta;
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'orders');
  }

  return { profiles, privateProfiles, signIns, listings, uploadedPhotos, orders };
}
