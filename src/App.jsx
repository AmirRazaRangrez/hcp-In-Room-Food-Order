import React, { useState, useEffect, useMemo } from 'react';
import { getLiveDiningSession, submitRoomOrder, checkOrderStatus } from './firebase';

/**
 * Calculates preparation time based on total bill amount:
 * ₹1-200 -> 15 mins
 * ₹200-500 -> 20 mins
 * ₹500-1000 -> 25 mins
 * ₹1000-3000 -> +35 mins
 */
function getEstimatedPrepTime(totalAmount) {
  const amt = Math.round(Number(totalAmount) || 0);
  if (amt <= 200) return '15 mins';
  if (amt <= 500) return '20 mins';
  if (amt <= 1000) return '25 mins';
  return '+35 mins';
}

/**
 * Determines real-time kitchen operating status & required popup modal:
 * - 11:00 AM to 10:45 PM: Room Service OPEN
 * - 7:00 AM to 10:30 AM: Complimentary Breakfast modal at Jashn Hall (Ordering unavailable)
 * - 10:46 PM to 10:59 AM: Room Service Unavailable modal (Ordering unavailable)
 */
function getKitchenTimingInfo() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();

  // Breakfast Window: 7:00 AM (420 mins) to 10:30 AM (630 mins)
  if (minutes >= 420 && minutes <= 630) {
    return {
      isOpen: false,
      type: 'BREAKFAST',
      badge: 'Breakfast Hours (7:00 AM – 10:30 AM)',
      heading: 'Complimentary Breakfast',
      lines: [
        'Complimentary Breakfast',
        'Is Served at',
        'Jashn Hall at Ground Floor',
        'from 8:00am to 10:30am'
      ],
      noticeText: 'Room Service Currently Unavailable\nIn Room Dinning Available From 11:00am to 10:45pm Only'
    };
  }

  // Active Kitchen Ordering Window: 11:00 AM (660 mins) to 10:45 PM (1365 mins)
  if (minutes >= 660 && minutes <= 1365) {
    return {
      isOpen: true,
      type: 'OPEN',
      badge: 'Kitchen Open (11:00 AM – 10:45 PM)',
      heading: 'In-Room Dining Open',
      lines: [],
      noticeText: ''
    };
  }

  // Off-Hours: 10:46 PM (1366 mins) to 10:59 AM (659 mins) outside 7:00-10:30 AM
  return {
    isOpen: false,
    type: 'CLOSED',
    badge: 'Room Service Closed (Opens 11:00 AM)',
    heading: 'Room Service Currently Unavailable',
    lines: [
      'Room Service Currently Unavailable',
      'In Room Dinning',
      'Available From 11:00am to 10:45pm Only'
    ],
    noticeText: 'You can freely browse our full menu dishes below. Ordering will open at 11:00 AM.'
  };
}

export default function App() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

  // Real-time kitchen operating status
  const timingInfo = useMemo(() => getKitchenTimingInfo(), []);

  // Time-based modal popup (shown automatically on closed / breakfast hours)
  const [showTimingModal, setShowTimingModal] = useState(() => !timingInfo.isOpen);

  // Active Screen: 'menu' or 'orders'
  const [activeTab, setActiveTab] = useState('menu');

  // Filter & Search states
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [vegOnly, setVegOnly] = useState(false);

  // Cart: { [dishId]: { dish, quantity, notes } }
  const [cart, setCart] = useState({});
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('409');

  // Terms agreement checkbox gate (Must be checked before placing order)
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Submission & Post-order confirmation state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

  // Placed Orders (persisted in localStorage by room/guest)
  const [placedOrders, setPlacedOrders] = useState(() => {
    try {
      const saved = localStorage.getItem('hcp_orders_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Save placed orders to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('hcp_orders_history', JSON.stringify(placedOrders));
    } catch (_) {}
  }, [placedOrders]);

  // Live status tracking for placed orders
  useEffect(() => {
    if (!placedOrders || placedOrders.length === 0) return;
    const interval = setInterval(async () => {
      let changed = false;
      const updatedList = await Promise.all(
        placedOrders.map(async (ord) => {
          if (ord.status === 'cancelled') return ord;
          const statusInfo = await checkOrderStatus(ord.orderNumber, ord.cloudId);
          if (statusInfo && statusInfo.status === 'cancelled') {
            changed = true;
            return {
              ...ord,
              status: 'cancelled',
              rejectionReason: statusInfo.rejectionReason || 'restaurant_closed',
              cancelledAt: statusInfo.cancelledAt
            };
          }
          return ord;
        })
      );
      if (changed) {
        setPlacedOrders(updatedList);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [placedOrders]);

  // Extract token & room from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token') || '';
    const r = params.get('room') || '';
    setToken(t);
    if (r) setSelectedRoom(r);
  }, []);

  // Fetch live session & menu from Firebase
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);
      const res = await getLiveDiningSession(token);
      if (res.success) {
        setSession(res);
        if (res.targetRoom) setSelectedRoom(res.targetRoom);
      } else {
        setError(res.error || 'Failed to load hotel menu.');
      }
      setLoading(false);
    }
    loadData();
  }, [token]);

  // Derived category list with counts
  const categoryList = useMemo(() => {
    if (!session?.menu) return ['ALL'];
    const cats = new Set(session.menu.map(d => (d.category || 'General').trim()).filter(Boolean));
    return ['ALL', ...Array.from(cats)];
  }, [session?.menu]);

  // Filtered dishes
  const filteredDishes = useMemo(() => {
    if (!session?.menu) return [];
    return session.menu.filter(dish => {
      if (activeCategory !== 'ALL' && (dish.category || '').toLowerCase() !== activeCategory.toLowerCase()) {
        return false;
      }
      if (vegOnly && dish.is_veg === 0) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = String(dish.name || '').toLowerCase().includes(q);
        const matchesCat = String(dish.category || '').toLowerCase().includes(q);
        if (!matchesName && !matchesCat) return false;
      }
      return true;
    });
  }, [session?.menu, activeCategory, vegOnly, searchQuery]);

  // Cart operations
  const handleAddToCart = (dish) => {
    if (!timingInfo.isOpen) {
      setShowTimingModal(true);
      return;
    }
    setCart(prev => {
      const cur = prev[dish.id] ? prev[dish.id].quantity : 0;
      return {
        ...prev,
        [dish.id]: {
          dish,
          quantity: cur + 1,
          notes: prev[dish.id]?.notes || ''
        }
      };
    });
  };

  const handleUpdateQuantity = (dishId, delta) => {
    setCart(prev => {
      const cur = prev[dishId] ? prev[dishId].quantity : 0;
      const next = cur + delta;
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[dishId];
        return copy;
      }
      return {
        ...prev,
        [dishId]: { ...prev[dishId], quantity: next }
      };
    });
  };

  const handleItemNoteChange = (dishId, note) => {
    setCart(prev => {
      if (!prev[dishId]) return prev;
      return {
        ...prev,
        [dishId]: { ...prev[dishId], notes: note }
      };
    });
  };

  // Cart aggregates
  const cartItems = Object.values(cart);
  const totalCount = cartItems.reduce((acc, it) => acc + it.quantity, 0);
  const cartSubtotal = cartItems.reduce((acc, it) => acc + (parseFloat(it.dish.price || 0) * it.quantity), 0);
  const cartGst = Math.round(cartSubtotal * 0.05 * 100) / 100;
  const cartGrandTotal = Math.round((cartSubtotal + cartGst) * 100) / 100;
  const cartRoundedTotal = Math.round(cartGrandTotal);
  const currentEstimatedPrep = getEstimatedPrepTime(cartRoundedTotal);

  // Submit order to kitchen
  const handleSendOrder = async () => {
    if (cartItems.length === 0 || isSubmitting) return;
    if (!timingInfo.isOpen) {
      setShowTimingModal(true);
      return;
    }
    if (!agreedToTerms) {
      alert('Please check the "I agree" box before placing your order.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        roomNumber: selectedRoom || '409',
        guestName: session?.guest?.name || 'In-House Guest',
        items: cartItems.map(it => ({
          id: it.dish.id,
          name: it.dish.name,
          category: it.dish.category,
          price: it.dish.price,
          quantity: it.quantity,
          is_veg: it.dish.is_veg,
          notes: it.notes || ''
        })),
        notes: orderNotes.trim(),
        token: token
      };

      const result = await submitRoomOrder(payload);
      result.estimatedPrep = currentEstimatedPrep;
      setLastOrder(result);
      setPlacedOrders(prev => [result, ...prev]);
      setCart({});
      setShowCartDrawer(false);
      setOrderNotes('');
      setAgreedToTerms(false);
    } catch (err) {
      alert('Error placing order: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==========================================================
  // VIEW: LOADING SCREEN
  // ==========================================================
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center'
      }}>
        <div style={{
          width: '52px',
          height: '52px',
          border: '4px solid #e2e8f0',
          borderTop: '4px solid #8c5d77',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          marginBottom: '20px'
        }} />
        <img
          src="/hcp-logo-with-name-transparent.png"
          alt="Hotel City Park Solapur"
          style={{ height: '48px', width: 'auto', marginBottom: '12px', objectFit: 'contain' }}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = '/logo.png';
          }}
        />
        <h3 style={{ margin: '0 0 6px', color: '#0f172a', fontWeight: 800 }}>Hotel City Park Solapur</h3>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>Connecting to room service...</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ==========================================================
  // VIEW: CHECKED-OUT GUEST SCREEN (EXACT SPEC)
  // When guest has checked out & clicks WhatsApp link:
  // Shows Hotel logo with thanking message to Choose Hotel City Park
  // ==========================================================
  if (session?.checkedOut) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        textAlign: 'center'
      }}>
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '24px',
          padding: '36px 24px',
          maxWidth: '440px',
          width: '100%',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.05)',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          {/* Hotel Logo with Name */}
          <img
            src="/hcp-logo-with-name-transparent.png"
            alt="Hotel City Park Solapur"
            style={{ height: '56px', width: 'auto', marginBottom: '22px', objectFit: 'contain' }}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = '/logo.png';
            }}
          />

          <div style={{
            width: '68px',
            height: '68px',
            borderRadius: '50%',
            backgroundColor: '#fdf2f8',
            border: '2px solid #8c5d77',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem',
            marginBottom: '16px'
          }}>
            🏨
          </div>

          <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: '#0f172a', margin: '0 0 10px', lineHeight: '1.3' }}>
            Thank You for Choosing<br />Hotel City Park Solapur
          </h2>

          <div style={{
            fontSize: '0.92rem',
            color: '#475569',
            lineHeight: '1.6',
            margin: '0 0 24px',
            textAlign: 'center'
          }}>
            Dear Valued Guest,<br />
            We sincerely thank you for choosing <strong>Hotel City Park</strong> for your stay in Solapur. 
            We hope you had a comfortable, relaxing, and memorable experience with us.
            <br /><br />
            Your room checkout is complete. We look forward to welcoming you back on your next visit!
          </div>

          <div style={{
            backgroundColor: '#f8fafc',
            borderRadius: '14px',
            padding: '14px 16px',
            width: '100%',
            marginBottom: '20px',
            border: '1px solid #e2e8f0',
            textAlign: 'left'
          }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
              🏨 Hotel City Park Solapur
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: '1.4' }}>
              Old Pune-Naka, Near Passport Seva Kendra, Solapur, Maharashtra 413003
            </div>
          </div>

          <a
            href="tel:+919370000000"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              padding: '12px',
              backgroundColor: '#8c5d77',
              color: '#ffffff',
              borderRadius: '12px',
              textDecoration: 'none',
              fontWeight: 800,
              fontSize: '0.9rem',
              boxShadow: '0 3px 10px rgba(140, 93, 119, 0.25)'
            }}
          >
            📞 Contact Reception / Front Desk
          </a>
        </div>
      </div>
    );
  }

  // ==========================================================
  // VIEW: SERVER ERROR FALLBACK
  // ==========================================================
  if (error && (!session?.menu || session.menu.length === 0)) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center'
      }}>
        <img
          src="/hcp-logo-with-name-transparent.png"
          alt="Hotel City Park Solapur"
          style={{ height: '48px', width: 'auto', marginBottom: '16px', objectFit: 'contain' }}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = '/logo.png';
          }}
        />
        <div style={{ fontSize: '2.5rem', marginBottom: '14px' }}>🍽️</div>
        <h3 style={{ margin: '0 0 8px', color: '#8c5d77', fontWeight: 800 }}>Unable to Load Menu</h3>
        <p style={{ margin: '0 0 20px', color: '#64748b', maxWidth: '320px', fontSize: '0.9rem', lineHeight: '1.4' }}>
          {error}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            backgroundColor: '#8c5d77',
            color: '#ffffff',
            border: 'none',
            borderRadius: '10px',
            padding: '12px 24px',
            fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(140, 93, 119, 0.3)'
          }}
        >
          Try Again 🔄
        </button>
      </div>
    );
  }

  // ==========================================================
  // VIEW: MAIN LIGHT-THEMED IN-ROOM DINING INTERFACE
  // ==========================================================
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', color: '#0f172a', paddingBottom: totalCount > 0 ? '96px' : '48px' }}>
      
      {/* 1. HOTEL CITY PARK LIGHT BRAND HEADER */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
      }}>
        <div style={{
          maxWidth: '640px',
          margin: '0 auto',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px'
        }}>
          {/* Logo with Name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <img
              src="/hcp-logo-with-name-transparent.png"
              alt="Hotel City Park Solapur"
              style={{
                height: '42px',
                width: 'auto',
                maxWidth: '170px',
                objectFit: 'contain',
                display: 'block'
              }}
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = '/logo.png';
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{
                fontSize: '0.66rem',
                backgroundColor: '#fdf2f8',
                color: '#8c5d77',
                padding: '2px 7px',
                borderRadius: '6px',
                fontWeight: 800,
                border: '1px solid #fbd3e4',
                display: 'inline-block',
                width: 'fit-content',
                letterSpacing: '0.03em'
              }}>
                IN-ROOM DINING
              </span>
              <span style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '2px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {session?.guest?.name ? `Welcome, ${session.guest.name}` : 'Solapur'}
              </span>
            </div>
          </div>

          {/* Room Pill */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            backgroundColor: '#8c5d77',
            color: '#ffffff',
            padding: '6px 13px',
            borderRadius: '20px',
            fontSize: '0.8rem',
            fontWeight: 800,
            boxShadow: '0 2px 8px rgba(140, 93, 119, 0.25)',
            flexShrink: 0
          }}>
            <span>🚪</span>
            <span>Room {selectedRoom}</span>
          </div>
        </div>

        {/* Operating Status Banner */}
        {!timingInfo.isOpen && (
          <div
            onClick={() => setShowTimingModal(true)}
            style={{
              backgroundColor: '#fffbeb',
              borderTop: '1px solid #fef3c7',
              borderBottom: '1px solid #fde68a',
              padding: '6px 16px',
              fontSize: '0.78rem',
              color: '#92400e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>⚠️</span>
              <span><strong>Kitchen Closed:</strong> Opens 11:00 AM – 10:45 PM (Browse Only)</span>
            </div>
            <span style={{ textDecoration: 'underline', fontWeight: 700 }}>Details →</span>
          </div>
        )}

        {/* Navigation Tabs: Menu & My Orders */}
        <div style={{
          maxWidth: '640px',
          margin: '0 auto',
          display: 'flex',
          borderTop: '1px solid #e2e8f0'
        }}>
          <button
            type="button"
            onClick={() => setActiveTab('menu')}
            style={{
              flex: 1,
              padding: '11px',
              textAlign: 'center',
              backgroundColor: activeTab === 'menu' ? '#ffffff' : '#f8fafc',
              color: activeTab === 'menu' ? '#8c5d77' : '#64748b',
              border: 'none',
              borderBottom: activeTab === 'menu' ? '2.5px solid #8c5d77' : '2.5px solid transparent',
              fontWeight: 800,
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🍽️</span> Menu
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            style={{
              flex: 1,
              padding: '11px',
              textAlign: 'center',
              backgroundColor: activeTab === 'orders' ? '#ffffff' : '#f8fafc',
              color: activeTab === 'orders' ? '#8c5d77' : '#64748b',
              border: 'none',
              borderBottom: activeTab === 'orders' ? '2.5px solid #8c5d77' : '2.5px solid transparent',
              fontWeight: 800,
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <span>📋</span> My Orders
            {placedOrders.length > 0 && (
              <span style={{
                backgroundColor: '#8c5d77',
                color: '#ffffff',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                fontSize: '0.68rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800
              }}>
                {placedOrders.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* SCREEN 1: MENU BROWSING & ORDERING */}
      {activeTab === 'menu' && (
        <main style={{ maxWidth: '640px', margin: '0 auto', padding: '14px 14px' }}>
          
          {/* Search, Filter & Categories Strip */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
            {/* Search Input */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              padding: '8px 14px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)'
            }}>
              <span style={{ fontSize: '1rem', marginRight: '8px', opacity: 0.6 }}>🔍</span>
              <input
                type="text"
                placeholder="Search food, beverages, snacks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  border: 'none',
                  outline: 'none',
                  backgroundColor: 'transparent',
                  width: '100%',
                  color: '#0f172a',
                  fontSize: '0.9rem'
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem', padding: '4px' }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Quick Filter: Veg Only Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div
                onClick={() => setVegOnly(!vegOnly)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: vegOnly ? '#ecfdf5' : '#ffffff',
                  border: vegOnly ? '1.5px solid #16a34a' : '1px solid #e2e8f0',
                  padding: '5px 12px',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)'
                }}
              >
                <span style={{
                  width: '14px',
                  height: '14px',
                  border: '1.5px solid #16a34a',
                  borderRadius: '3px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#16a34a', display: 'block' }}></span>
                </span>
                <span style={{ fontSize: '0.8rem', fontWeight: 750, color: vegOnly ? '#16a34a' : '#64748b' }}>
                  Veg Only
                </span>
              </div>

              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                {filteredDishes.length} dish{filteredDishes.length === 1 ? '' : 'es'} available
              </div>
            </div>

            {/* Category Pill Scroll Strip */}
            <div className="no-scrollbar" style={{
              display: 'flex',
              gap: '8px',
              overflowX: 'auto',
              paddingBottom: '2px',
              WebkitOverflowScrolling: 'touch'
            }}>
              {categoryList.map(cat => {
                const isSelected = activeCategory.toLowerCase() === cat.toLowerCase();
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    style={{
                      whiteSpace: 'nowrap',
                      padding: '6px 14px',
                      borderRadius: '16px',
                      border: isSelected ? '1px solid #8c5d77' : '1px solid #e2e8f0',
                      backgroundColor: isSelected ? '#8c5d77' : '#ffffff',
                      color: isSelected ? '#ffffff' : '#64748b',
                      fontWeight: 750,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      boxShadow: isSelected ? '0 2px 6px rgba(140, 93, 119, 0.25)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dishes List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
            {filteredDishes.length === 0 ? (
              <div style={{
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                padding: '40px 20px',
                textAlign: 'center',
                border: '1px solid #e2e8f0',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)'
              }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🔍</div>
                <h4 style={{ margin: '0 0 6px', color: '#0f172a', fontWeight: 800 }}>No dishes found</h4>
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>
                  Try clearing your search or switching categories.
                </p>
              </div>
            ) : (
              filteredDishes.map(dish => {
                const isVeg = dish.is_veg !== 0;
                const inCart = cart[dish.id];
                const qty = inCart ? inCart.quantity : 0;
                const priceNum = parseFloat(dish.price || 0);

                return (
                  <div
                    key={dish.id}
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '16px',
                      padding: '16px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px'
                    }}
                  >
                    {/* Left Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span style={{
                          width: '15px',
                          height: '15px',
                          border: `1.5px solid ${isVeg ? '#16a34a' : '#e11d48'}`,
                          borderRadius: '3px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: '#ffffff'
                        }}>
                          {isVeg ? (
                            <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#16a34a' }}></span>
                          ) : (
                            <span style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderBottom: '7px solid #e11d48' }}></span>
                          )}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>
                          {dish.category || 'Special'}
                        </span>
                      </div>

                      <h3 style={{
                        fontSize: '0.98rem',
                        fontWeight: 800,
                        color: '#0f172a',
                        margin: '0 0 4px',
                        lineHeight: '1.3'
                      }}>
                        {dish.name}
                      </h3>

                      <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#0f172a' }}>
                        ₹{priceNum}/-
                      </div>

                      {qty > 0 && (
                        <input
                          type="text"
                          placeholder="Note for chef (e.g. less spicy)..."
                          value={inCart?.notes || ''}
                          onChange={(e) => handleItemNoteChange(dish.id, e.target.value)}
                          style={{
                            width: '100%',
                            marginTop: '8px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid #e2e8f0',
                            fontSize: '0.75rem',
                            color: '#475569',
                            outline: 'none',
                            backgroundColor: '#f8fafc'
                          }}
                        />
                      )}
                    </div>

                    {/* Right Action: ADD Button or Stepper */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '92px' }}>
                      {qty === 0 ? (
                        <button
                          type="button"
                          onClick={() => handleAddToCart(dish)}
                          style={{
                            backgroundColor: !timingInfo.isOpen ? '#f1f5f9' : '#ffffff',
                            color: !timingInfo.isOpen ? '#94a3b8' : '#8c5d77',
                            border: !timingInfo.isOpen ? '1.5px solid #cbd5e1' : '1.5px solid #8c5d77',
                            borderRadius: '8px',
                            padding: !timingInfo.isOpen ? '6px 10px' : '7px 22px',
                            fontWeight: 900,
                            fontSize: !timingInfo.isOpen ? '0.72rem' : '0.9rem',
                            cursor: !timingInfo.isOpen ? 'pointer' : 'pointer',
                            boxShadow: !timingInfo.isOpen ? 'none' : '0 2px 6px rgba(140, 93, 119, 0.12)',
                            textTransform: 'uppercase',
                            transition: 'all 0.15s ease',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {!timingInfo.isOpen ? 'Closed' : '+ ADD'}
                        </button>
                      ) : (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          backgroundColor: '#8c5d77',
                          borderRadius: '8px',
                          color: '#ffffff',
                          overflow: 'hidden',
                          boxShadow: '0 3px 8px rgba(140, 93, 119, 0.35)'
                        }}>
                          <button
                            type="button"
                            onClick={() => handleUpdateQuantity(dish.id, -1)}
                            style={{
                              backgroundColor: 'transparent',
                              border: 'none',
                              color: '#ffffff',
                              fontSize: '1rem',
                              fontWeight: 900,
                              padding: '6px 12px',
                              cursor: 'pointer'
                            }}
                          >
                            −
                          </button>
                          <span style={{ fontWeight: 900, fontSize: '0.95rem', minWidth: '16px', textAlign: 'center' }}>
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUpdateQuantity(dish.id, 1)}
                            style={{
                              backgroundColor: 'transparent',
                              border: 'none',
                              color: '#ffffff',
                              fontSize: '1rem',
                              fontWeight: 900,
                              padding: '6px 12px',
                              cursor: 'pointer'
                            }}
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>
      )}

      {/* SCREEN 2: MY ORDERS (NON-CANCELLABLE BY GUEST) */}
      {activeTab === 'orders' && (
        <main style={{ maxWidth: '640px', margin: '0 auto', padding: '16px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>
                My Room Orders
              </h2>
              <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '2px 0 0' }}>
                Delivered directly to Room {selectedRoom}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('menu')}
              style={{
                backgroundColor: '#fdf2f8',
                color: '#8c5d77',
                border: '1px solid #fbd3e4',
                padding: '6px 14px',
                borderRadius: '20px',
                fontSize: '0.82rem',
                fontWeight: 800,
                cursor: 'pointer'
              }}
            >
              + Order More
            </button>
          </div>

          {placedOrders.length === 0 ? (
            <div style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '40px 20px',
              textAlign: 'center',
              border: '1px solid #e2e8f0',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🛎️</div>
              <h3 style={{ margin: '0 0 6px', color: '#0f172a', fontWeight: 800 }}>No Orders Placed Yet</h3>
              <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: '0.85rem' }}>
                Browse our delicious in-room dining menu and order directly to your room!
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('menu')}
                style={{
                  backgroundColor: '#8c5d77',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '12px 24px',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(140, 93, 119, 0.3)'
                }}
              >
                Explore Menu 🍽️
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {placedOrders.map((ord, idx) => {
                const totalRounded = Math.round(ord.grandTotal || ord.subtotal || 0);
                const prepTime = ord.estimatedPrep || getEstimatedPrepTime(totalRounded);
                return (
                  <div
                    key={ord.orderNumber || idx}
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '16px',
                      padding: '16px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)'
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', marginBottom: '12px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.95rem', fontWeight: 900, color: '#0f172a' }}>
                            {ord.orderNumber}
                          </span>
                          <span style={{
                            backgroundColor: '#ecfdf5',
                            color: '#16a34a',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: '12px'
                          }}>
                            ● Sent to Kitchen
                          </span>
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                          📅 {ord.placedDate || 'Today'} • ⏰ {ord.placedAt || 'Just Now'}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#8c5d77' }}>
                          ₹{totalRounded}/-
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                          Incl. 5% GST
                        </div>
                      </div>
                    </div>

                    {/* Prep Time Badge */}
                    <div style={{
                      backgroundColor: '#f8fafc',
                      borderRadius: '10px',
                      padding: '8px 12px',
                      marginBottom: '12px',
                      border: '1px solid #e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.8rem'
                    }}>
                      <span style={{ color: '#475569', fontWeight: 700 }}>⏱️ Est. Preparation Time:</span>
                      <span style={{ color: '#8c5d77', fontWeight: 900 }}>~{prepTime}</span>
                    </div>

                    {/* Items List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                      {(ord.items || []).map((it, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                          <span style={{ color: '#0f172a', fontWeight: 600 }}>
                            {it.quantity}x {it.name}
                          </span>
                          <span style={{ color: '#64748b', fontWeight: 700 }}>
                            ₹{it.total || (it.price * it.quantity)}/-
                          </span>
                        </div>
                      ))}
                    </div>

                    {ord.notes && (
                      <div style={{ backgroundColor: '#fdf2f8', padding: '6px 10px', borderRadius: '6px', fontSize: '0.78rem', color: '#8c5d77', marginBottom: '10px', border: '1px solid #fbd3e4' }}>
                        📝 Note: {ord.notes}
                      </div>
                    )}

                    {/* Non-cancellation Notice */}
                    <div style={{ fontSize: '0.74rem', color: '#64748b', fontStyle: 'italic', marginBottom: '10px' }}>
                      🔒 Kitchen has started fresh food preparation. Online cancellation is unavailable. Please dial Front Desk from intercom for changes.
                    </div>

                    {/* Bottom Status & Add More */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed #e2e8f0', paddingTop: '10px' }}>
                      <span style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 700 }}>
                        ✓ Billed to Room {selectedRoom} checkout folio
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('menu')}
                        style={{
                          backgroundColor: '#ffffff',
                          color: '#8c5d77',
                          border: '1px solid #8c5d77',
                          borderRadius: '8px',
                          padding: '4px 12px',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        + Add More Items
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {/* 2. FLOATING BOTTOM CART TAB */}
      {totalCount > 0 && activeTab === 'menu' && (
        <div style={{
          position: 'fixed',
          bottom: '16px',
          left: '16px',
          right: '16px',
          maxWidth: '608px',
          margin: '0 auto',
          zIndex: 80
        }}>
          <div
            onClick={() => setShowCartDrawer(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(135deg, #8c5d77 0%, #73465f 100%)',
              borderRadius: '16px',
              padding: '12px 18px',
              color: '#ffffff',
              boxShadow: '0 8px 24px rgba(140, 93, 119, 0.4)',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <div>
              <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 800, opacity: 0.9 }}>
                {totalCount} ITEM{totalCount === 1 ? '' : 'S'} • PREP: ~{currentEstimatedPrep}
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 900 }}>
                ₹{cartRoundedTotal}/- <span style={{ fontSize: '0.72rem', fontWeight: 600, opacity: 0.85 }}>(Incl. GST)</span>
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#ffffff',
              color: '#8c5d77',
              padding: '8px 16px',
              borderRadius: '10px',
              fontWeight: 900,
              fontSize: '0.88rem'
            }}>
              <span>View Order</span>
              <span>🛒</span>
            </div>
          </div>
        </div>
      )}

      {/* 3. CART & CHECKOUT REVIEW DRAWER */}
      {showCartDrawer && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          backdropFilter: 'blur(4px)'
        }}>
          <div
            style={{
              backgroundColor: '#ffffff',
              borderTopLeftRadius: '24px',
              borderTopRightRadius: '24px',
              padding: '20px 18px 28px',
              maxHeight: '85vh',
              overflowY: 'auto',
              maxWidth: '640px',
              width: '100%',
              margin: '0 auto',
              boxShadow: '0 -10px 30px rgba(0,0,0,0.2)'
            }}
          >
            {/* Drawer Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>Review Your Order</h3>
                <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '2px 0 0' }}>Delivering to Room {selectedRoom}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCartDrawer(false)}
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontWeight: 800, fontSize: '1rem' }}
              >
                ✕
              </button>
            </div>

            {/* Items List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              {cartItems.map(it => (
                <div key={it.dish.id} style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.92rem' }}>{it.dish.name}</div>
                      <div style={{ fontSize: '0.82rem', color: '#8c5d77', fontWeight: 800 }}>₹{it.dish.price}/- each</div>
                    </div>
                    {/* Stepper */}
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#8c5d77', borderRadius: '6px', color: '#ffffff' }}>
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(it.dish.id, -1)}
                        style={{ width: '28px', height: '28px', background: 'transparent', color: '#ffffff', border: 'none', cursor: 'pointer', fontWeight: 900 }}
                      >
                        −
                      </button>
                      <span style={{ fontWeight: 900, minWidth: '18px', textAlign: 'center', fontSize: '0.88rem' }}>{it.quantity}</span>
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(it.dish.id, 1)}
                        style={{ width: '28px', height: '28px', background: 'transparent', color: '#ffffff', border: 'none', cursor: 'pointer', fontWeight: 900 }}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Special Instruction Input per item */}
                  <input
                    type="text"
                    placeholder="Cooking note (e.g. less spicy, extra butter)..."
                    value={it.notes || ''}
                    onChange={(e) => handleItemNoteChange(it.dish.id, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      color: '#475569',
                      fontSize: '0.78rem',
                      outline: 'none'
                    }}
                  />
                </div>
              ))}
            </div>

            {/* General Delivery Instructions */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 750, color: '#64748b', marginBottom: '4px' }}>
                Delivery Instructions (Optional)
              </label>
              <textarea
                rows={2}
                placeholder="E.g., Please bring extra plates, cutlery & napkins..."
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  color: '#0f172a',
                  fontSize: '0.85rem',
                  outline: 'none',
                  resize: 'none'
                }}
              />
            </div>

            {/* Preparation Time Notice Banner */}
            <div style={{
              backgroundColor: '#fdf2f8',
              borderRadius: '12px',
              padding: '12px 14px',
              marginBottom: '16px',
              border: '1px solid #fbd3e4'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#8c5d77' }}>
                  ⏱️ Estimated Food Preparation Time
                </span>
                <span style={{ fontSize: '0.92rem', fontWeight: 900, color: '#8c5d77' }}>
                  ~{currentEstimatedPrep}
                </span>
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                Tier Scale: ₹1–200 (15m) • ₹200–500 (20m) • ₹500–1000 (25m) • ₹1000–3000 (+35m)
              </div>
            </div>

            {/* Bill Details Breakdown with GST */}
            <div style={{ backgroundColor: '#f8fafc', borderRadius: '12px', padding: '14px', marginBottom: '16px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#64748b', marginBottom: '6px' }}>
                <span>Item Subtotal</span>
                <span>₹{Math.round(cartSubtotal)}/-</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#64748b', marginBottom: '8px' }}>
                <span>GST (5%)</span>
                <span>+ ₹{Math.round(cartGst)}/-</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 900, color: '#0f172a', borderTop: '1px dashed #cbd5e1', paddingTop: '8px' }}>
                <span>Final Amount</span>
                <span style={{ color: '#8c5d77' }}>₹{cartRoundedTotal}/-</span>
              </div>
              <div style={{ fontSize: '0.76rem', color: '#16a34a', marginTop: '6px', fontWeight: 700 }}>
                ✓ No payment required now: Billed to Room {selectedRoom} checkout folio
              </div>
            </div>

            {/* Mandatory "I Agree" Checkbox Gate */}
            <div style={{
              backgroundColor: agreedToTerms ? '#f0fdf4' : '#f8fafc',
              border: agreedToTerms ? '1.5px solid #86efac' : '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '12px 14px',
              marginBottom: '16px',
              transition: 'all 0.15s ease'
            }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  style={{
                    width: '18px',
                    height: '18px',
                    marginTop: '2px',
                    accentColor: '#8c5d77',
                    cursor: 'pointer'
                  }}
                />
                <div style={{ fontSize: '0.82rem', color: '#0f172a', lineHeight: '1.4' }}>
                  <strong>I agree</strong> to the food preparation time (<strong>~{currentEstimatedPrep}</strong>) and room dining terms. 
                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '2px' }}>
                    Orders are freshly prepared by our chefs and cannot be cancelled online once sent to the kitchen.
                  </div>
                </div>
              </label>
            </div>

            {/* Submit Order Button (Gated strictly by checkbox & kitchen status) */}
            <button
              type="button"
              onClick={handleSendOrder}
              disabled={!agreedToTerms || isSubmitting || !timingInfo.isOpen}
              style={{
                width: '100%',
                padding: '14px',
                background: (!agreedToTerms || !timingInfo.isOpen)
                  ? '#cbd5e1'
                  : 'linear-gradient(135deg, #8c5d77 0%, #73465f 100%)',
                color: (!agreedToTerms || !timingInfo.isOpen) ? '#64748b' : '#ffffff',
                border: 'none',
                borderRadius: '14px',
                fontWeight: 900,
                fontSize: '1rem',
                cursor: (!agreedToTerms || !timingInfo.isOpen) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: (agreedToTerms && timingInfo.isOpen) ? '0 4px 16px rgba(140, 93, 119, 0.35)' : 'none'
              }}
            >
              {isSubmitting
                ? 'Transmitting to Kitchen...'
                : !timingInfo.isOpen
                ? 'Kitchen Currently Closed'
                : !agreedToTerms
                ? 'Please Check "I Agree" to Order'
                : `PLACE ORDER • ₹${cartRoundedTotal}/- 🛎️`}
            </button>
          </div>
        </div>
      )}

      {/* 4. ORDER CONFIRMATION MODAL */}
      {lastOrder && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          zIndex: 110,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '20px',
            padding: '24px 20px',
            maxWidth: '380px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: '#ecfdf5',
              border: '2px solid #10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: '2rem',
              color: '#10b981'
            }}>
              ✓
            </div>

            <h3 style={{ fontSize: '1.35rem', fontWeight: 900, color: '#0f172a', margin: '0 0 6px' }}>
              Order Received!
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 16px', lineHeight: '1.4' }}>
              Your order has been transmitted directly to our kitchen staff.
            </p>

            <div style={{
              backgroundColor: '#f8fafc',
              borderRadius: '14px',
              padding: '14px 16px',
              marginBottom: '20px',
              textAlign: 'left',
              border: '1px solid #e2e8f0'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: '#64748b' }}>Order Token:</span>
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a' }}>{lastOrder.orderNumber}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: '#64748b' }}>Delivery To:</span>
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a' }}>Room {selectedRoom}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: '#64748b' }}>Est. Prep Time:</span>
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#8c5d77' }}>~{lastOrder.estimatedPrep || '20 mins'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', paddingTop: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: '#64748b' }}>Total Amount:</span>
                <span style={{ fontSize: '1.05rem', fontWeight: 900, color: '#8c5d77' }}>
                  ₹{Math.round(lastOrder.grandTotal || lastOrder.subtotal || 0)}/-
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setLastOrder(null)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>

              <button
                type="button"
                onClick={() => {
                  setLastOrder(null);
                  setActiveTab('menu');
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'linear-gradient(135deg, #8c5d77 0%, #73465f 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(140, 93, 119, 0.35)'
                }}
              >
                More Order 🍽️
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. KITCHEN TIMING / BREAKFAST POPUP MODAL (EXACT SPEC WITH CLOSE BUTTON) */}
      {showTimingModal && !timingInfo.isOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.72)',
          zIndex: 120,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          backdropFilter: 'blur(5px)',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '22px',
            padding: '28px 22px',
            maxWidth: '420px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
            border: '2px solid #fbd3e4'
          }}>
            {/* Header Icon */}
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: '#fdf2f8',
              border: '2px solid #8c5d77',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: '2rem'
            }}>
              {timingInfo.type === 'BREAKFAST' ? '🍳' : '🛎️'}
            </div>

            {/* Display exact user message format */}
            {timingInfo.type === 'BREAKFAST' ? (
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', margin: '0 0 12px', lineHeight: '1.3' }}>
                  Complimentary Breakfast<br />
                  <span style={{ fontSize: '1rem', fontWeight: 700, color: '#8c5d77' }}>
                    Is Served at Jashn Hall at Ground Floor<br />from 8:00am to 10:30am
                  </span>
                </h3>

                <div style={{
                  backgroundColor: '#fff1f2',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  marginBottom: '20px',
                  border: '1px solid #fecdd3',
                  fontSize: '0.85rem',
                  color: '#9f1239',
                  lineHeight: '1.4'
                }}>
                  <strong>Room Service Currently Unavailable</strong><br />
                  In Room Dinning Available From 11:00am to 10:45pm Only
                </div>
              </div>
            ) : (
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', margin: '0 0 10px', lineHeight: '1.3' }}>
                  Room Service Currently Unavailable
                </h3>

                <div style={{
                  backgroundColor: '#fdf2f8',
                  borderRadius: '12px',
                  padding: '14px',
                  marginBottom: '20px',
                  border: '1px solid #fbd3e4',
                  fontSize: '0.9rem',
                  color: '#8c5d77',
                  lineHeight: '1.4'
                }}>
                  <strong>In Room Dinning</strong><br />
                  Available From <strong>11:00am to 10:45pm Only</strong>
                </div>
              </div>
            )}

            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 20px', lineHeight: '1.4' }}>
              You can freely browse our full menu dishes. Orders will open at <strong>11:00 AM</strong>. For immediate assistance or drinking water, please dial Front Desk.
            </p>

            {/* Close Button allowing guests to browse dishes */}
            <button
              type="button"
              onClick={() => setShowTimingModal(false)}
              style={{
                width: '100%',
                padding: '13px',
                background: 'linear-gradient(135deg, #8c5d77 0%, #73465f 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '14px',
                fontWeight: 900,
                fontSize: '0.96rem',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(140, 93, 119, 0.4)',
                letterSpacing: '0.02em'
              }}
            >
              Close & Browse Dishes 🍽️
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
