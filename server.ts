import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  db,
  initDatabase,
  CITY_HUBS,
  haversineKm,
  hashOtp,
  generateSessionToken,
} from './src/server/db.ts';
import type { User, UserRole, Language } from './src/types.ts';

dotenv.config();
initDatabase();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

// Initialize Gemini client lazily so startup never fails if key isn't read yet
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    name: String(row.name),
    phone: String(row.phone),
    role: row.role as UserRole,
    city: String(row.city),
    area: String(row.area),
    lat: Number(row.lat),
    lng: Number(row.lng),
    language: (row.language as Language) || 'en',
    isAvailable: Boolean(row.isAvailable),
    farmName: row.farmName ? String(row.farmName) : null,
    vehicleType: row.vehicleType ? String(row.vehicleType) : null,
    ratingAvg: Number(row.ratingAvg),
    ratingCount: Number(row.ratingCount),
    createdAt: String(row.createdAt),
  };
}

function getAuthenticatedUser(req: express.Request): User | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const session = db
    .prepare('SELECT userId, expiresAt FROM sessions WHERE token = ?')
    .get(token) as { userId: string; expiresAt: string } | undefined;

  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  const userRow = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(session.userId) as Record<string, unknown> | undefined;

  return userRow ? rowToUser(userRow) : null;
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'Kisan Mitra', timestamp: new Date().toISOString() });
});

// ==========================================
// 1. AUTHENTICATION & SMS/OTP ROUTES
// ==========================================

app.get('/api/auth/me', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json({ user });
});

app.get('/api/auth/demo-accounts', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, phone, role, city, area, farmName, vehicleType, isAvailable
       FROM users
       WHERE id IN ('cust-1', 'farmer-1', 'farmer-2', 'farmer-3', 'agent-1')
       ORDER BY role, id`
    )
    .all();
  res.json({ accounts: rows });
});

const MAX_OTP_ATTEMPTS = 5;
const otpAttempts = new Map<string, number>();

type SmsProvider = 'twilio' | 'fast2sms' | 'msg91' | 'none';

function getConfiguredSmsProvider(): SmsProvider {
  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  ) {
    return 'twilio';
  }
  if (process.env.FAST2SMS_API_KEY) {
    return 'fast2sms';
  }
  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID) {
    return 'msg91';
  }
  return 'none';
}

async function dispatchRealSmsOtp(
  phone10: string,
  otpCode: string
): Promise<{ sent: boolean; provider: SmsProvider; error?: string }> {
  const provider = getConfiguredSmsProvider();
  if (provider === 'none') {
    return { sent: false, provider: 'none' };
  }

  try {
    if (provider === 'twilio') {
      const sid = process.env.TWILIO_ACCOUNT_SID!;
      const token = process.env.TWILIO_AUTH_TOKEN!;
      const from = process.env.TWILIO_FROM_NUMBER!;
      const body = new URLSearchParams({
        To: `+91${phone10}`,
        From: from,
        Body: `Your Kisan Mitra verification OTP is ${otpCode}. Valid for 5 minutes. Do not share it with anyone.`,
      });
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      if (!resp.ok) {
        const text = await resp.text();
        return { sent: false, provider, error: `Twilio SMS failed (${resp.status}): ${text}` };
      }
      return { sent: true, provider };
    }

    if (provider === 'fast2sms') {
      const resp = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          authorization: process.env.FAST2SMS_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          route: 'otp',
          variables_values: otpCode,
          numbers: phone10,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        return { sent: false, provider, error: `Fast2SMS failed (${resp.status}): ${text}` };
      }
      return { sent: true, provider };
    }

    if (provider === 'msg91') {
      const resp = await fetch('https://control.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: {
          authkey: process.env.MSG91_AUTH_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template_id: process.env.MSG91_TEMPLATE_ID!,
          mobile: `91${phone10}`,
          otp: otpCode,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        return { sent: false, provider, error: `MSG91 SMS failed (${resp.status}): ${text}` };
      }
      return { sent: true, provider };
    }
  } catch (err) {
    return {
      sent: false,
      provider,
      error: err instanceof Error ? err.message : 'SMS gateway request failed',
    };
  }

  return { sent: false, provider: 'none' };
}

app.get('/api/auth/sms-status', (_req, res) => {
  const configuredProvider = getConfiguredSmsProvider();
  res.json({
    configuredProvider,
    realSmsActive: configuredProvider !== 'none',
  });
});

app.post('/api/auth/send-otp', async (req, res) => {
  const { phone, mode, role, name, city, area, farmName, vehicleType, language, transport } =
    req.body as {
      phone?: string;
      mode?: 'login' | 'register';
      role?: UserRole;
      name?: string;
      city?: string;
      area?: string;
      farmName?: string;
      vehicleType?: string;
      language?: Language;
      transport?: 'auto' | 'preview' | 'check_only';
    };

  const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
  if (cleanPhone.length !== 10 || !/^[6-9]\d{9}$/.test(cleanPhone)) {
    res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number (starting with 6-9).' });
    return;
  }

  const existingUser = db
    .prepare('SELECT * FROM users WHERE phone = ?')
    .get(cleanPhone) as Record<string, unknown> | undefined;

  if (mode === 'login' && !existingUser) {
    res.status(404).json({
      error: 'Mobile number not registered yet. Please switch to Register tab.',
    });
    return;
  }

  if (mode === 'register' && existingUser) {
    res.status(409).json({
      error: 'This mobile number is already registered. Please sign in with OTP.',
    });
    return;
  }

  if (mode === 'register' && (!name || !name.trim())) {
    res.status(400).json({ error: 'Full name is required for registration.' });
    return;
  }

  if (transport === 'check_only') {
    const configuredProvider = getConfiguredSmsProvider();
    res.json({
      success: true,
      ready: true,
      phone: cleanPhone,
      configuredProvider,
      realSmsActive: configuredProvider !== 'none',
    });
    return;
  }

  const otpCode = String(crypto.randomInt(100000, 999999));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO otp_codes (phone, codeHash, role, name, city, area, farmName, vehicleType, language, expiresAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET
       codeHash = excluded.codeHash,
       role = excluded.role,
       name = excluded.name,
       city = excluded.city,
       area = excluded.area,
       farmName = excluded.farmName,
       vehicleType = excluded.vehicleType,
       language = excluded.language,
       expiresAt = excluded.expiresAt,
       createdAt = excluded.createdAt`
  ).run(
    cleanPhone,
    hashOtp(otpCode),
    role || (existingUser ? String(existingUser.role) : 'customer'),
    name?.trim() || (existingUser ? String(existingUser.name) : null),
    city || (existingUser ? String(existingUser.city) : 'Pune'),
    area?.trim() || (existingUser ? String(existingUser.area) : 'Central Area'),
    farmName?.trim() || null,
    vehicleType?.trim() || null,
    language || 'en',
    expiresAt,
    now.toISOString()
  );

  otpAttempts.set(cleanPhone, 0);

  if (transport !== 'preview') {
    const smsResult = await dispatchRealSmsOtp(cleanPhone, otpCode);
    if (smsResult.sent) {
      res.json({
        success: true,
        phone: cleanPhone,
        expiresInSeconds: 300,
        smsMode: 'real_sms',
        provider: smsResult.provider,
        message: `6-digit SMS OTP dispatched to +91 ${cleanPhone} via ${smsResult.provider.toUpperCase()}`,
      });
      return;
    }
    if (smsResult.error) {
      res.status(502).json({ error: smsResult.error });
      return;
    }
  }

  // Fallback preview mode when no live carrier SMS provider / Phone Auth is active yet
  res.json({
    success: true,
    phone: cleanPhone,
    expiresInSeconds: 300,
    smsMode: 'sandbox_preview',
    provider: 'preview',
    demoOtpCode: otpCode,
    message: `6-digit verification OTP generated for +91 ${cleanPhone}`,
  });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { phone, otp } = req.body as { phone?: string; otp?: string };
  const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
  const cleanOtp = (otp || '').trim();

  if (cleanPhone.length !== 10 || !/^\d{6}$/.test(cleanOtp)) {
    res.status(400).json({ error: 'Enter a 10-digit mobile number and 6-digit numeric OTP.' });
    return;
  }

  const record = db
    .prepare('SELECT * FROM otp_codes WHERE phone = ?')
    .get(cleanPhone) as Record<string, unknown> | undefined;

  if (!record) {
    res.status(400).json({ error: 'No OTP requested for this number. Please send OTP first.' });
    return;
  }

  if (new Date(String(record.expiresAt)).getTime() < Date.now()) {
    db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(cleanPhone);
    otpAttempts.delete(cleanPhone);
    res.status(400).json({ error: 'OTP expired. Please request a fresh SMS OTP.' });
    return;
  }

  if (hashOtp(cleanOtp) !== String(record.codeHash)) {
    const attempts = (otpAttempts.get(cleanPhone) || 0) + 1;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(cleanPhone);
      otpAttempts.delete(cleanPhone);
      res.status(429).json({
        error: 'Too many invalid OTP attempts. For security, please request a fresh SMS OTP.',
      });
      return;
    }
    otpAttempts.set(cleanPhone, attempts);
    res.status(401).json({
      error: `Invalid OTP code (${MAX_OTP_ATTEMPTS - attempts} attempts remaining). Please check your SMS and try again.`,
    });
    return;
  }

  db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(cleanPhone);
  otpAttempts.delete(cleanPhone);

  let userRow = db
    .prepare('SELECT * FROM users WHERE phone = ?')
    .get(cleanPhone) as Record<string, unknown> | undefined;

  if (!userRow) {
    const cityName = String(record.city || 'Pune');
    const hub = CITY_HUBS.find((h) => h.city === cityName) || CITY_HUBS[0];
    const latOffset = crypto.randomInt(-80, 80) / 1000;
    const lngOffset = crypto.randomInt(-80, 80) / 1000;
    const newId = `${String(record.role)}-${crypto.randomUUID().slice(0, 8)}`;

    db.prepare(
      `INSERT INTO users (id, name, phone, role, city, area, lat, lng, language, isAvailable, farmName, vehicleType, ratingAvg, ratingCount, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId,
      String(record.name || 'Kisan Mitra User'),
      cleanPhone,
      String(record.role || 'customer'),
      cityName,
      String(record.area || `${cityName} Zone`),
      hub.lat + latOffset,
      hub.lng + lngOffset,
      String(record.language || 'en'),
      1,
      record.farmName ? String(record.farmName) : null,
      record.vehicleType ? String(record.vehicleType) : null,
      4.8,
      0,
      new Date().toISOString()
    );

    userRow = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(newId) as Record<string, unknown>;
  }

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
  db.prepare('INSERT INTO sessions (token, userId, expiresAt) VALUES (?, ?, ?)').run(
    token,
    String(userRow.id),
    expiresAt
  );

  res.json({ token, user: rowToUser(userRow) });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.json({ success: true });
});

let cachedFirebaseApiKey: string | null = null;
function getFirebaseApiKey(): string | null {
  if (cachedFirebaseApiKey) return cachedFirebaseApiKey;
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8');
    const parsed = JSON.parse(raw) as { apiKey?: string };
    cachedFirebaseApiKey = parsed.apiKey || null;
    return cachedFirebaseApiKey;
  } catch {
    return null;
  }
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  phoneNumber: string | null;
}

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
  const apiKey = getFirebaseApiKey();
  if (!apiKey) {
    throw new Error('Firebase configuration missing on server.');
  }
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Invalid Firebase authentication token (${resp.status}). ${errText}`.trim());
  }
  const data = (await resp.json()) as {
    users?: Array<{
      localId?: string;
      email?: string;
      emailVerified?: boolean;
      displayName?: string;
      phoneNumber?: string;
    }>;
  };
  const fbUser = data.users?.[0];
  if (!fbUser?.localId) {
    throw new Error('Firebase user record not found for provided token.');
  }
  return {
    uid: fbUser.localId,
    email: fbUser.email || null,
    emailVerified: Boolean(fbUser.emailVerified),
    displayName: fbUser.displayName || null,
    phoneNumber: fbUser.phoneNumber || null,
  };
}

app.post('/api/auth/phone-firebase-login', async (req, res) => {
  const { idToken, role, name, city, area, farmName, vehicleType, language } = req.body as {
    idToken?: string;
    role?: UserRole;
    name?: string;
    city?: string;
    area?: string;
    farmName?: string;
    vehicleType?: string;
    language?: Language;
  };

  if (!idToken) {
    res.status(400).json({ error: 'Verified Firebase SMS OTP token is required.' });
    return;
  }

  let verified: VerifiedFirebaseUser;
  try {
    verified = await verifyFirebaseIdToken(idToken);
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Firebase Phone OTP token verification failed.',
    });
    return;
  }

  const cleanPhone = (verified.phoneNumber || '').replace(/\D/g, '').slice(-10);
  if (cleanPhone.length !== 10) {
    res.status(400).json({ error: 'Verified Firebase token does not contain a valid mobile number.' });
    return;
  }

  let userRow = db
    .prepare('SELECT * FROM users WHERE phone = ?')
    .get(cleanPhone) as Record<string, unknown> | undefined;

  if (!userRow) {
    const targetRole: UserRole =
      role === 'farmer' || role === 'delivery' ? role : 'customer';
    const cityName = city || 'Pune';
    const hub = CITY_HUBS.find((h) => h.city === cityName) || CITY_HUBS[0];
    const latOffset = crypto.randomInt(-80, 80) / 1000;
    const lngOffset = crypto.randomInt(-80, 80) / 1000;
    const newId = `${targetRole}-${crypto.randomUUID().slice(0, 8)}`;

    db.prepare(
      `INSERT INTO users (id, name, phone, role, city, area, lat, lng, language, isAvailable, farmName, vehicleType, ratingAvg, ratingCount, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId,
      name?.trim() || `Kisan Mitra ${targetRole}`,
      cleanPhone,
      targetRole,
      cityName,
      area?.trim() || `${cityName} Central`,
      hub.lat + latOffset,
      hub.lng + lngOffset,
      language === 'mr' ? 'mr' : 'en',
      1,
      targetRole === 'farmer' ? farmName?.trim() || `${name?.trim() || 'Verified'} Farms` : null,
      targetRole === 'delivery' ? vehicleType?.trim() || 'Tata Ace Gold (1.5 Ton)' : null,
      4.9,
      0,
      new Date().toISOString()
    );

    userRow = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(newId) as Record<string, unknown>;
  }

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
  db.prepare('INSERT INTO sessions (token, userId, expiresAt) VALUES (?, ?, ?)').run(
    token,
    String(userRow.id),
    expiresAt
  );

  res.json({ token, user: rowToUser(userRow) });
});

app.post('/api/auth/firebase-login', async (req, res) => {
  const {
    idToken,
    firebaseUid,
    email,
    name,
    role,
    city,
    area,
    phone,
    farmName,
    vehicleType,
    language,
  } = req.body as {
    idToken?: string;
    firebaseUid?: string;
    email?: string;
    name?: string;
    role?: UserRole;
    city?: string;
    area?: string;
    phone?: string;
    farmName?: string;
    vehicleType?: string;
    language?: Language;
  };

  let verifiedUid = firebaseUid;
  let verifiedEmail = email || null;
  let verifiedDisplayName = name?.trim() || null;

  if (idToken) {
    try {
      const verified = await verifyFirebaseIdToken(idToken);
      verifiedUid = verified.uid;
      verifiedEmail = verified.email;
      if (!verifiedDisplayName) {
        verifiedDisplayName = verified.displayName;
      }
    } catch (err) {
      res.status(401).json({
        error: err instanceof Error ? err.message : 'Google Sign-In token verification failed.',
      });
      return;
    }
  } else {
    res.status(401).json({ error: 'Verified Firebase ID token is required for Google Sign-In.' });
    return;
  }

  if (!verifiedUid) {
    res.status(400).json({ error: 'Firebase UID is required.' });
    return;
  }

  const targetRole: UserRole =
    role === 'farmer' || role === 'delivery' ? role : 'customer';
  const accountId = `fb-${targetRole}-${verifiedUid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`;

  let userRow = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(accountId) as Record<string, unknown> | undefined;

  if (!userRow) {
    const cityName = city || 'Pune';
    const hub = CITY_HUBS.find((h) => h.city === cityName) || CITY_HUBS[0];
    const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);

    // Ensure unique 10-digit phone number even if the typed phone is already linked or omitted
    const phoneInUse =
      cleanPhone.length === 10
        ? Boolean(db.prepare('SELECT id FROM users WHERE phone = ?').get(cleanPhone))
        : true;

    let resolvedPhone = cleanPhone;
    if (cleanPhone.length !== 10 || phoneInUse) {
      let attempt = 0;
      do {
        const seed = `${accountId}:${attempt}`;
        const fallbackNum =
          9000000000 +
          (parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) %
            99999999);
        resolvedPhone = String(fallbackNum);
        attempt += 1;
      } while (db.prepare('SELECT id FROM users WHERE phone = ?').get(resolvedPhone));
    }

    const displayName =
      verifiedDisplayName ||
      (verifiedEmail ? verifiedEmail.split('@')[0] : null) ||
      `Kisan Mitra ${targetRole}`;

    db.prepare(
      `INSERT INTO users (id, name, phone, role, city, area, lat, lng, language, isAvailable, farmName, vehicleType, ratingAvg, ratingCount, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      accountId,
      displayName,
      resolvedPhone,
      targetRole,
      cityName,
      area?.trim() || `${cityName} Central`,
      hub.lat,
      hub.lng,
      language === 'mr' ? 'mr' : 'en',
      1,
      targetRole === 'farmer' ? farmName?.trim() || `${displayName} Farms` : null,
      targetRole === 'delivery' ? vehicleType?.trim() || 'Tata Ace Gold (1.5 Ton)' : null,
      4.9,
      0,
      new Date().toISOString()
    );

    userRow = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(accountId) as Record<string, unknown>;
  }

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
  db.prepare('INSERT INTO sessions (token, userId, expiresAt) VALUES (?, ?, ?)').run(
    token,
    String(userRow.id),
    expiresAt
  );

  res.json({ token, user: rowToUser(userRow) });
});

app.patch('/api/users/availability', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const { isAvailable } = req.body as { isAvailable: boolean };
  db.prepare('UPDATE users SET isAvailable = ? WHERE id = ?').run(isAvailable ? 1 : 0, user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as Record<string, unknown>;
  res.json({ user: rowToUser(updated) });
});

app.patch('/api/users/language', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const { language } = req.body as { language: Language };
  if (language !== 'en' && language !== 'mr') {
    res.status(400).json({ error: 'Invalid language' });
    return;
  }
  db.prepare('UPDATE users SET language = ? WHERE id = ?').run(language, user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as Record<string, unknown>;
  res.json({ user: rowToUser(updated) });
});

// ==========================================
// 2. MARKETPLACE, MANDI PRICES & LISTINGS
// ==========================================

app.get('/api/cities', (_req, res) => {
  res.json({ cities: CITY_HUBS });
});

app.get('/api/mandi-prices', (req, res) => {
  const city = String(req.query.city || 'Pune');
  const search = String(req.query.search || '').trim().toLowerCase();

  let rows = db
    .prepare('SELECT * FROM mandi_prices WHERE city = ? ORDER BY category, productNameEn')
    .all(city) as Record<string, unknown>[];

  if (search) {
    rows = rows.filter(
      (r) =>
        String(r.productNameEn).toLowerCase().includes(search) ||
        String(r.productNameMr).toLowerCase().includes(search) ||
        String(r.productKey).toLowerCase().includes(search)
    );
  }

  res.json({ city, prices: rows });
});

app.get('/api/listings', (req, res) => {
  const city = String(req.query.city || 'Pune');
  const search = String(req.query.search || '').trim().toLowerCase();
  const category = String(req.query.category || 'All');
  const sort = String(req.query.sort || 'nearest');
  const includeUnavailable = req.query.includeUnavailable === 'true';

  const hub = CITY_HUBS.find((h) => h.city === city) || CITY_HUBS[0];
  const buyerLat = req.query.lat ? Number(req.query.lat) : hub.lat;
  const buyerLng = req.query.lng ? Number(req.query.lng) : hub.lng;

  const rawRows = db
    .prepare(
      `SELECT
        l.*,
        u.name as farmerName,
        u.farmName as farmName,
        u.city as farmerCity,
        u.area as farmerArea,
        u.phone as farmerPhone,
        u.lat as farmerLat,
        u.lng as farmerLng,
        u.isAvailable as farmerAvailable,
        u.ratingAvg as farmerRatingAvg,
        u.ratingCount as farmerRatingCount
       FROM listings l
       JOIN users u ON l.farmerId = u.id
       WHERE l.isActive = 1 AND l.availableKg >= l.minOrderKg`
    )
    .all() as Record<string, unknown>[];

  const mandiRows = db
    .prepare('SELECT * FROM mandi_prices WHERE city = ?')
    .all(city) as Record<string, unknown>[];
  const mandiMap = new Map(mandiRows.map((m) => [String(m.productKey), m]));

  let enriched = rawRows
    .map((r) => {
      const distanceKm = haversineKm(buyerLat, buyerLng, Number(r.farmerLat), Number(r.farmerLng));
      const mandi = mandiMap.get(String(r.productKey));
      const mandiModalPrice = mandi ? Number(mandi.modalPricePerKg) : Math.round(Number(r.pricePerKg) * 1.35);
      const mandiMinPrice = mandi ? Number(mandi.minPricePerKg) : Math.round(mandiModalPrice * 0.85);
      const mandiMaxPrice = mandi ? Number(mandi.maxPricePerKg) : Math.round(mandiModalPrice * 1.15);
      const mandiName = mandi ? String(mandi.mandiName) : `${city} APMC Mandi`;
      const savingsPercent =
        mandiModalPrice > 0
          ? Math.max(0, Math.round(((mandiModalPrice - Number(r.pricePerKg)) / mandiModalPrice) * 100))
          : 0;

      return {
        id: String(r.id),
        farmerId: String(r.farmerId),
        farmerName: String(r.farmerName),
        farmName: String(r.farmName || `${r.farmerName} Farm`),
        farmerCity: String(r.farmerCity),
        farmerArea: String(r.farmerArea),
        farmerPhone: String(r.farmerPhone),
        farmerLat: Number(r.farmerLat),
        farmerLng: Number(r.farmerLng),
        farmerAvailable: Boolean(r.farmerAvailable),
        farmerRatingAvg: Number(r.farmerRatingAvg),
        farmerRatingCount: Number(r.farmerRatingCount),
        productKey: String(r.productKey),
        productNameEn: String(r.productNameEn),
        productNameMr: String(r.productNameMr),
        category: String(r.category),
        variety: String(r.variety),
        pricePerKg: Number(r.pricePerKg),
        minOrderKg: Number(r.minOrderKg),
        availableKg: Number(r.availableKg),
        qualityGrade: String(r.qualityGrade),
        harvestedAt: String(r.harvestedAt),
        livePhotoUrl: String(r.livePhotoUrl),
        livePhotoTimestamp: String(r.livePhotoTimestamp),
        cancellationCutoffHours: Number(r.cancellationCutoffHours),
        description: String(r.description),
        isActive: Boolean(r.isActive),
        distanceKm,
        mandiModalPrice,
        mandiMinPrice,
        mandiMaxPrice,
        mandiName,
        savingsPercent,
      };
    })
    .filter((item) => (includeUnavailable ? true : item.farmerAvailable));

  if (category !== 'All') {
    enriched = enriched.filter((item) => item.category === category);
  }

  if (search) {
    enriched = enriched.filter(
      (item) =>
        item.productNameEn.toLowerCase().includes(search) ||
        item.productNameMr.toLowerCase().includes(search) ||
        item.variety.toLowerCase().includes(search) ||
        item.farmerName.toLowerCase().includes(search) ||
        item.farmName.toLowerCase().includes(search) ||
        item.farmerArea.toLowerCase().includes(search) ||
        item.productKey.toLowerCase().includes(search)
    );
  }

  if (sort === 'nearest') {
    enriched.sort((a, b) => a.distanceKm - b.distanceKm || a.pricePerKg - b.pricePerKg);
  } else if (sort === 'price_asc') {
    enriched.sort((a, b) => a.pricePerKg - b.pricePerKg || a.distanceKm - b.distanceKm);
  } else if (sort === 'rating_desc') {
    enriched.sort((a, b) => b.farmerRatingAvg - a.farmerRatingAvg || a.distanceKm - b.distanceKm);
  } else if (sort === 'savings_desc') {
    enriched.sort((a, b) => b.savingsPercent - a.savingsPercent || a.distanceKm - b.distanceKm);
  }

  res.json({ city, mandiName: hub.mandiName, listings: enriched });
});

// ==========================================
// 3. FARMER LISTINGS & LIVE TIMESTAMP PHOTO
// ==========================================

app.get('/api/farmer/listings', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'farmer') {
    res.status(403).json({ error: 'Farmer account required' });
    return;
  }

  const rows = db
    .prepare('SELECT * FROM listings WHERE farmerId = ? ORDER BY harvestedAt DESC')
    .all(user.id);
  res.json({ listings: rows });
});

function triggerPriceDropNotifications(listing: {
  id: string;
  farmerId: string;
  productKey: string;
  productNameEn: string;
  productNameMr: string;
  pricePerKg: number;
  isActive: number;
}) {
  if (!listing.isActive) return;

  const farmer = db
    .prepare('SELECT name, farmName FROM users WHERE id = ?')
    .get(listing.farmerId) as { name: string; farmName?: string | null } | undefined;
  const farmLabel = farmer?.farmName || farmer?.name || 'Verified Farmer';

  const alerts = db
    .prepare(
      `SELECT * FROM price_alerts
       WHERE isActive = 1
         AND targetPricePerKg >= ?
         AND (
           LOWER(productKey) = LOWER(?)
           OR LOWER(productNameEn) LIKE ?
           OR LOWER(?) LIKE '%' || LOWER(productNameEn) || '%'
         )`
    )
    .all(
      listing.pricePerKg,
      listing.productKey,
      `%${listing.productNameEn.toLowerCase()}%`,
      listing.productNameEn.toLowerCase()
    ) as Record<string, unknown>[];

  const now = new Date().toISOString();
  const insertNotif = db.prepare(`
    INSERT INTO notifications (
      id, userId, alertId, listingId, productKey, title, message,
      farmerPricePerKg, targetPricePerKg, isRead, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);

  for (const alert of alerts) {
    // Avoid duplicating identical unread notification for same alert + listing + price
    const already = db
      .prepare(
        `SELECT id FROM notifications
         WHERE userId = ? AND alertId = ? AND listingId = ? AND farmerPricePerKg = ? AND isRead = 0`
      )
      .get(
        String(alert.customerId),
        String(alert.id),
        listing.id,
        listing.pricePerKg
      );
    if (already) continue;

    const notifId = `notif-${crypto.randomUUID().slice(0, 8)}`;
    const title = `Price Drop: ${listing.productNameEn} at ₹${listing.pricePerKg}/kg`;
    const message = `${farmLabel} listed ${listing.productNameEn} at ₹${listing.pricePerKg}/kg — below your ₹${alert.targetPricePerKg}/kg alert target.`;

    insertNotif.run(
      notifId,
      String(alert.customerId),
      String(alert.id),
      listing.id,
      listing.productKey,
      title,
      message,
      listing.pricePerKg,
      Number(alert.targetPricePerKg),
      now
    );
  }
}

app.post('/api/farmer/listings', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'farmer') {
    res.status(403).json({ error: 'Farmer account required' });
    return;
  }

  const {
    productKey,
    productNameEn,
    productNameMr,
    category,
    variety,
    pricePerKg,
    minOrderKg,
    availableKg,
    qualityGrade,
    livePhotoUrl,
    cancellationCutoffHours,
    description,
  } = req.body;

  if (!productNameEn || !pricePerKg || !minOrderKg || !availableKg) {
    res.status(400).json({ error: 'Product name, price, minimum bulk kg, and available stock are required.' });
    return;
  }

  const now = new Date().toISOString();
  const id = `list-${crypto.randomUUID().slice(0, 8)}`;
  const cleanNameEn = String(productNameEn).trim();
  const cleanNameMr = String(productNameMr || cleanNameEn).trim();
  const key =
    productKey && String(productKey).trim()
      ? String(productKey).trim()
      : cleanNameEn.toLowerCase().replace(/[^a-z0-9]+/g, '_');

  db.prepare(
    `INSERT INTO listings (
      id, farmerId, productKey, productNameEn, productNameMr, category, variety,
      pricePerKg, minOrderKg, availableKg, qualityGrade, harvestedAt,
      livePhotoUrl, livePhotoTimestamp, cancellationCutoffHours, description, isActive
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.id,
    key,
    cleanNameEn,
    cleanNameMr,
    String(category || 'Vegetables'),
    String(variety || 'Farm Direct Bulk'),
    Number(pricePerKg),
    Math.max(10, Number(minOrderKg)),
    Number(availableKg),
    String(qualityGrade || 'Grade A Farm Fresh'),
    now,
    String(livePhotoUrl || key),
    now,
    Math.max(1, Number(cancellationCutoffHours || 2)),
    String(description || 'Fresh farm harvest packed for bulk delivery.'),
    1
  );

  triggerPriceDropNotifications({
    id,
    farmerId: user.id,
    productKey: key,
    productNameEn: cleanNameEn,
    productNameMr: cleanNameMr,
    pricePerKg: Number(pricePerKg),
    isActive: 1,
  });

  const created = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  res.status(201).json({ listing: created });
});

app.patch('/api/farmer/listings/:id', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'farmer') {
    res.status(403).json({ error: 'Farmer account required' });
    return;
  }

  const existing = db
    .prepare('SELECT * FROM listings WHERE id = ? AND farmerId = ?')
    .get(req.params.id, user.id) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  const {
    productNameEn,
    productNameMr,
    variety,
    pricePerKg,
    availableKg,
    minOrderKg,
    cancellationCutoffHours,
    livePhotoUrl,
    isActive,
  } = req.body;

  const now = new Date().toISOString();
  const nextPhotoUrl = livePhotoUrl ? String(livePhotoUrl) : String(existing.livePhotoUrl);
  const nextPhotoTs = livePhotoUrl ? now : String(existing.livePhotoTimestamp);
  const nextNameEn =
    productNameEn !== undefined && String(productNameEn).trim()
      ? String(productNameEn).trim()
      : String(existing.productNameEn);
  const nextNameMr =
    productNameMr !== undefined && String(productNameMr).trim()
      ? String(productNameMr).trim()
      : String(existing.productNameMr);
  const nextVariety =
    variety !== undefined && String(variety).trim()
      ? String(variety).trim()
      : String(existing.variety);
  const nextPrice =
    pricePerKg !== undefined ? Number(pricePerKg) : Number(existing.pricePerKg);
  const nextActive =
    isActive !== undefined ? (isActive ? 1 : 0) : Number(existing.isActive);

  db.prepare(
    `UPDATE listings SET
      productNameEn = ?,
      productNameMr = ?,
      variety = ?,
      pricePerKg = ?,
      availableKg = ?,
      minOrderKg = ?,
      cancellationCutoffHours = ?,
      livePhotoUrl = ?,
      livePhotoTimestamp = ?,
      isActive = ?
     WHERE id = ? AND farmerId = ?`
  ).run(
    nextNameEn,
    nextNameMr,
    nextVariety,
    nextPrice,
    availableKg !== undefined ? Number(availableKg) : Number(existing.availableKg),
    minOrderKg !== undefined ? Number(minOrderKg) : Number(existing.minOrderKg),
    cancellationCutoffHours !== undefined
      ? Math.max(1, Number(cancellationCutoffHours))
      : Number(existing.cancellationCutoffHours),
    nextPhotoUrl,
    nextPhotoTs,
    nextActive,
    req.params.id,
    user.id
  );

  triggerPriceDropNotifications({
    id: req.params.id,
    farmerId: user.id,
    productKey: String(existing.productKey),
    productNameEn: nextNameEn,
    productNameMr: nextNameMr,
    pricePerKg: nextPrice,
    isActive: nextActive,
  });

  const updated = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  res.json({ listing: updated });
});

// ==========================================
// 3B. CUSTOMER PRICE-DROP SUBSCRIPTIONS & NOTIFICATIONS
// ==========================================

app.get('/api/price-alerts', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const alerts = db
    .prepare('SELECT * FROM price_alerts WHERE customerId = ? AND isActive = 1 ORDER BY createdAt DESC')
    .all(user.id) as Record<string, unknown>[];

  const notifications = db
    .prepare('SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 20')
    .all(user.id) as Record<string, unknown>[];

  res.json({
    alerts: alerts.map((a) => ({
      ...a,
      targetPricePerKg: Number(a.targetPricePerKg),
      isActive: Boolean(a.isActive),
    })),
    notifications: notifications.map((n) => ({
      ...n,
      farmerPricePerKg: Number(n.farmerPricePerKg),
      targetPricePerKg: Number(n.targetPricePerKg),
      isRead: Boolean(n.isRead),
    })),
  });
});

app.post('/api/price-alerts', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Please sign in to subscribe to price drops.' });
    return;
  }

  const { productKey, productNameEn, productNameMr, city, targetPricePerKg } = req.body as {
    productKey?: string;
    productNameEn?: string;
    productNameMr?: string;
    city?: string;
    targetPricePerKg?: number;
  };

  if (!productNameEn || !targetPricePerKg || Number(targetPricePerKg) <= 0) {
    res.status(400).json({ error: 'Produce item and positive target price (₹/kg) are required.' });
    return;
  }

  const cleanKey =
    productKey || productNameEn.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const id = `alert-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const target = Number(targetPricePerKg);

  db.prepare(
    `INSERT INTO price_alerts (id, customerId, productKey, productNameEn, productNameMr, city, targetPricePerKg, isActive, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    id,
    user.id,
    cleanKey,
    productNameEn.trim(),
    (productNameMr || productNameEn).trim(),
    city || user.city || 'Pune',
    target,
    now
  );

  // Immediately check if any active listing already meets this price threshold
  const matchingListings = db
    .prepare(
      `SELECT l.*, u.name as farmerName, u.farmName
       FROM listings l JOIN users u ON l.farmerId = u.id
       WHERE l.isActive = 1 AND u.isAvailable = 1 AND l.pricePerKg <= ?
         AND (LOWER(l.productKey) = LOWER(?) OR LOWER(l.productNameEn) LIKE ?)`
    )
    .all(target, cleanKey, `%${productNameEn.trim().toLowerCase()}%`) as Record<string, unknown>[];

  for (const l of matchingListings) {
    const notifId = `notif-${crypto.randomUUID().slice(0, 8)}`;
    const farmLabel = l.farmName || l.farmerName || 'Verified Farmer';
    db.prepare(
      `INSERT INTO notifications (id, userId, alertId, listingId, productKey, title, message, farmerPricePerKg, targetPricePerKg, isRead, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      notifId,
      user.id,
      id,
      String(l.id),
      String(l.productKey),
      `Price Match: ${l.productNameEn} at ₹${l.pricePerKg}/kg`,
      `${farmLabel} already offers ${l.productNameEn} at ₹${l.pricePerKg}/kg (below your ₹${target}/kg alert).`,
      Number(l.pricePerKg),
      target,
      now
    );
  }

  const created = db.prepare('SELECT * FROM price_alerts WHERE id = ?').get(id);
  res.status(201).json({
    alert: created,
    immediateMatches: matchingListings.length,
  });
});

app.delete('/api/price-alerts/:id', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  db.prepare('DELETE FROM price_alerts WHERE id = ? AND customerId = ?').run(
    req.params.id,
    user.id
  );
  res.json({ success: true });
});

app.post('/api/notifications/mark-read', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const { id } = req.body as { id?: string };
  if (id) {
    db.prepare('UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?').run(id, user.id);
  } else {
    db.prepare('UPDATE notifications SET isRead = 1 WHERE userId = ?').run(user.id);
  }
  res.json({ success: true });
});

// ==========================================
// 4. PRE-ORDER LIVE PHOTO VERIFICATION RULE
// ==========================================

app.get('/api/photo-verifications/status', (req, res) => {
  const user = getAuthenticatedUser(req);
  const listingId = String(req.query.listingId || '');
  if (!listingId) {
    res.status(400).json({ error: 'listingId required' });
    return;
  }

  const listing = db
    .prepare('SELECT * FROM listings WHERE id = ?')
    .get(listingId) as Record<string, unknown> | undefined;
  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  if (!user) {
    res.json({
      priorOrdersCount: 0,
      isFirstOrderWithFarmer: true,
      verification: null,
    });
    return;
  }

  const prior = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM orders
       WHERE customerId = ? AND farmerId = ? AND status != 'cancelled'`
    )
    .get(user.id, String(listing.farmerId)) as { cnt: number };

  const verification = db
    .prepare(
      `SELECT * FROM photo_verifications
       WHERE customerId = ? AND listingId = ?
       ORDER BY requestedAt DESC LIMIT 1`
    )
    .get(user.id, listingId) as Record<string, unknown> | undefined;

  res.json({
    priorOrdersCount: prior.cnt,
    isFirstOrderWithFarmer: prior.cnt === 0,
    verification: verification || null,
  });
});

app.post('/api/photo-verifications/request', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'customer') {
    res.status(403).json({ error: 'Customer sign-in required to request live product photo.' });
    return;
  }

  const { listingId } = req.body as { listingId?: string };
  if (!listingId) {
    res.status(400).json({ error: 'listingId is required' });
    return;
  }

  const listing = db
    .prepare('SELECT * FROM listings WHERE id = ?')
    .get(listingId) as Record<string, unknown> | undefined;
  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  // Check if a pending request already exists
  const existingPending = db
    .prepare(
      `SELECT * FROM photo_verifications
       WHERE customerId = ? AND listingId = ? AND status = 'pending'`
    )
    .get(user.id, listingId) as Record<string, unknown> | undefined;

  if (existingPending) {
    res.json({ verification: existingPending });
    return;
  }

  const id = `pv-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO photo_verifications (id, customerId, farmerId, listingId, status, requestedAt)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(id, user.id, String(listing.farmerId), listingId, now);

  const created = db.prepare('SELECT * FROM photo_verifications WHERE id = ?').get(id);
  res.status(201).json({ verification: created });
});

app.get('/api/farmer/photo-verifications', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'farmer') {
    res.status(403).json({ error: 'Farmer account required' });
    return;
  }

  const rows = db
    .prepare(
      `SELECT pv.*, u.name as customerName, u.city as customerCity, l.productNameEn, l.productNameMr
       FROM photo_verifications pv
       JOIN users u ON pv.customerId = u.id
       JOIN listings l ON pv.listingId = l.id
       WHERE pv.farmerId = ?
       ORDER BY CASE WHEN pv.status = 'pending' THEN 0 ELSE 1 END, pv.requestedAt DESC`
    )
    .all(user.id);

  res.json({ requests: rows });
});

app.post('/api/farmer/photo-verifications/:id/respond', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'farmer') {
    res.status(403).json({ error: 'Farmer account required' });
    return;
  }

  const pv = db
    .prepare('SELECT * FROM photo_verifications WHERE id = ? AND farmerId = ?')
    .get(req.params.id, user.id) as Record<string, unknown> | undefined;

  if (!pv) {
    res.status(404).json({ error: 'Photo verification request not found' });
    return;
  }

  const { photoDataUrl, farmerNote } = req.body as { photoDataUrl?: string; farmerNote?: string };
  if (!photoDataUrl) {
    res.status(400).json({ error: 'Please capture or upload a real-time photo with timestamp.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE photo_verifications
     SET status = 'sent', photoDataUrl = ?, photoTimestamp = ?, farmerNote = ?
     WHERE id = ?`
  ).run(photoDataUrl, now, farmerNote || 'Verified fresh batch from farm.', req.params.id);

  // Also update the listing's latest live photo & timestamp
  db.prepare(
    `UPDATE listings SET livePhotoUrl = ?, livePhotoTimestamp = ? WHERE id = ?`
  ).run(photoDataUrl, now, String(pv.listingId));

  const updated = db.prepare('SELECT * FROM photo_verifications WHERE id = ?').get(req.params.id);
  res.json({ verification: updated });
});

// ==========================================
// 5. ORDERS, CANCELLATION WINDOW, TRACKING & RATINGS
// ==========================================

function enrichOrders(rows: Record<string, unknown>[]) {
  return rows.map((r) => ({
    ...r,
    quantityKg: Number(r.quantityKg),
    pricePerKg: Number(r.pricePerKg),
    mandiPricePerKg: Number(r.mandiPricePerKg),
    totalAmount: Number(r.totalAmount),
    cancellationCutoffHours: Number(r.cancellationCutoffHours),
    customerLat: Number(r.customerLat),
    customerLng: Number(r.customerLng),
    farmerLat: Number(r.farmerLat),
    farmerLng: Number(r.farmerLng),
    agentLat: Number(r.agentLat),
    agentLng: Number(r.agentLng),
    etaMinutes: Number(r.etaMinutes),
    ratingScore: r.ratingScore !== null ? Number(r.ratingScore) : null,
    deliveryRatingScore: r.deliveryRatingScore !== null ? Number(r.deliveryRatingScore) : null,
  }));
}

app.get('/api/orders', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const baseSelect = `
    SELECT o.*,
      c.name as customerName, c.phone as customerPhone,
      f.name as farmerName, f.farmName as farmName, f.phone as farmerPhone,
      d.name as deliveryAgentName, d.phone as deliveryAgentPhone, d.vehicleType as deliveryVehicle
    FROM orders o
    JOIN users c ON o.customerId = c.id
    JOIN users f ON o.farmerId = f.id
    LEFT JOIN users d ON o.deliveryAgentId = d.id
  `;

  if (user.role === 'customer') {
    const rows = db
      .prepare(`${baseSelect} WHERE o.customerId = ? ORDER BY o.createdAt DESC`)
      .all(user.id) as Record<string, unknown>[];
    res.json({ orders: enrichOrders(rows) });
    return;
  }

  if (user.role === 'farmer') {
    const rows = db
      .prepare(`${baseSelect} WHERE o.farmerId = ? ORDER BY o.createdAt DESC`)
      .all(user.id) as Record<string, unknown>[];
    res.json({ orders: enrichOrders(rows) });
    return;
  }

  // Delivery Agent: show available open requests (accepted_by_farmer / awaiting_delivery and not declined) + orders assigned to this agent
  const rows = db
    .prepare(
      `${baseSelect}
       WHERE o.deliveryAgentId = ?
          OR (
            o.deliveryAgentId IS NULL
            AND o.status IN ('accepted_by_farmer', 'awaiting_delivery')
            AND NOT EXISTS (
              SELECT 1 FROM declined_deliveries dd
              WHERE dd.orderId = o.id AND dd.agentId = ?
            )
          )
       ORDER BY CASE WHEN o.deliveryAgentId = ? THEN 0 ELSE 1 END, o.createdAt DESC`
    )
    .all(user.id, user.id, user.id) as Record<string, unknown>[];

  res.json({ orders: enrichOrders(rows) });
});

app.post('/api/orders', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'customer') {
    res.status(403).json({ error: 'Please sign in as a Customer to place a bulk order.' });
    return;
  }

  const {
    listingId,
    quantityKg,
    paymentMethod,
    scheduledDeliveryAt,
    deliveryAddress,
    deliveryCity,
  } = req.body as {
    listingId?: string;
    quantityKg?: number;
    paymentMethod?: 'UPI' | 'Bank Transfer' | 'Bulk COD';
    scheduledDeliveryAt?: string;
    deliveryAddress?: string;
    deliveryCity?: string;
  };

  if (!listingId || !quantityKg || !deliveryAddress) {
    res.status(400).json({ error: 'Listing, quantity (kg), and delivery address are required.' });
    return;
  }

  const listing = db
    .prepare(
      `SELECT l.*, u.lat as farmerLat, u.lng as farmerLng, u.isAvailable as farmerAvailable
       FROM listings l JOIN users u ON l.farmerId = u.id
       WHERE l.id = ?`
    )
    .get(listingId) as Record<string, unknown> | undefined;

  if (!listing) {
    res.status(404).json({ error: 'Produce listing not found.' });
    return;
  }

  if (!listing.farmerAvailable) {
    res.status(400).json({ error: 'This farmer is currently marked unavailable for new bulk orders.' });
    return;
  }

  const qty = Number(quantityKg);
  if (qty < Number(listing.minOrderKg)) {
    res.status(400).json({
      error: `Minimum bulk order for this listing is ${listing.minOrderKg} kg.`,
    });
    return;
  }

  if (qty > Number(listing.availableKg)) {
    res.status(400).json({
      error: `Only ${listing.availableKg} kg available in this harvest batch.`,
    });
    return;
  }

  // Check First-Time Customer Live Photo Verification Rule
  const prior = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM orders
       WHERE customerId = ? AND farmerId = ? AND status != 'cancelled'`
    )
    .get(user.id, String(listing.farmerId)) as { cnt: number };

  const sentVerification = db
    .prepare(
      `SELECT * FROM photo_verifications
       WHERE customerId = ? AND listingId = ? AND status = 'sent'
       ORDER BY photoTimestamp DESC LIMIT 1`
    )
    .get(user.id, listingId) as Record<string, unknown> | undefined;

  if (prior.cnt === 0 && !sentVerification) {
    res.status(400).json({
      code: 'LIVE_PHOTO_REQUIRED',
      error:
        'First order with this farmer requires a real-time timestamped product photo sent by the farmer before placing the order.',
    });
    return;
  }

  const targetCity = deliveryCity || user.city || 'Pune';
  const hub = CITY_HUBS.find((h) => h.city === targetCity) || CITY_HUBS[0];
  const mandiRow = db
    .prepare('SELECT modalPricePerKg FROM mandi_prices WHERE city = ? AND productKey = ?')
    .get(targetCity, String(listing.productKey)) as { modalPricePerKg: number } | undefined;

  const mandiPricePerKg = mandiRow
    ? Number(mandiRow.modalPricePerKg)
    : Math.round(Number(listing.pricePerKg) * 1.35);

  const now = new Date();
  const scheduledDate = scheduledDeliveryAt
    ? new Date(scheduledDeliveryAt)
    : new Date(now.getTime() + 18 * 3600_000); // default tomorrow

  const cutoffHours = Number(listing.cancellationCutoffHours || 2);
  const deadlineDate = new Date(scheduledDate.getTime() - cutoffHours * 3600_000);

  const distKm = haversineKm(
    hub.lat,
    hub.lng,
    Number(listing.farmerLat),
    Number(listing.farmerLng)
  );
  const etaMinutes = Math.max(25, Math.round(distKm * 2.1));

  const orderId = `ord-${crypto.randomUUID().slice(0, 8)}`;
  const orderCode = `KM-2026-${crypto.randomInt(1100, 9999)}`;
  const totalAmount = Math.round(qty * Number(listing.pricePerKg));
  const method = paymentMethod || 'UPI';
  const paymentStatus = method === 'Bulk COD' ? 'Pending' : 'Paid';
  const isoNow = now.toISOString();

  const photoUrl = sentVerification?.photoDataUrl
    ? String(sentVerification.photoDataUrl)
    : String(listing.livePhotoUrl);
  const photoTs = sentVerification?.photoTimestamp
    ? String(sentVerification.photoTimestamp)
    : String(listing.livePhotoTimestamp);

  db.prepare(
    `INSERT INTO orders (
      id, orderCode, customerId, farmerId, deliveryAgentId, listingId,
      productKey, productNameEn, productNameMr, quantityKg, pricePerKg, mandiPricePerKg,
      totalAmount, paymentMethod, paymentStatus, status,
      scheduledDeliveryAt, cancellationCutoffHours, cancellationDeadlineAt,
      deliveryAddress, deliveryCity, customerLat, customerLng, farmerLat, farmerLng, agentLat, agentLng,
      etaMinutes, livePhotoUrl, livePhotoTimestamp, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'placed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orderId,
    orderCode,
    user.id,
    String(listing.farmerId),
    listingId,
    String(listing.productKey),
    String(listing.productNameEn),
    String(listing.productNameMr),
    qty,
    Number(listing.pricePerKg),
    mandiPricePerKg,
    totalAmount,
    method,
    paymentStatus,
    scheduledDate.toISOString(),
    cutoffHours,
    deadlineDate.toISOString(),
    deliveryAddress,
    targetCity,
    hub.lat,
    hub.lng,
    Number(listing.farmerLat),
    Number(listing.farmerLng),
    Number(listing.farmerLat),
    Number(listing.farmerLng),
    etaMinutes,
    photoUrl,
    photoTs,
    isoNow,
    isoNow
  );

  // Decrement available stock
  db.prepare('UPDATE listings SET availableKg = availableKg - ? WHERE id = ?').run(qty, listingId);

  const created = db
    .prepare(
      `SELECT o.*, c.name as customerName, c.phone as customerPhone,
       f.name as farmerName, f.farmName as farmName, f.phone as farmerPhone
       FROM orders o
       JOIN users c ON o.customerId = c.id
       JOIN users f ON o.farmerId = f.id
       WHERE o.id = ?`
    )
    .get(orderId) as Record<string, unknown>;

  res.status(201).json({ order: enrichOrders([created])[0] });
});

app.post('/api/orders/:id/cancel', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'customer') {
    res.status(403).json({ error: 'Customer account required' });
    return;
  }

  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND customerId = ?')
    .get(req.params.id, user.id) as Record<string, unknown> | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  if (order.status === 'out_for_delivery' || order.status === 'delivered') {
    res.status(400).json({ error: 'Order is already dispatched and cannot be cancelled.' });
    return;
  }

  if (order.status === 'cancelled') {
    res.status(400).json({ error: 'Order is already cancelled.' });
    return;
  }

  const deadlineMs = new Date(String(order.cancellationDeadlineAt)).getTime();
  if (Date.now() > deadlineMs) {
    res.status(400).json({
      error: `Cancellation window closed. Farmer requires cancelling at least ${order.cancellationCutoffHours} hours before dispatch (${new Date(deadlineMs).toLocaleString()}).`,
    });
    return;
  }

  db.prepare(`UPDATE orders SET status = 'cancelled', updatedAt = ? WHERE id = ?`).run(
    new Date().toISOString(),
    order.id
  );
  db.prepare('UPDATE listings SET availableKg = availableKg + ? WHERE id = ?').run(
    Number(order.quantityKg),
    String(order.listingId)
  );

  res.json({ success: true });
});

app.post('/api/orders/:id/farmer-action', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'farmer') {
    res.status(403).json({ error: 'Farmer account required' });
    return;
  }

  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND farmerId = ?')
    .get(req.params.id, user.id) as Record<string, unknown> | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const { action, cancellationCutoffHours } = req.body as {
    action: 'accept' | 'update_cutoff';
    cancellationCutoffHours?: number;
  };

  const now = new Date().toISOString();

  if (action === 'update_cutoff' && cancellationCutoffHours !== undefined) {
    const cutoff = Math.max(1, Number(cancellationCutoffHours));
    const scheduledMs = new Date(String(order.scheduledDeliveryAt)).getTime();
    const newDeadline = new Date(scheduledMs - cutoff * 3600_000).toISOString();
    db.prepare(
      `UPDATE orders SET cancellationCutoffHours = ?, cancellationDeadlineAt = ?, updatedAt = ? WHERE id = ?`
    ).run(cutoff, newDeadline, now, order.id);
    res.json({ success: true });
    return;
  }

  if (action === 'accept') {
    const cutoff =
      cancellationCutoffHours !== undefined
        ? Math.max(1, Number(cancellationCutoffHours))
        : Number(order.cancellationCutoffHours);
    const scheduledMs = new Date(String(order.scheduledDeliveryAt)).getTime();
    const newDeadline = new Date(scheduledMs - cutoff * 3600_000).toISOString();

    db.prepare(
      `UPDATE orders SET status = 'accepted_by_farmer', cancellationCutoffHours = ?, cancellationDeadlineAt = ?, updatedAt = ? WHERE id = ?`
    ).run(cutoff, newDeadline, now, order.id);
    res.json({ success: true });
    return;
  }

  res.status(400).json({ error: 'Invalid farmer action' });
});

app.post('/api/orders/:id/delivery-action', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'delivery') {
    res.status(403).json({ error: 'Delivery Agent account required' });
    return;
  }

  const order = db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .get(req.params.id) as Record<string, unknown> | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const { action, lat, lng } = req.body as {
    action: 'take' | 'decline' | 'update_location' | 'deliver';
    lat?: number;
    lng?: number;
  };
  const now = new Date().toISOString();

  if (action === 'decline') {
    db.prepare(
      `INSERT OR IGNORE INTO declined_deliveries (orderId, agentId, declinedAt) VALUES (?, ?, ?)`
    ).run(order.id, user.id, now);
    if (order.deliveryAgentId === user.id && order.status !== 'delivered') {
      db.prepare(
        `UPDATE orders SET deliveryAgentId = NULL, status = 'accepted_by_farmer', updatedAt = ? WHERE id = ?`
      ).run(now, order.id);
    }
    res.json({ success: true });
    return;
  }

  if (action === 'take') {
    if (order.deliveryAgentId && order.deliveryAgentId !== user.id) {
      res.status(409).json({ error: 'Another delivery agent has already taken this order.' });
      return;
    }
    const distKm = haversineKm(
      Number(order.farmerLat),
      Number(order.farmerLng),
      Number(order.customerLat),
      Number(order.customerLng)
    );
    const eta = Math.max(20, Math.round(distKm * 1.9));
    db.prepare(
      `UPDATE orders
       SET deliveryAgentId = ?, status = 'out_for_delivery', agentLat = ?, agentLng = ?, etaMinutes = ?, updatedAt = ?
       WHERE id = ?`
    ).run(user.id, Number(order.farmerLat), Number(order.farmerLng), eta, now, order.id);
    res.json({ success: true });
    return;
  }

  if (order.deliveryAgentId !== user.id) {
    res.status(403).json({ error: 'You are not assigned to this delivery.' });
    return;
  }

  if (action === 'update_location') {
    let nextLat = lat;
    let nextLng = lng;
    if (nextLat === undefined || nextLng === undefined) {
      // Advance 35% closer to customer along route
      nextLat = Number(order.agentLat) + (Number(order.customerLat) - Number(order.agentLat)) * 0.35;
      nextLng = Number(order.agentLng) + (Number(order.customerLng) - Number(order.agentLng)) * 0.35;
    }
    const remainingKm = haversineKm(
      nextLat,
      nextLng,
      Number(order.customerLat),
      Number(order.customerLng)
    );
    const eta = Math.max(5, Math.round(remainingKm * 1.8));
    db.prepare(
      `UPDATE orders SET agentLat = ?, agentLng = ?, etaMinutes = ?, updatedAt = ? WHERE id = ?`
    ).run(nextLat, nextLng, eta, now, order.id);
    res.json({ success: true, etaMinutes: eta, remainingKm });
    return;
  }

  if (action === 'deliver') {
    db.prepare(
      `UPDATE orders
       SET status = 'delivered', agentLat = customerLat, agentLng = customerLng, etaMinutes = 0, paymentStatus = 'Paid', updatedAt = ?
       WHERE id = ?`
    ).run(now, order.id);
    res.json({ success: true });
    return;
  }

  res.status(400).json({ error: 'Invalid delivery action' });
});

app.post('/api/orders/:id/pay', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'customer') {
    res.status(403).json({ error: 'Customer account required' });
    return;
  }
  const { paymentMethod } = req.body as { paymentMethod?: 'UPI' | 'Bank Transfer' | 'Bulk COD' };
  db.prepare(
    `UPDATE orders SET paymentStatus = 'Paid', paymentMethod = COALESCE(?, paymentMethod), updatedAt = ?
     WHERE id = ? AND customerId = ?`
  ).run(paymentMethod || null, new Date().toISOString(), req.params.id, user.id);
  res.json({ success: true });
});

app.post('/api/orders/:id/rate', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user || user.role !== 'customer') {
    res.status(403).json({ error: 'Customer account required' });
    return;
  }

  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND customerId = ?')
    .get(req.params.id, user.id) as Record<string, unknown> | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  if (order.status !== 'delivered') {
    res.status(400).json({ error: 'Ratings can be submitted after delivery is completed.' });
    return;
  }

  const { ratingScore, deliveryRatingScore, ratingReview } = req.body as {
    ratingScore: number;
    deliveryRatingScore?: number;
    ratingReview?: string;
  };

  const score = Math.min(5, Math.max(1, Math.round(Number(ratingScore))));
  const dScore = deliveryRatingScore
    ? Math.min(5, Math.max(1, Math.round(Number(deliveryRatingScore))))
    : score;

  db.prepare(
    `UPDATE orders SET ratingScore = ?, deliveryRatingScore = ?, ratingReview = ?, updatedAt = ? WHERE id = ?`
  ).run(score, dScore, (ratingReview || '').trim(), new Date().toISOString(), order.id);

  // Update farmer's aggregate rating
  const stats = db
    .prepare(
      `SELECT AVG(ratingScore) as avgScore, COUNT(ratingScore) as cnt
       FROM orders WHERE farmerId = ? AND ratingScore IS NOT NULL`
    )
    .get(String(order.farmerId)) as { avgScore: number; cnt: number };

  if (stats && stats.cnt > 0) {
    db.prepare('UPDATE users SET ratingAvg = ?, ratingCount = ? WHERE id = ?').run(
      Math.round(stats.avgScore * 10) / 10,
      stats.cnt,
      String(order.farmerId)
    );
  }

  res.json({ success: true });
});

// ==========================================
// 6. LIVE GEMINI AI BOT (MARKET PRICE & FARMER COMPARISON)
// ==========================================

app.post('/api/ai/chat', async (req, res) => {
  const { message, language, city, searchQuery, history } = req.body as {
    message: string;
    language?: Language;
    city?: string;
    searchQuery?: string;
    history?: { role: 'user' | 'model'; text: string }[];
  };

  if (!message || !message.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({
      error: 'Gemini API key is not configured in Settings > Secrets.',
    });
    return;
  }

  const targetCity = city || 'Pune';
  const hub = CITY_HUBS.find((h) => h.city === targetCity) || CITY_HUBS[0];

  // Pull real mandi prices for city
  const mandiPrices = db
    .prepare('SELECT * FROM mandi_prices WHERE city = ?')
    .all(targetCity) as Record<string, unknown>[];

  // Pull active farmer listings enriched with distance and ratings
  const rawListings = db
    .prepare(
      `SELECT l.*, u.name as farmerName, u.farmName, u.city as farmerCity, u.area as farmerArea,
              u.lat as farmerLat, u.lng as farmerLng, u.isAvailable as farmerAvailable,
              u.ratingAvg, u.ratingCount
       FROM listings l
       JOIN users u ON l.farmerId = u.id
       WHERE l.isActive = 1 AND u.isAvailable = 1`
    )
    .all() as Record<string, unknown>[];

  const enrichedListings = rawListings
    .map((l) => ({
      productEn: l.productNameEn,
      productMr: l.productNameMr,
      variety: l.variety,
      farmerName: l.farmerName,
      farmName: l.farmName,
      area: `${l.farmerArea}, ${l.farmerCity}`,
      distanceKm: haversineKm(hub.lat, hub.lng, Number(l.farmerLat), Number(l.farmerLng)),
      farmerPricePerKg: l.pricePerKg,
      minOrderKg: l.minOrderKg,
      availableKg: l.availableKg,
      qualityGrade: l.qualityGrade,
      rating: `${l.ratingAvg}/5 (${l.ratingCount} reviews)`,
      cancellationCutoffHours: l.cancellationCutoffHours,
      livePhotoTimestamp: l.livePhotoTimestamp,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const systemInstruction = `You are Kisan Mitra Live AI Advisor — an agricultural wholesale marketplace assistant helping bulk buyers, farmers, and delivery partners in India.
Preferred UI language: ${language === 'mr' ? 'Marathi (Devanagari script, warm & clear)' : 'English'}.
If the user writes in Marathi, reply in Marathi. If in English, reply in English (you may include helpful local Marathi vegetable/mandi terms if helpful).

Buyer's Selected City / Mandi: ${targetCity} (${hub.mandiName})
Current Search Focus: ${searchQuery ? searchQuery : 'General bulk produce'}

TODAY'S STANDARD APMC MANDI PRICES IN ${targetCity.toUpperCase()} (₹/kg):
${JSON.stringify(mandiPrices.map((m) => ({
  product: `${m.productNameEn} (${m.productNameMr})`,
  mandi: m.mandiName,
  minKg: m.minPricePerKg,
  modalStandardKg: m.modalPricePerKg,
  maxKg: m.maxPricePerKg,
})), null, 2)}

LIVE AVAILABLE FARMER BULK LISTINGS (sorted nearest first from ${targetCity}):
${JSON.stringify(enrichedListings, null, 2)}

RULES:
1. Always ground your answers strictly in the live Mandi Prices and Farmer Listings data above. Do NOT invent fake farmers or prices.
2. When asked about today's market price / mandi rate, state the exact Mandi Name, Min, Modal (standard), and Max ₹/kg rate, and compare it directly against our available farmers' bulk ₹/kg prices and percentage savings.
3. When asked to compare farmers, compare them cleanly across 4 dimensions: (a) Price ₹/kg vs Mandi, (b) Product Quality Grade & Variety, (c) Distance in km from ${targetCity}, and (d) Farmer Rating & Review count, then give a concise recommendation (e.g. best value vs nearest vs highest rated).
4. Mention bulk minimum order (kg) and farmer's cancellation cutoff notice when relevant.
5. Keep responses crisp, structured, scannable (under 180 words unless detailed comparison is requested), and practical.`;

  try {
    const contents = [
      ...(history || []).slice(-6).map((h) => ({
        role: h.role,
        parts: [{ text: h.text }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    res.json({ reply: response.text || 'Unable to generate response right now.' });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Gemini API error:', errMsg);
    res.status(502).json({ error: `AI Advisor error: ${errMsg}` });
  }
});

// ==========================================
// 7. ADMIN PORTAL (STRICT ADMIN-ONLY ACCESS)
// ==========================================

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'anushreeekhande@gmail.com').trim().toLowerCase();
const ADMIN_PASSWORD_HASH = crypto
  .createHash('sha256')
  .update(process.env.ADMIN_PASSWORD || 'kisanmitraanu')
  .digest();

function getAuthenticatedAdmin(req: express.Request): { email: string } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const session = db
    .prepare('SELECT email, expiresAt FROM admin_sessions WHERE token = ?')
    .get(token) as { email: string; expiresAt: string } | undefined;

  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    return null;
  }
  return { email: session.email };
}

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPassword = password || '';

  const providedHash = crypto.createHash('sha256').update(cleanPassword).digest();
  const passwordValid =
    providedHash.length === ADMIN_PASSWORD_HASH.length &&
    crypto.timingSafeEqual(providedHash, ADMIN_PASSWORD_HASH);

  if (cleanEmail !== ADMIN_EMAIL || !passwordValid) {
    res.status(401).json({ error: 'Invalid admin email or password. Access restricted to Admin only.' });
    return;
  }

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 24 * 3600_000).toISOString();
  db.prepare('INSERT INTO admin_sessions (token, email, expiresAt) VALUES (?, ?, ?)').run(
    token,
    ADMIN_EMAIL,
    expiresAt
  );

  res.json({ token, admin: { email: ADMIN_EMAIL } });
});

app.post('/api/admin/firebase-login', async (req, res) => {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) {
    res.status(400).json({ error: 'Firebase ID token is required.' });
    return;
  }

  try {
    const verified = await verifyFirebaseIdToken(idToken);
    if (!verified.emailVerified || verified.email?.toLowerCase() !== ADMIN_EMAIL) {
      res.status(403).json({
        error: `Access denied. Only verified admin Google account (${ADMIN_EMAIL}) is authorized.`,
      });
      return;
    }

    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + 24 * 3600_000).toISOString();
    db.prepare('INSERT INTO admin_sessions (token, email, expiresAt) VALUES (?, ?, ?)').run(
      token,
      ADMIN_EMAIL,
      expiresAt
    );

    res.json({ token, admin: { email: ADMIN_EMAIL } });
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Google Sign-In admin verification failed.',
    });
  }
});

app.get('/api/admin/me', (req, res) => {
  const admin = getAuthenticatedAdmin(req);
  if (!admin) {
    res.status(401).json({ error: 'Admin authentication required' });
    return;
  }
  res.json({ admin });
});

app.post('/api/admin/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(authHeader.slice(7).trim());
  }
  res.json({ success: true });
});

app.get('/api/admin/overview', (req, res) => {
  const admin = getAuthenticatedAdmin(req);
  if (!admin) {
    res.status(403).json({ error: 'Admin access denied' });
    return;
  }

  const userRows = db
    .prepare('SELECT * FROM users ORDER BY createdAt DESC')
    .all() as Record<string, unknown>[];
  const users = userRows.map(rowToUser);

  const listingRows = db
    .prepare(
      `SELECT l.*, u.name as farmerName, u.farmName as farmName, u.city as farmerCity,
              u.area as farmerArea, u.phone as farmerPhone, u.lat as farmerLat, u.lng as farmerLng,
              u.isAvailable as farmerAvailable, u.ratingAvg as farmerRatingAvg, u.ratingCount as farmerRatingCount
       FROM listings l
       JOIN users u ON l.farmerId = u.id
       ORDER BY l.harvestedAt DESC`
    )
    .all() as Record<string, unknown>[];

  const orderRows = db
    .prepare(
      `SELECT o.*,
        c.name as customerName, c.phone as customerPhone,
        f.name as farmerName, f.farmName as farmName, f.phone as farmerPhone,
        d.name as deliveryAgentName, d.phone as deliveryAgentPhone, d.vehicleType as deliveryVehicle
       FROM orders o
       JOIN users c ON o.customerId = c.id
       JOIN users f ON o.farmerId = f.id
       LEFT JOIN users d ON o.deliveryAgentId = d.id
       ORDER BY o.createdAt DESC`
    )
    .all() as Record<string, unknown>[];
  const orders = enrichOrders(orderRows) as Array<Record<string, unknown> & { totalAmount: number }>;

  const stats = {
    totalUsers: users.length,
    customersCount: users.filter((u) => u.role === 'customer').length,
    farmersCount: users.filter((u) => u.role === 'farmer').length,
    deliveryCount: users.filter((u) => u.role === 'delivery').length,
    totalOrders: orders.length,
    activeOrders: orders.filter(
      (o) => String(o.status) !== 'delivered' && String(o.status) !== 'cancelled'
    ).length,
    deliveredOrders: orders.filter((o) => String(o.status) === 'delivered').length,
    totalRevenue: orders
      .filter((o) => String(o.status) !== 'cancelled')
      .reduce((acc, o) => acc + Number(o.totalAmount || 0), 0),
  };

  res.json({
    stats,
    users,
    listings: listingRows.map((r) => ({
      ...r,
      farmerAvailable: Boolean(r.farmerAvailable),
      isActive: Boolean(r.isActive),
      pricePerKg: Number(r.pricePerKg),
      minOrderKg: Number(r.minOrderKg),
      availableKg: Number(r.availableKg),
      cancellationCutoffHours: Number(r.cancellationCutoffHours),
      farmerRatingAvg: Number(r.farmerRatingAvg),
      farmerRatingCount: Number(r.farmerRatingCount),
    })),
    orders,
  });
});

app.post('/api/admin/users', (req, res) => {
  const admin = getAuthenticatedAdmin(req);
  if (!admin) {
    res.status(403).json({ error: 'Admin access denied' });
    return;
  }

  const { name, phone, role, city, area, farmName, vehicleType, language } = req.body as {
    name?: string;
    phone?: string;
    role?: UserRole;
    city?: string;
    area?: string;
    farmName?: string;
    vehicleType?: string;
    language?: Language;
  };

  const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
  if (!name || !name.trim() || cleanPhone.length !== 10) {
    res.status(400).json({ error: 'Full name and a valid 10-digit mobile number are required.' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(cleanPhone);
  if (existing) {
    res.status(409).json({ error: 'A user with this mobile number is already registered.' });
    return;
  }

  const targetRole: UserRole =
    role === 'farmer' || role === 'delivery' ? role : 'customer';
  const cityName = city || 'Pune';
  const hub = CITY_HUBS.find((h) => h.city === cityName) || CITY_HUBS[0];
  const latOffset = crypto.randomInt(-60, 60) / 1000;
  const lngOffset = crypto.randomInt(-60, 60) / 1000;
  const newId = `${targetRole}-${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(
    `INSERT INTO users (id, name, phone, role, city, area, lat, lng, language, isAvailable, farmName, vehicleType, ratingAvg, ratingCount, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId,
    name.trim(),
    cleanPhone,
    targetRole,
    cityName,
    (area || `${cityName} Central`).trim(),
    hub.lat + latOffset,
    hub.lng + lngOffset,
    language === 'mr' ? 'mr' : 'en',
    1,
    targetRole === 'farmer' ? (farmName || `${name.trim()} Farms`).trim() : null,
    targetRole === 'delivery' ? (vehicleType || 'Tata Ace Gold (1.5 Ton)').trim() : null,
    4.9,
    0,
    new Date().toISOString()
  );

  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(newId) as Record<string, unknown>;
  res.status(201).json({ user: rowToUser(created) });
});

app.patch('/api/admin/users/:id/availability', (req, res) => {
  const admin = getAuthenticatedAdmin(req);
  if (!admin) {
    res.status(403).json({ error: 'Admin access denied' });
    return;
  }

  const { isAvailable } = req.body as { isAvailable: boolean };
  db.prepare('UPDATE users SET isAvailable = ? WHERE id = ?').run(isAvailable ? 1 : 0, req.params.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!updated) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user: rowToUser(updated) });
});

app.post('/api/admin/orders', (req, res) => {
  const admin = getAuthenticatedAdmin(req);
  if (!admin) {
    res.status(403).json({ error: 'Admin access denied' });
    return;
  }

  const {
    customerId,
    listingId,
    quantityKg,
    paymentMethod,
    deliveryAddress,
    deliveryCity,
    deliveryAgentId,
    status,
  } = req.body as {
    customerId?: string;
    listingId?: string;
    quantityKg?: number;
    paymentMethod?: 'UPI' | 'Bank Transfer' | 'Bulk COD';
    deliveryAddress?: string;
    deliveryCity?: string;
    deliveryAgentId?: string;
    status?: string;
  };

  if (!customerId || !listingId || !quantityKg) {
    res.status(400).json({ error: 'Customer, produce listing, and quantity (kg) are required.' });
    return;
  }

  const customer = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(customerId) as Record<string, unknown> | undefined;
  if (!customer) {
    res.status(404).json({ error: 'Selected customer not found.' });
    return;
  }

  const listing = db
    .prepare(
      `SELECT l.*, u.lat as farmerLat, u.lng as farmerLng
       FROM listings l JOIN users u ON l.farmerId = u.id
       WHERE l.id = ?`
    )
    .get(listingId) as Record<string, unknown> | undefined;
  if (!listing) {
    res.status(404).json({ error: 'Selected produce listing not found.' });
    return;
  }

  const qty = Math.round(Number(quantityKg));
  if (qty < Number(listing.minOrderKg)) {
    res.status(400).json({
      error: `Minimum bulk order for this listing is ${listing.minOrderKg} kg.`,
    });
    return;
  }
  if (qty > Number(listing.availableKg)) {
    res.status(400).json({
      error: `Only ${listing.availableKg} kg available in stock.`,
    });
    return;
  }

  const targetCity = deliveryCity || String(customer.city || 'Pune');
  const hub = CITY_HUBS.find((h) => h.city === targetCity) || CITY_HUBS[0];
  const mandiRow = db
    .prepare('SELECT modalPricePerKg FROM mandi_prices WHERE city = ? AND productKey = ?')
    .get(targetCity, String(listing.productKey)) as { modalPricePerKg: number } | undefined;

  const mandiPricePerKg = mandiRow
    ? Number(mandiRow.modalPricePerKg)
    : Math.round(Number(listing.pricePerKg) * 1.35);

  const now = new Date();
  const scheduledDate = new Date(now.getTime() + 18 * 3600_000);
  const cutoffHours = Number(listing.cancellationCutoffHours || 2);
  const deadlineDate = new Date(scheduledDate.getTime() - cutoffHours * 3600_000);

  const distKm = haversineKm(hub.lat, hub.lng, Number(listing.farmerLat), Number(listing.farmerLng));
  const etaMinutes = Math.max(25, Math.round(distKm * 2.1));

  const orderId = `ord-${crypto.randomUUID().slice(0, 8)}`;
  const orderCode = `KM-2026-${crypto.randomInt(1100, 9999)}`;
  const totalAmount = Math.round(qty * Number(listing.pricePerKg));
  const method = paymentMethod || 'UPI';
  const paymentStatus = method === 'Bulk COD' ? 'Pending' : 'Paid';
  const initialStatus =
    deliveryAgentId && status === 'out_for_delivery'
      ? 'out_for_delivery'
      : status || 'accepted_by_farmer';
  const isoNow = now.toISOString();

  db.prepare(
    `INSERT INTO orders (
      id, orderCode, customerId, farmerId, deliveryAgentId, listingId,
      productKey, productNameEn, productNameMr, quantityKg, pricePerKg, mandiPricePerKg,
      totalAmount, paymentMethod, paymentStatus, status,
      scheduledDeliveryAt, cancellationCutoffHours, cancellationDeadlineAt,
      deliveryAddress, deliveryCity, customerLat, customerLng, farmerLat, farmerLng, agentLat, agentLng,
      etaMinutes, livePhotoUrl, livePhotoTimestamp, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orderId,
    orderCode,
    customerId,
    String(listing.farmerId),
    deliveryAgentId || null,
    listingId,
    String(listing.productKey),
    String(listing.productNameEn),
    String(listing.productNameMr),
    qty,
    Number(listing.pricePerKg),
    mandiPricePerKg,
    totalAmount,
    method,
    paymentStatus,
    initialStatus,
    scheduledDate.toISOString(),
    cutoffHours,
    deadlineDate.toISOString(),
    deliveryAddress?.trim() || `${customer.area}, ${targetCity}`,
    targetCity,
    Number(customer.lat || hub.lat),
    Number(customer.lng || hub.lng),
    Number(listing.farmerLat),
    Number(listing.farmerLng),
    Number(listing.farmerLat),
    Number(listing.farmerLng),
    etaMinutes,
    String(listing.livePhotoUrl),
    String(listing.livePhotoTimestamp),
    isoNow,
    isoNow
  );

  db.prepare('UPDATE listings SET availableKg = availableKg - ? WHERE id = ?').run(qty, listingId);

  const created = db
    .prepare(
      `SELECT o.*, c.name as customerName, c.phone as customerPhone,
       f.name as farmerName, f.farmName as farmName, f.phone as farmerPhone,
       d.name as deliveryAgentName, d.phone as deliveryAgentPhone, d.vehicleType as deliveryVehicle
       FROM orders o
       JOIN users c ON o.customerId = c.id
       JOIN users f ON o.farmerId = f.id
       LEFT JOIN users d ON o.deliveryAgentId = d.id
       WHERE o.id = ?`
    )
    .get(orderId) as Record<string, unknown>;

  res.status(201).json({ order: enrichOrders([created])[0] });
});

app.patch('/api/admin/orders/:id', (req, res) => {
  const admin = getAuthenticatedAdmin(req);
  if (!admin) {
    res.status(403).json({ error: 'Admin access denied' });
    return;
  }

  const existing = db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const { status, paymentStatus, deliveryAgentId } = req.body as {
    status?: string;
    paymentStatus?: 'Pending' | 'Paid';
    deliveryAgentId?: string | null;
  };

  const nextStatus = status || String(existing.status);
  const nextPay = paymentStatus || String(existing.paymentStatus);
  const nextAgent =
    deliveryAgentId !== undefined
      ? deliveryAgentId
      : (existing.deliveryAgentId as string | null);

  if (nextStatus === 'cancelled' && existing.status !== 'cancelled') {
    db.prepare('UPDATE listings SET availableKg = availableKg + ? WHERE id = ?').run(
      Number(existing.quantityKg),
      String(existing.listingId)
    );
  }

  db.prepare(
    `UPDATE orders SET status = ?, paymentStatus = ?, deliveryAgentId = ?, updatedAt = ? WHERE id = ?`
  ).run(nextStatus, nextPay, nextAgent, new Date().toISOString(), req.params.id);

  res.json({ success: true });
});

// ==========================================
// VITE DEV MIDDLEWARE / PRODUCTION STATIC
// ==========================================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kisan Mitra server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
