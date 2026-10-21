import React, { useState, useEffect, useMemo } from 'react';
import { getLiveDiningSession, submitRoomOrder } from './supabase';

export default function App() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

  // Filter & Search states
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [vegOnly, setVegOnly] = useState(false);

  // Cart: { [dishId]: { dish, quantity, notes } }
  const [cart, setCart] = useState({});
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('409');

  // Submission & Post-order confirmation state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);
  const [placedOrders, setPlacedOrders] = useState([]);

  // Extract token & room from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token') || '';
    const r = params.get('room') || '';
    setToken(t);
    if (r) setSelectedRoom(r);
  }, []);

  // Fetch live session & menu
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

  // Submit order to kitchen
  const handleSendOrder = async () => {
    if (cartItems.length === 0 || isSubmitting) return;
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
      setLastOrder(result);
      setPlacedOrders(prev => [result, ...prev]);
      setCart({});
      setShowCartDrawer(false);
      setOrderNotes('');
    } catch (err) {
      alert('Error placing order: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', border: '3px solid #d97706', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <h2 style={{ marginTop: '20px', fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>Hotel City Park</h2>
        <p style={{ marginTop: '8px', fontSize: '0.9rem', color: '#94a3b8' }}>Loading fresh in-room dining menu...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🍽️</div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', marginBottom: '8px' }}>Hotel City Park Solapur</h2>
        <p style={{ color: '#ef4444', marginBottom: '24px', maxWidth: '360px', fontSize: '0.95rem' }}>{error}</p>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '12px 24px', backgroundColor: '#d97706', color: '#ffffff', fontWeight: 700, borderRadius: '10px', border: 'none', cursor: 'pointer' }}
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0b1120', paddingBottom: totalCount > 0 ? '110px' : '60px' }}>
      {/* Top Fixed Header */}
      <header className="glass-nav" style={{ position: 'sticky', top: 0, zIndex: 50, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: '640px', margin: '0 auto' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.3rem' }}>🏨</span>
              <h1 style={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '0.02em', color: '#f8fafc', margin: 0 }}>
                Hotel City Park
              </h1>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#fbbf24', fontWeight: 600, marginTop: '2px' }}>
              In-Room Dining • Room Service
            </p>
          </div>

          {/* Room Number Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: '#1e293b',
            border: '1px solid #d97706',
            borderRadius: '12px',
            padding: '6px 12px'
          }}>
            <span style={{ fontSize: '0.85rem' }}>🚪</span>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Room</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#ffffff', lineHeight: 1 }}>{selectedRoom}</div>
            </div>
          </div>
        </div>

        {/* Guest Greeting */}
        {session?.guest?.name && (
          <div style={{ maxWidth: '640px', margin: '8px auto 0', fontSize: '0.82rem', color: '#94a3b8' }}>
            Welcome, <strong style={{ color: '#f8fafc' }}>{session.guest.name}</strong> • Orders billed directly to your room stay
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: '640px', margin: '0 auto', padding: '16px' }}>
        {/* Search & Veg Toggle */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }}>🔍</span>
            <input
              type="text"
              placeholder="Search dishes (e.g. Biryani, Roti, Paneer)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '11px 12px 11px 38px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '12px',
                color: '#f8fafc',
                fontSize: '0.9rem',
                outline: 'none'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', fontSize: '1rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Veg Only Toggle */}
          <button
            onClick={() => setVegOnly(!vegOnly)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '11px 14px',
              backgroundColor: vegOnly ? '#064e3b' : '#1e293b',
              border: vegOnly ? '1px solid #10b981' : '1px solid #334155',
              borderRadius: '12px',
              color: vegOnly ? '#34d399' : '#94a3b8',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <span style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: vegOnly ? '#10b981' : '#64748b'
            }} />
            Veg Only
          </button>
        </div>

        {/* Categories Bar */}
        <div className="no-scrollbar" style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '16px' }}>
          {categoryList.map(cat => {
            const isSelected = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  padding: '7px 14px',
                  borderRadius: '20px',
                  fontSize: '0.82rem',
                  fontWeight: isSelected ? 800 : 600,
                  backgroundColor: isSelected ? '#d97706' : '#1e293b',
                  color: isSelected ? '#ffffff' : '#94a3b8',
                  border: isSelected ? '1px solid #f59e0b' : '1px solid #334155',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  textTransform: 'capitalize'
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Menu Items List */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              {activeCategory === 'ALL' ? 'Full Restaurant Menu' : activeCategory}
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              {filteredDishes.length} item{filteredDishes.length === 1 ? '' : 's'}
            </span>
          </div>

          {filteredDishes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', backgroundColor: '#1e293b', borderRadius: '16px', border: '1px dashed #334155' }}>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🍲</div>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No dishes found matching your search or filters.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filteredDishes.map(dish => {
                const qty = cart[dish.id] ? cart[dish.id].quantity : 0;
                const isVeg = dish.is_veg === 1 || dish.is_veg === true;

                return (
                  <div
                    key={dish.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 16px',
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '14px',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {/* Dish Info */}
                    <div style={{ flex: 1, paddingRight: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        {/* Veg / Non-Veg Icon */}
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '14px',
                          height: '14px',
                          border: `1.5px solid ${isVeg ? '#10b981' : '#ef4444'}`,
                          borderRadius: '3px'
                        }}>
                          <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor: isVeg ? '#10b981' : '#ef4444'
                          }} />
                        </span>

                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                          {dish.category}
                        </span>
                      </div>

                      <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: '#f8fafc', margin: '0 0 4px 0' }}>
                        {dish.name}
                      </h3>

                      <div style={{ fontSize: '1rem', fontWeight: 800, color: '#fbbf24' }}>
                        ₹{parseFloat(dish.price || 0).toLocaleString('en-IN')}
                      </div>
                    </div>

                    {/* Add to Cart Stepper */}
                    <div>
                      {qty === 0 ? (
                        <button
                          onClick={() => handleAddToCart(dish)}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#d97706',
                            color: '#ffffff',
                            fontWeight: 700,
                            fontSize: '0.85rem',
                            border: 'none',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          + ADD
                        </button>
                      ) : (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          backgroundColor: '#0f172a',
                          border: '1px solid #d97706',
                          borderRadius: '10px',
                          padding: '3px'
                        }}>
                          <button
                            onClick={() => handleUpdateQuantity(dish.id, -1)}
                            style={{
                              width: '28px',
                              height: '28px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: '#1e293b',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '1rem',
                              fontWeight: 800,
                              cursor: 'pointer'
                            }}
                          >
                            −
                          </button>
                          <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#ffffff', minWidth: '20px', textAlign: 'center' }}>
                            {qty}
                          </span>
                          <button
                            onClick={() => handleUpdateQuantity(dish.id, 1)}
                            style={{
                              width: '28px',
                              height: '28px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: '#d97706',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '1rem',
                              fontWeight: 800,
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
              })}
            </div>
          )}
        </div>

        {/* Recently Placed Orders Section */}
        {placedOrders.length > 0 && (
          <div style={{ marginTop: '30px', padding: '16px', backgroundColor: '#1e293b', borderRadius: '16px', border: '1px solid #334155' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🛎️</span> Placed Orders During This Stay
            </h3>
            {placedOrders.map((ord, idx) => (
              <div key={idx} style={{ padding: '10px 0', borderBottom: idx < placedOrders.length - 1 ? '1px solid #334155' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: '#38bdf8', fontSize: '0.9rem' }}>{ord.orderNumber}</span>
                  <span style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 700 }}>✓ Sent to Kitchen</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                  {ord.items.map(it => `${it.quantity}x ${it.name}`).join(', ')} • <strong>₹{ord.grandTotal}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Floating Bottom Bar (Shows when items in cart) */}
      {totalCount > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '16px',
          left: '16px',
          right: '16px',
          maxWidth: '608px',
          margin: '0 auto',
          zIndex: 90
        }}>
          <div
            className="pulse-glow"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: '#d97706',
              borderRadius: '16px',
              padding: '12px 18px',
              color: '#ffffff',
              boxShadow: '0 8px 24px rgba(217, 119, 6, 0.4)'
            }}
          >
            <div>
              <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', fontWeight: 700, opacity: 0.9 }}>
                {totalCount} Item{totalCount === 1 ? '' : 's'} Selected
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                ₹{cartGrandTotal.toLocaleString('en-IN')}{' '}
                <span style={{ fontSize: '0.75rem', fontWeight: 600, opacity: 0.85 }}>(Incl. 5% GST)</span>
              </div>
            </div>

            <button
              onClick={() => setShowCartDrawer(true)}
              style={{
                backgroundColor: '#ffffff',
                color: '#b45309',
                border: 'none',
                borderRadius: '12px',
                padding: '10px 18px',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              View Cart 🛒
            </button>
          </div>
        </div>
      )}

      {/* Cart / Order Drawer Modal */}
      {showCartDrawer && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          backdropFilter: 'blur(6px)'
        }}>
          <div
            className="animate-slide-up"
            style={{
              backgroundColor: '#0f172a',
              borderTopLeftRadius: '24px',
              borderTopRightRadius: '24px',
              padding: '20px 18px 28px',
              maxHeight: '85vh',
              overflowY: 'auto',
              maxWidth: '640px',
              width: '100%',
              margin: '0 auto',
              borderTop: '1px solid #334155'
            }}
          >
            {/* Drawer Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>Review Your Order</h3>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '2px 0 0' }}>Delivering to Room {selectedRoom}</p>
              </div>
              <button
                onClick={() => setShowCartDrawer(false)}
                style={{ background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontWeight: 700 }}
              >
                ✕
              </button>
            </div>

            {/* Items List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              {cartItems.map(it => (
                <div key={it.dish.id} style={{ padding: '12px', backgroundColor: '#1e293b', borderRadius: '12px', border: '1px solid #334155' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.95rem' }}>{it.dish.name}</div>
                      <div style={{ fontSize: '0.85rem', color: '#fbbf24', fontWeight: 700 }}>₹{it.dish.price} each</div>
                    </div>
                    {/* Stepper */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#0f172a', borderRadius: '8px', padding: '3px' }}>
                      <button
                        onClick={() => handleUpdateQuantity(it.dish.id, -1)}
                        style={{ width: '26px', height: '26px', background: '#334155', color: '#ffffff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 800 }}
                      >
                        −
                      </button>
                      <span style={{ fontWeight: 800, minWidth: '18px', textAlign: 'center' }}>{it.quantity}</span>
                      <button
                        onClick={() => handleUpdateQuantity(it.dish.id, 1)}
                        style={{ width: '26px', height: '26px', background: '#d97706', color: '#ffffff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 800 }}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Special Instruction Input per item */}
                  <input
                    type="text"
                    placeholder="Notes for chef (e.g. less spicy, extra crisp)..."
                    value={it.notes || ''}
                    onChange={(e) => handleItemNoteChange(it.dish.id, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      backgroundColor: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      color: '#94a3b8',
                      fontSize: '0.8rem',
                      outline: 'none'
                    }}
                  />
                </div>
              ))}
            </div>

            {/* General Order Notes */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '6px' }}>
                Special Delivery Notes (Optional)
              </label>
              <textarea
                rows={2}
                placeholder="E.g., Please bring extra glasses and napkins to room..."
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '10px',
                  color: '#f8fafc',
                  fontSize: '0.85rem',
                  outline: 'none',
                  resize: 'none'
                }}
              />
            </div>

            {/* Bill Summary */}
            <div style={{ backgroundColor: '#1e293b', borderRadius: '12px', padding: '14px', marginBottom: '18px', border: '1px solid #334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
                <span>Subtotal</span>
                <span>₹{cartSubtotal.toLocaleString('en-IN')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '8px' }}>
                <span>GST (5%)</span>
                <span>+ ₹{cartGst.toLocaleString('en-IN')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc', borderTop: '1px dashed #475569', paddingTop: '8px' }}>
                <span>Grand Total</span>
                <span style={{ color: '#fbbf24' }}>₹{cartGrandTotal.toLocaleString('en-IN')}</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '6px', fontWeight: 600 }}>
                ✓ No payment now: Added directly to your room stay checkout folio
              </div>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleSendOrder}
              disabled={isSubmitting}
              style={{
                width: '100%',
                padding: '14px',
                backgroundColor: isSubmitting ? '#92400e' : '#d97706',
                color: '#ffffff',
                border: 'none',
                borderRadius: '14px',
                fontWeight: 800,
                fontSize: '1rem',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              {isSubmitting ? 'Sending Order to Kitchen...' : 'SEND ORDER TO KITCHEN 🛎️'}
            </button>
          </div>
        </div>
      )}

      {/* Order Placed Success Confirmation Modal */}
      {lastOrder && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          zIndex: 110,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div
            className="animate-fade"
            style={{
              backgroundColor: '#1e293b',
              border: '1px solid #d97706',
              borderRadius: '20px',
              padding: '24px',
              maxWidth: '420px',
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)'
            }}
          >
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', backgroundColor: '#064e3b', border: '2px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '1.8rem' }}>
              ✓
            </div>

            <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f8fafc', marginBottom: '6px' }}>
              Order Received!
            </h3>
            <p style={{ fontSize: '0.88rem', color: '#94a3b8', marginBottom: '14px' }}>
              Your order has been transmitted directly to our kitchen staff.
            </p>

            <div style={{ backgroundColor: '#0f172a', borderRadius: '12px', padding: '12px', marginBottom: '16px', textAlign: 'left', border: '1px solid #334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Order Token:</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#38bdf8' }}>{lastOrder.orderNumber}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Delivery To:</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#ffffff' }}>Room {selectedRoom}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Total Amount:</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fbbf24' }}>₹{lastOrder.grandTotal}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Est. Delivery:</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#10b981' }}>25 - 35 Mins</span>
              </div>
            </div>

            <button
              onClick={() => setLastOrder(null)}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#d97706',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              Order More Dishes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
