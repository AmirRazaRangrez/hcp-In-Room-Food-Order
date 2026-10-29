import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, addDoc, onSnapshot } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCtZnkdk1_q8rWrISnD8P2Rhi-jcPn1QTI",
  authDomain: "hotelcitypark-crm.firebaseapp.com",
  projectId: "hotelcitypark-crm",
  storageBucket: "hotelcitypark-crm.appspot.com",
  messagingSenderId: "1097702568918",
  appId: "1:1097702568918:web:7189115bc56209b552b972"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

/**
 * Loads the live menu, categories, and occupied rooms from Firebase Firestore single package doc.
 */
export async function getLiveDiningSession(token = '') {
  try {
    // 1. Fetch live menu & occupancy package from Firebase Firestore
    let pkg = {};
    const pkgDocRef = doc(db, 'room_charges_inbox', '00000000-0000-0000-0000-000000000088');
    const docSnap = await getDoc(pkgDocRef);

    if (docSnap.exists()) {
      const pkgData = docSnap.data();
      try {
        pkg = typeof pkgData.items_summary === 'string' ? JSON.parse(pkgData.items_summary) : (pkgData.items_summary || {});
      } catch (_) {}
    } else {
      // Fallback: check sync_meta/waiter_pkg
      const metaSnap = await getDoc(doc(db, 'sync_meta', 'waiter_pkg'));
      if (metaSnap.exists()) {
        const metaData = metaSnap.data();
        try {
          pkg = typeof metaData.pkgJson === 'string' ? JSON.parse(metaData.pkgJson) : (metaData.pkgJson || {});
        } catch (_) {}
      }
    }

    if (!pkg || Object.keys(pkg).length === 0) {
      throw new Error('Could not connect to hotel menu server. Please retry in a few moments.');
    }

    const menu = pkg.restaurantMenu || [];
    const categories = pkg.restaurantCategories || [];
    const occupiedRooms = pkg.occupiedRooms || [];
    const guestTokens = pkg.guestTokens || [];

    // 2. Identify guest from token or room
    let matchedGuest = null;
    let matchedRoom = '';
    let isCheckedOut = false;

    if (token) {
      // First check token in guestTokens list
      const matchedToken = guestTokens.find(gt => gt.token === token);
      if (matchedToken) {
        if (matchedToken.status && matchedToken.status !== 'active') {
          isCheckedOut = true;
        } else {
          matchedGuest = {
            name: matchedToken.guest_name,
            phone: matchedToken.mobile,
            roomNumbers: matchedToken.room_numbers,
            bookingId: matchedToken.booking_id
          };
          matchedRoom = String(matchedToken.room_numbers).split(',')[0].trim();
        }
      } else {
        // Token was passed via WhatsApp link but is not active in DB -> Guest is checked out
        isCheckedOut = true;
      }
    } else if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const roomParam = urlParams.get('room');
      if (roomParam) {
        const found = occupiedRooms.find(r => String(r.room_number) === String(roomParam));
        if (found) {
          matchedGuest = {
            name: found.guest_name,
            phone: found.guest_phone,
            roomNumbers: found.room_number,
            bookingId: found.booking_id
          };
          matchedRoom = String(found.room_number);
        } else {
          isCheckedOut = true;
        }
      }
    }

    // Default room fallback only if neither token nor room was requested (e.g. testing root URL)
    if (!token && !matchedGuest && !isCheckedOut) {
      if (occupiedRooms.length > 0) {
        const first = occupiedRooms[0];
        matchedGuest = {
          name: first.guest_name || 'In-House Guest',
          phone: first.guest_phone || '',
          roomNumbers: first.room_number,
          bookingId: first.booking_id
        };
        matchedRoom = String(first.room_number);
      } else {
        matchedGuest = { name: 'Hotel Guest', roomNumbers: '409' };
        matchedRoom = '409';
      }
    }

    return {
      success: true,
      checkedOut: isCheckedOut,
      guest: matchedGuest || { name: 'Hotel Guest', roomNumbers: '409' },
      targetRoom: matchedRoom || '409',
      menu,
      categories,
      occupiedRooms
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Places an in-room dining order directly into Firebase room_charges_inbox.
 * The hotel's local CRM Firestore real-time listener adopts this instantly (<100ms)
 * and broadcasts to local WebSockets for instant KOT auto-printing.
 */
export async function submitRoomOrder({ roomNumber, guestName, items, notes = '', token = '' }) {
  if (!roomNumber) throw new Error('Room number is required');
  if (!items || items.length === 0) throw new Error('Please select at least one item');

  let subtotal = 0;
  const cleanItems = items.map(it => {
    const qty = Math.max(1, parseInt(it.quantity || 1));
    const price = Math.max(0, parseFloat(it.price || 0));
    const lineTotal = price * qty;
    subtotal += lineTotal;
    return {
      id: it.id,
      name: it.name,
      category: it.category || '',
      price: price,
      quantity: qty,
      total: lineTotal,
      is_veg: it.is_veg !== undefined ? it.is_veg : 1,
      notes: it.notes || ''
    };
  });

  const gst = Math.round(subtotal * 0.05 * 100) / 100;
  const grandTotal = Math.round((subtotal + gst) * 100) / 100;
  const orderNumber = `RSCW-${roomNumber}-B${Date.now().toString().slice(-4)}`;

  const orderPayload = {
    room_number: String(roomNumber),
    room_id: 0,
    department: 'waiter_kot_order',
    bill_no: orderNumber,
    subtotal: subtotal,
    gst: gst,
    grand_total: grandTotal,
    settled_by: guestName || 'In-House Guest',
    items_summary: JSON.stringify({
      order_type: 'room_service',
      source: 'guest_inroom_mobile',
      order_source: 'web_link',
      is_guest_web: true,
      prefix: 'RSCW',
      waiter_name: 'Guest In-Room Mobile',
      customer_name: guestName || `Room ${roomNumber}`,
      token: token || '',
      notes: notes.trim(),
      items: cleanItems
    }),
    status: 'pending',
    created_at: new Date().toISOString()
  };

  const docRef = await addDoc(collection(db, 'room_charges_inbox'), orderPayload);

  return {
    success: true,
    cloudId: docRef.id,
    orderNumber,
    subtotal,
    gst,
    grandTotal,
    items: cleanItems,
    notes: notes.trim(),
    placedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
    placedDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    fullTimestamp: new Date().toISOString(),
    status: 'Received in Kitchen'
  };
}

/**
 * Checks live status of an order in Firebase Firestore room_charges_inbox
 */
export async function checkOrderStatus(billNo, cloudId) {
  try {
    if (!cloudId) return null;
    const docSnap = await getDoc(doc(db, 'room_charges_inbox', cloudId));
    if (!docSnap.exists()) return null;
    const data = docSnap.data();
    let summary = {};
    try {
      summary = typeof data.items_summary === 'string' ? JSON.parse(data.items_summary) : (data.items_summary || {});
    } catch (_) {}
    return {
      status: data.status,
      rejectionReason: summary.rejection_reason || summary.reason || '',
      cancelledAt: summary.cancelled_at || null,
      cancelledBy: summary.cancelled_by || null
    };
  } catch {
    return null;
  }
}
