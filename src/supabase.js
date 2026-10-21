import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hlwmsllmqfdxfmqulrat.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzc4MzgsImV4cCI6MjEwNTMxMzgzOH0.r7Nb8rEJTrZvprpf4G023nMY0suq2OqVGetG0I8esjk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Loads the live menu, categories, and occupied rooms from the cloud package.
 */
export async function getLiveDiningSession(token = '') {
  try {
    // 1. Fetch live menu & occupancy package from Supabase
    const { data: pkgRow, error: pkgErr } = await supabase
      .from('room_charges_inbox')
      .select('items_summary')
      .eq('id', '00000000-0000-0000-0000-000000000088')
      .single();

    if (pkgErr || !pkgRow) {
      throw new Error('Could not connect to hotel menu server. Please retry in a few moments.');
    }

    let pkg = {};
    try {
      pkg = JSON.parse(pkgRow.items_summary);
    } catch (_) {}

    const menu = pkg.restaurantMenu || [];
    const categories = pkg.restaurantCategories || [];
    const occupiedRooms = pkg.occupiedRooms || [];
    const guestTokens = pkg.guestTokens || [];

    // 2. Identify guest from token or room
    let matchedGuest = null;
    let matchedRoom = '';

    if (token) {
      // First check token in guestTokens list
      const matchedToken = guestTokens.find(gt => gt.token === token);
      if (matchedToken) {
        matchedGuest = {
          name: matchedToken.guest_name,
          phone: matchedToken.mobile,
          roomNumbers: matchedToken.room_numbers,
          bookingId: matchedToken.booking_id
        };
        matchedRoom = String(matchedToken.room_numbers).split(',')[0].trim();
      }
    }

    // Fallback: check query parameter ?room=409
    if (!matchedGuest && typeof window !== 'undefined') {
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
        }
      }
    }

    // Default room fallback if guest is in-house
    if (!matchedGuest && occupiedRooms.length > 0) {
      const first = occupiedRooms[0];
      matchedGuest = {
        name: first.guest_name || 'In-House Guest',
        phone: first.guest_phone || '',
        roomNumbers: first.room_number,
        bookingId: first.booking_id
      };
      matchedRoom = String(first.room_number);
    }

    return {
      success: true,
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
 * Places an in-room dining order directly into Supabase room_charges_inbox.
 * The hotel's local CRM WebSocket detects this instantly and prints the KOT.
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
  const orderNumber = `RS-${roomNumber}-B${Date.now().toString().slice(-4)}`;

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
      waiter_name: 'Guest In-Room Mobile',
      customer_name: guestName || `Room ${roomNumber}`,
      token: token || '',
      notes: notes.trim(),
      items: cleanItems
    }),
    status: 'pending'
  };

  const { data, error } = await supabase
    .from('room_charges_inbox')
    .insert([orderPayload])
    .select();

  if (error) {
    throw new Error('Failed to send order to kitchen: ' + error.message);
  }

  return {
    success: true,
    orderNumber,
    subtotal,
    gst,
    grandTotal,
    items: cleanItems,
    placedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  };
}
