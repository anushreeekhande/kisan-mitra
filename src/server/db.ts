import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import type { CityHub } from '../types.ts';

const DB_PATH = path.resolve(process.cwd(), 'kisan_mitra.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const CITY_HUBS: CityHub[] = [
  { city: 'Pune', mandiName: 'Gultekdi APMC Market Yard, Pune', lat: 18.5204, lng: 73.8567 },
  { city: 'Nashik', mandiName: 'Lasalgaon & Nashik APMC Mandi', lat: 19.9975, lng: 73.7898 },
  { city: 'Mumbai', mandiName: 'Vashi APMC Wholesale Market, Navi Mumbai', lat: 19.0760, lng: 72.8777 },
  { city: 'Nagpur', mandiName: 'Kalamna APMC Market, Nagpur', lat: 21.1458, lng: 79.0882 },
  { city: 'Kolhapur', mandiName: 'Shahu Market Yard APMC, Kolhapur', lat: 16.7050, lng: 74.2433 },
  { city: 'Satara', mandiName: 'Satara Agricultural Produce Mandi', lat: 17.6805, lng: 74.0183 },
];

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('customer', 'farmer', 'delivery')),
      city TEXT NOT NULL,
      area TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      isAvailable INTEGER NOT NULL DEFAULT 1,
      farmName TEXT,
      vehicleType TEXT,
      ratingAvg REAL NOT NULL DEFAULT 4.8,
      ratingCount INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      phone TEXT PRIMARY KEY,
      codeHash TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT,
      city TEXT,
      area TEXT,
      farmName TEXT,
      vehicleType TEXT,
      language TEXT DEFAULT 'en',
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mandi_prices (
      id TEXT PRIMARY KEY,
      productKey TEXT NOT NULL,
      productNameEn TEXT NOT NULL,
      productNameMr TEXT NOT NULL,
      category TEXT NOT NULL,
      city TEXT NOT NULL,
      mandiName TEXT NOT NULL,
      minPricePerKg REAL NOT NULL,
      modalPricePerKg REAL NOT NULL,
      maxPricePerKg REAL NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      farmerId TEXT NOT NULL,
      productKey TEXT NOT NULL,
      productNameEn TEXT NOT NULL,
      productNameMr TEXT NOT NULL,
      category TEXT NOT NULL,
      variety TEXT NOT NULL,
      pricePerKg REAL NOT NULL,
      minOrderKg INTEGER NOT NULL,
      availableKg INTEGER NOT NULL,
      qualityGrade TEXT NOT NULL,
      harvestedAt TEXT NOT NULL,
      livePhotoUrl TEXT NOT NULL,
      livePhotoTimestamp TEXT NOT NULL,
      cancellationCutoffHours INTEGER NOT NULL DEFAULT 2,
      description TEXT NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (farmerId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS photo_verifications (
      id TEXT PRIMARY KEY,
      customerId TEXT NOT NULL,
      farmerId TEXT NOT NULL,
      listingId TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'sent')),
      requestedAt TEXT NOT NULL,
      photoDataUrl TEXT,
      photoTimestamp TEXT,
      farmerNote TEXT,
      FOREIGN KEY (customerId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (farmerId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (listingId) REFERENCES listings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      orderCode TEXT UNIQUE NOT NULL,
      customerId TEXT NOT NULL,
      farmerId TEXT NOT NULL,
      deliveryAgentId TEXT,
      listingId TEXT NOT NULL,
      productKey TEXT NOT NULL,
      productNameEn TEXT NOT NULL,
      productNameMr TEXT NOT NULL,
      quantityKg INTEGER NOT NULL,
      pricePerKg REAL NOT NULL,
      mandiPricePerKg REAL NOT NULL,
      totalAmount REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      paymentStatus TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduledDeliveryAt TEXT NOT NULL,
      cancellationCutoffHours INTEGER NOT NULL,
      cancellationDeadlineAt TEXT NOT NULL,
      deliveryAddress TEXT NOT NULL,
      deliveryCity TEXT NOT NULL,
      customerLat REAL NOT NULL,
      customerLng REAL NOT NULL,
      farmerLat REAL NOT NULL,
      farmerLng REAL NOT NULL,
      agentLat REAL NOT NULL,
      agentLng REAL NOT NULL,
      etaMinutes INTEGER NOT NULL,
      livePhotoUrl TEXT NOT NULL,
      livePhotoTimestamp TEXT NOT NULL,
      ratingScore INTEGER,
      ratingReview TEXT,
      deliveryRatingScore INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (customerId) REFERENCES users(id),
      FOREIGN KEY (farmerId) REFERENCES users(id),
      FOREIGN KEY (listingId) REFERENCES listings(id)
    );

    CREATE TABLE IF NOT EXISTS declined_deliveries (
      orderId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      declinedAt TEXT NOT NULL,
      PRIMARY KEY (orderId, agentId)
    );

    CREATE TABLE IF NOT EXISTS price_alerts (
      id TEXT PRIMARY KEY,
      customerId TEXT NOT NULL,
      productKey TEXT NOT NULL,
      productNameEn TEXT NOT NULL,
      productNameMr TEXT NOT NULL,
      city TEXT NOT NULL,
      targetPricePerKg REAL NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (customerId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      alertId TEXT,
      listingId TEXT,
      productKey TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      farmerPricePerKg REAL NOT NULL,
      targetPricePerKg REAL NOT NULL,
      isRead INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (userCount.cnt === 0) {
    seedInitialData();
  }
}

function seedInitialData() {
  const now = new Date();
  const isoNow = now.toISOString();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  const hoursAhead = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, phone, role, city, area, lat, lng, language, isAvailable, farmName, vehicleType, ratingAvg, ratingCount, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Seed Farmers
  insertUser.run('farmer-1', 'Ramesh Patil', '9822011101', 'farmer', 'Pune', 'Narayangaon, Junnar', 19.1206, 73.9722, 'mr', 1, 'Sahyadri Organic Farms', null, 4.9, 42, isoNow);
  insertUser.run('farmer-2', 'Suresh Deshmukh', '9822011102', 'farmer', 'Pune', 'Baramati Agro Belt', 18.1517, 74.5768, 'mr', 1, 'Deshmukh Krishi Kendra', null, 4.7, 29, isoNow);
  insertUser.run('farmer-3', 'Anita Pawar', '9822011103', 'farmer', 'Pune', 'Saswad Purandar', 18.3444, 74.0309, 'mr', 1, 'Purandar Fresh Harvest', null, 4.8, 35, isoNow);
  insertUser.run('farmer-4', 'Vijay Kale', '9822011104', 'farmer', 'Nashik', 'Niphad, Nashik', 20.0757, 74.1079, 'mr', 1, 'Godavari Onion & Grape Farms', null, 4.9, 58, isoNow);
  insertUser.run('farmer-5', 'Mahesh Shinde', '9822011105', 'farmer', 'Satara', 'Wai Valley', 17.9531, 73.8919, 'mr', 1, 'Krishna Valley Growers', null, 4.6, 19, isoNow);
  insertUser.run('farmer-6', 'Kavita Jadhav', '9822011106', 'farmer', 'Kolhapur', 'Panhala Foothills', 16.8114, 74.1069, 'mr', 0, 'Sahyadri Fruit Orchards', null, 4.8, 24, isoNow);

  // Seed Customers (Bulk buyers: hotels, supermarkets, housing societies, caterers)
  insertUser.run('cust-1', 'Priya Kulkarni', '9823022201', 'customer', 'Pune', 'Kothrud Bulk Buyers Co-op', 18.5074, 73.8077, 'en', 1, null, null, 4.9, 14, isoNow);
  insertUser.run('cust-2', 'Vikram Joshi', '9823022202', 'customer', 'Mumbai', 'Dadar Catering & Mart', 19.0178, 72.8478, 'en', 1, null, null, 4.8, 9, isoNow);

  // Seed Delivery Agents
  insertUser.run('agent-1', 'Santosh More', '9824033301', 'delivery', 'Pune', 'Katraj Logistics Hub', 18.4575, 73.8677, 'mr', 1, null, 'Tata Ace Gold (1.5 Ton)', 4.9, 64, isoNow);
  insertUser.run('agent-2', 'Ganesh Bhosale', '9824033302', 'delivery', 'Nashik', 'Dwarka Transport Point', 19.9920, 73.7995, 'mr', 1, null, 'Mahindra Bolero Pik-Up (1.7 Ton)', 4.8, 37, isoNow);

  // Seed Today's Real Standard APMC Mandi Prices across cities
  const products = [
    { key: 'tomato', en: 'Vine Tomatoes', mr: 'टोमॅटो', cat: 'Vegetables', baseModal: 34 },
    { key: 'onion', en: 'Nashik Red Onions', mr: 'लाल कांदा', cat: 'Vegetables', baseModal: 38 },
    { key: 'potato', en: 'Talegaon Potatoes', mr: 'बटाटा', cat: 'Vegetables', baseModal: 28 },
    { key: 'pomegranate', en: 'Bhagwa Pomegranates', mr: 'भगवा डाळिंब', cat: 'Fruits', baseModal: 132 },
    { key: 'mango', en: 'Alphonso Mangoes', mr: 'हापूस आंबा', cat: 'Fruits', baseModal: 290 },
    { key: 'okra', en: 'Tender Green Okra', mr: 'भेंडी', cat: 'Vegetables', baseModal: 48 },
    { key: 'spinach', en: 'Fresh Palak Spinach', mr: 'ताजा पालक', cat: 'Leafy Greens', baseModal: 30 },
    { key: 'green_chilli', en: 'G4 Green Chillies', mr: 'हिरवी मिरची', cat: 'Vegetables', baseModal: 56 },
  ];

  const insertMandi = db.prepare(`
    INSERT INTO mandi_prices (id, productKey, productNameEn, productNameMr, category, city, mandiName, minPricePerKg, modalPricePerKg, maxPricePerKg, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const hub of CITY_HUBS) {
    const cityFactor =
      hub.city === 'Mumbai' ? 1.15 :
      hub.city === 'Pune' ? 1.04 :
      hub.city === 'Nagpur' ? 1.02 :
      hub.city === 'Nashik' ? 0.94 :
      hub.city === 'Kolhapur' ? 0.98 : 0.96;

    for (const p of products) {
      const modal = Math.round(p.baseModal * cityFactor);
      const min = Math.max(10, Math.round(modal * 0.85));
      const max = Math.round(modal * 1.18);
      insertMandi.run(
        `mandi-${hub.city.toLowerCase()}-${p.key}`,
        p.key,
        p.en,
        p.mr,
        p.cat,
        hub.city,
        hub.mandiName,
        min,
        modal,
        max,
        isoNow
      );
    }
  }

  // Seed Bulk Produce Listings
  const insertListing = db.prepare(`
    INSERT INTO listings (id, farmerId, productKey, productNameEn, productNameMr, category, variety, pricePerKg, minOrderKg, availableKg, qualityGrade, harvestedAt, livePhotoUrl, livePhotoTimestamp, cancellationCutoffHours, description, isActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertListing.run(
    'list-1', 'farmer-1', 'tomato', 'Vine Tomatoes', 'टोमॅटो', 'Vegetables', 'Vaishali Hybrid',
    24, 50, 1400, 'Grade A+ Export', hoursAgo(3), 'tomato', hoursAgo(1), 2,
    'Morning-picked firm red tomatoes packed in 25kg ventilated crates. Zero middlemen.', 1
  );
  insertListing.run(
    'list-2', 'farmer-3', 'tomato', 'Vine Tomatoes', 'टोमॅटो', 'Vegetables', 'Desi Abhinav',
    22, 40, 950, 'Grade A Farm Fresh', hoursAgo(4), 'tomato', hoursAgo(2), 2,
    'Juicy Purandar valley tomatoes, sorted by uniform color and size for catering & retail.', 1
  );
  insertListing.run(
    'list-3', 'farmer-4', 'tomato', 'Vine Tomatoes', 'टोमॅटो', 'Vegetables', 'Nashik Red Roma',
    21, 100, 2600, 'Grade A Farm Fresh', hoursAgo(5), 'tomato', hoursAgo(2), 4,
    'Bulk Roma tomatoes ideal for wholesale kitchens, gravies, and supermarket distribution.', 1
  );
  insertListing.run(
    'list-4', 'farmer-4', 'onion', 'Nashik Red Onions', 'लाल कांदा', 'Vegetables', 'Lasalgaon Garva',
    27, 100, 5000, 'Grade A+ Export', hoursAgo(6), 'onion', hoursAgo(1), 4,
    'Cured dry-skin Nashik red onions packed in 50kg breathable mesh jute bags.', 1
  );
  insertListing.run(
    'list-5', 'farmer-2', 'onion', 'Nashik Red Onions', 'लाल कांदा', 'Vegetables', 'Puna Fursungi',
    29, 50, 2200, 'Grade A Farm Fresh', hoursAgo(5), 'onion', hoursAgo(3), 3,
    'Medium-large sorted red onions with long shelf life, ready for immediate loading.', 1
  );
  insertListing.run(
    'list-6', 'farmer-1', 'potato', 'Talegaon Potatoes', 'बटाटा', 'Vegetables', 'Kufri Jyoti',
    20, 50, 3200, 'Grade A Farm Fresh', hoursAgo(8), 'potato', hoursAgo(2), 2,
    'Clean soil-brushed Kufri Jyoti potatoes, uniform medium size for hotels & stores.', 1
  );
  insertListing.run(
    'list-7', 'farmer-2', 'pomegranate', 'Bhagwa Pomegranates', 'भगवा डाळिंब', 'Fruits', 'Solapur Bhagwa',
    98, 30, 800, 'Grade A+ Export', hoursAgo(4), 'pomegranate', hoursAgo(1), 3,
    'Deep ruby arils, sweet 16+ Brix grade pomegranates in 10kg cushioned export cartons.', 1
  );
  insertListing.run(
    'list-8', 'farmer-5', 'mango', 'Alphonso Mangoes', 'हापूस आंबा', 'Fruits', 'Devgad Carbide-Free',
    215, 25, 650, 'Grade A+ Export', hoursAgo(3), 'mango', hoursAgo(1), 4,
    'Naturally hay-ripened Alphonso mangoes harvested at maturity, packed in wooden petis.', 1
  );
  insertListing.run(
    'list-9', 'farmer-3', 'okra', 'Tender Green Okra', 'भेंडी', 'Vegetables', 'Mahyco No. 10',
    35, 30, 520, 'Grade A+ Export', hoursAgo(2), 'okra', hoursAgo(1), 2,
    'Snappy tender green okra harvested before 6 AM, zero fiber, cooled immediately.', 1
  );
  insertListing.run(
    'list-10', 'farmer-1', 'spinach', 'Fresh Palak Spinach', 'ताजा पालक', 'Leafy Greens', 'All-Green Organic',
    19, 25, 420, 'Grade A Farm Fresh', hoursAgo(2), 'spinach', hoursAgo(1), 2,
    'Pesticide-free broad-leaf spinach tied in 1kg commercial bundles, dew-washed.', 1
  );
  insertListing.run(
    'list-11', 'farmer-5', 'green_chilli', 'G4 Green Chillies', 'हिरवी मिरची', 'Vegetables', 'Teja G4',
    41, 25, 700, 'Grade A Farm Fresh', hoursAgo(3), 'green_chilli', hoursAgo(2), 3,
    'High-pungency glossy dark green chillies packed in 25kg perforated sacks.', 1
  );
  insertListing.run(
    'list-12', 'farmer-6', 'pomegranate', 'Bhagwa Pomegranates', 'भगवा डाळिंब', 'Fruits', 'Panhala Ruby',
    94, 40, 900, 'Grade A Farm Fresh', hoursAgo(6), 'pomegranate', hoursAgo(4), 6,
    'Sweet orchard-direct Bhagwa pomegranates, currently off-season pause toggled by farmer.', 1
  );

  // Seed Orders:
  // 1) Past delivered order between cust-1 (Priya) & farmer-1 (Ramesh) so cust-1 is a REPEAT customer with farmer-1!
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      id, orderCode, customerId, farmerId, deliveryAgentId, listingId,
      productKey, productNameEn, productNameMr, quantityKg, pricePerKg, mandiPricePerKg,
      totalAmount, paymentMethod, paymentStatus, status,
      scheduledDeliveryAt, cancellationCutoffHours, cancellationDeadlineAt,
      deliveryAddress, deliveryCity, customerLat, customerLng, farmerLat, farmerLng, agentLat, agentLng,
      etaMinutes, livePhotoUrl, livePhotoTimestamp, ratingScore, ratingReview, deliveryRatingScore,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertOrder.run(
    'ord-1001', 'KM-2026-1001', 'cust-1', 'farmer-1', 'agent-1', 'list-1',
    'tomato', 'Vine Tomatoes', 'टोमॅटो', 100, 24, 35,
    2400, 'UPI', 'Paid', 'delivered',
    hoursAgo(48), 2, hoursAgo(50),
    'Shop 14, Kothrud Vegetable Mart, Pune', 'Pune', 18.5074, 73.8077, 19.1206, 73.9722, 18.5074, 73.8077,
    0, 'tomato', hoursAgo(51), 5, 'Crisp morning-picked tomatoes, zero spoilage in 100kg batch.', 5,
    hoursAgo(54), hoursAgo(48)
  );

  // 2) Active out_for_delivery order for cust-1 (Priya) with live location tracking
  insertOrder.run(
    'ord-1042', 'KM-2026-1042', 'cust-1', 'farmer-3', 'agent-1', 'list-9',
    'okra', 'Tender Green Okra', 'भेंडी', 60, 35, 50,
    2100, 'UPI', 'Paid', 'out_for_delivery',
    hoursAhead(1), 2, hoursAgo(1),
    'Shop 14, Kothrud Vegetable Mart, Pune', 'Pune', 18.5074, 73.8077, 18.3444, 74.0309, 18.4310, 73.9120,
    28, 'okra', hoursAgo(2), null, null, null,
    hoursAgo(4), isoNow
  );

  // 3) Pending delivery request (accepted_by_farmer) ready for Delivery Agents to Take or Decline!
  insertOrder.run(
    'ord-1048', 'KM-2026-1048', 'cust-1', 'farmer-1', null, 'list-6',
    'potato', 'Talegaon Potatoes', 'बटाटा', 150, 20, 29,
    3000, 'Bulk COD', 'Pending', 'accepted_by_farmer',
    hoursAhead(14), 2, hoursAhead(12),
    'Shop 14, Kothrud Vegetable Mart, Pune', 'Pune', 18.5074, 73.8077, 19.1206, 73.9722, 19.1206, 73.9722,
    85, 'potato', hoursAgo(1), null, null, null,
    hoursAgo(1), isoNow
  );

  // 4) Newly placed order waiting for farmer-2 acceptance (cancellable by customer!)
  insertOrder.run(
    'ord-1051', 'KM-2026-1051', 'cust-1', 'farmer-2', null, 'list-7',
    'pomegranate', 'Bhagwa Pomegranates', 'भगवा डाळिंब', 40, 98, 137,
    3920, 'UPI', 'Paid', 'placed',
    hoursAhead(18), 3, hoursAhead(15),
    'Shop 14, Kothrud Vegetable Mart, Pune', 'Pune', 18.5074, 73.8077, 18.1517, 74.5768, 18.1517, 74.5768,
    110, 'pomegranate', hoursAgo(1), null, null, null,
    hoursAgo(0.5), isoNow
  );

  // Seed one pre-existing sent photo verification for Priya + Farmer-3 (list-9)
  db.prepare(`
    INSERT INTO photo_verifications (id, customerId, farmerId, listingId, status, requestedAt, photoDataUrl, photoTimestamp, farmerNote)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'pv-1', 'cust-1', 'farmer-3', 'list-9', 'sent', hoursAgo(5),
    'okra', hoursAgo(4.5), 'Fresh 6 AM harvest batch ready in bamboo crates.'
  );
}

export function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(24).toString('hex');
}
