export type UserRole = 'customer' | 'farmer' | 'delivery';
export type Language = 'en' | 'mr';

export interface User {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  city: string;
  area: string;
  lat: number;
  lng: number;
  language: Language;
  isAvailable: boolean;
  farmName?: string | null;
  vehicleType?: string | null;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
}

export interface MandiPrice {
  id: string;
  productKey: string;
  productNameEn: string;
  productNameMr: string;
  category: 'Vegetables' | 'Fruits' | 'Leafy Greens';
  city: string;
  mandiName: string;
  minPricePerKg: number;
  modalPricePerKg: number;
  maxPricePerKg: number;
  updatedAt: string;
}

export interface ProduceListing {
  id: string;
  farmerId: string;
  farmerName: string;
  farmName: string;
  farmerCity: string;
  farmerArea: string;
  farmerPhone: string;
  farmerLat: number;
  farmerLng: number;
  farmerAvailable: boolean;
  farmerRatingAvg: number;
  farmerRatingCount: number;
  productKey: string;
  productNameEn: string;
  productNameMr: string;
  category: 'Vegetables' | 'Fruits' | 'Leafy Greens';
  variety: string;
  pricePerKg: number;
  minOrderKg: number;
  availableKg: number;
  qualityGrade: 'Grade A+ Export' | 'Grade A Farm Fresh' | 'Grade B Standard';
  harvestedAt: string;
  livePhotoUrl: string;
  livePhotoTimestamp: string;
  cancellationCutoffHours: number;
  description: string;
  isActive: boolean;
  distanceKm?: number;
  mandiModalPrice?: number;
  mandiMinPrice?: number;
  mandiMaxPrice?: number;
  mandiName?: string;
  savingsPercent?: number;
}

export interface PhotoVerification {
  id: string;
  customerId: string;
  customerName?: string;
  farmerId: string;
  farmerName?: string;
  listingId: string;
  productNameEn?: string;
  productNameMr?: string;
  status: 'pending' | 'sent';
  requestedAt: string;
  photoDataUrl?: string | null;
  photoTimestamp?: string | null;
  farmerNote?: string | null;
}

export type OrderStatus =
  | 'placed'
  | 'accepted_by_farmer'
  | 'awaiting_delivery'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface Order {
  id: string;
  orderCode: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  farmerId: string;
  farmerName?: string;
  farmName?: string;
  farmerPhone?: string;
  deliveryAgentId?: string | null;
  deliveryAgentName?: string | null;
  deliveryAgentPhone?: string | null;
  deliveryVehicle?: string | null;
  listingId: string;
  productKey: string;
  productNameEn: string;
  productNameMr: string;
  quantityKg: number;
  pricePerKg: number;
  mandiPricePerKg: number;
  totalAmount: number;
  paymentMethod: 'UPI' | 'Bank Transfer' | 'Bulk COD';
  paymentStatus: 'Pending' | 'Paid';
  status: OrderStatus;
  scheduledDeliveryAt: string;
  cancellationCutoffHours: number;
  cancellationDeadlineAt: string;
  deliveryAddress: string;
  deliveryCity: string;
  customerLat: number;
  customerLng: number;
  farmerLat: number;
  farmerLng: number;
  agentLat: number;
  agentLng: number;
  etaMinutes: number;
  livePhotoUrl: string;
  livePhotoTimestamp: string;
  ratingScore?: number | null;
  ratingReview?: string | null;
  deliveryRatingScore?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CityHub {
  city: string;
  mandiName: string;
  lat: number;
  lng: number;
}

export interface PriceAlert {
  id: string;
  customerId: string;
  productKey: string;
  productNameEn: string;
  productNameMr: string;
  city: string;
  targetPricePerKg: number;
  isActive: boolean;
  createdAt: string;
}

export interface PriceNotification {
  id: string;
  userId: string;
  alertId?: string | null;
  listingId?: string | null;
  productKey: string;
  title: string;
  message: string;
  farmerPricePerKg: number;
  targetPricePerKg: number;
  isRead: boolean;
  createdAt: string;
}

