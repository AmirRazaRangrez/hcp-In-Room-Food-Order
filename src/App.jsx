import React, { useState, useEffect, useMemo } from 'react';
import { getLiveDiningSession, submitRoomOrder } from './supabase';

export default function App() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

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
  const [selectedRoom, setSelectedRoom] = useState('501');

  // Submission & Post-order confirmation state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

  // Placed Orders (persisted in localStorage by token/room)
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
  const cartRoundedTotal = Math.round(cartGrandTotal);

  // Submit order to kitchen
  const handleSendOrder = async () => {
    if (cartItems.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const payload = {
        roomNumber: selectedRoom || '501',
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
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#fcf9fb',
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
          border: '4px solid #fbd3e4',
          borderTop: '4px solid #8c5d77',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          marginBottom: '20px'
        }} />
        <img
          src="/hcp-logo-with-name-transparent.png"
          alt="Hotel City Park"
          style={{ height: '46px', width: 'auto', marginBottom: '12px', objectFit: 'contain' }}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = '/logo.png';
          }}
        />
        <h3 style={{ margin: '0 0 6px', color: '#21181f', fontWeight: 800 }}>Hotel City Park</h3>
        <p style={{ margin: 0, color: '#6e5e68', fontSize: '0.9rem' }}>Loading restaurant menu...</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error && (!session?.menu || session.menu.length === 0)) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#fcf9fb',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center'
      }}>
        <img
          src="/hcp-logo-with-name-transparent.png"
          alt="Hotel City Park"
          style={{ height: '48px', width: 'auto', marginBottom: '16px', objectFit: 'contain' }}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = '/logo.png';
          }}
        />
        <div style={{ fontSize: '2.5rem', marginBottom: '14px' }}>🍽️</div>
        <h3 style={{ margin: '0 0 8px', color: '#8c5d77', fontWeight: 800 }}>Unable to Load Menu</h3>
        <p style={{ margin: '0 0 20px', color: '#6e5e68', maxWidth: '320px', fontSize: '0.9rem', lineHeight: '1.4' }}>
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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#fcf9fb', color: '#21181f', paddingBottom: totalCount > 0 ? '90px' : '40px' }}>
      
      {/* ========================================================
          1. HOTEL CITY PARK BRAND HEADER WITH OFFICIAL LOGO
         ======================================================== */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backgroundColor: '#ffffff',
        borderBottom: '1px solid rgba(199, 163, 184, 0.35)',
        boxShadow: '0 2px 10px rgba(140, 93, 119, 0.06)'
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
          {/* Official Logo with Name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <img
              src="/hcp-logo-with-name-transparent.png"
              alt="Hotel City Park"
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
                backgroundColor: '#fef4f8',
                color: '#8c5d77',
                padding: '2px 7px',
                borderRadius: '6px',
                fontWeight: 850,
                border: '1px solid rgba(199, 163, 184, 0.35)',
                display: 'inline-block',
                width: 'fit-content',
                letterSpacing: '0.03em'
              }}>
                IN-ROOM DINING
              </span>
              <span style={{ fontSize: '0.74rem', color: '#6e5e68', marginTop: '2px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

        {/* Navigation Tabs: Menu & My Orders */}
        <div style={{
          maxWidth: '640px',
          margin: '0 auto',
          display: 'flex',
          borderTop: '1px solid rgba(199, 163, 184, 0.2)'
        }}>
          <button
            type="button"
            onClick={() => setActiveTab('menu')}
            style={{
              flex: 1,
              padding: '11px',
              textAlign: 'center',
              backgroundColor: activeTab === 'menu' ? '#ffffff' : '#faf3f7',
              color: activeTab === 'menu' ? '#8c5d77' : '#6e5e68',
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
              backgroundColor: activeTab === 'orders' ? '#ffffff' : '#faf3f7',
              color: activeTab === 'orders' ? '#8c5d77' : '#6e5e68',
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

      {/* ========================================================
          SCREEN 1: MENU
         ======================================================== */}
      {activeTab === 'menu' && (
        <main style={{ maxWidth: '640px', margin: '0 auto', padding: '12px 14px' }}>
          
          {/* Sticky Search & Filter Bar */}
          <div style={{
            position: 'sticky',
            top: '95px',
            zIndex: 40,
            backgroundColor: '#fcf9fb',
            padding: '6px 0 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            {/* Search Input Box */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid rgba(199, 163, 184, 0.4)',
              padding: '0 14px',
              boxShadow: '0 2px 6px rgba(140, 93, 119, 0.04)'
            }}>
              <span style={{ fontSize: '1rem', color: '#968690', marginRight: '8px' }}>🔍</span>
              <input
                type="text"
                placeholder="Search dishes (e.g. Biryani, Paneer, Roti)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '11px 0',
                  border: 'none',
                  outline: 'none',
                  backgroundColor: 'transparent',
                  color: '#21181f',
                  fontSize: '0.9rem'
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'none', border: 'none', color: '#968690', cursor: 'pointer', fontSize: '1rem', padding: '4px' }}
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
                  border: vegOnly ? '1.5px solid #16a34a' : '1px solid rgba(199, 163, 184, 0.35)',
                  padding: '5px 12px',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  boxShadow: '0 1px 3px rgba(140, 93, 119, 0.04)'
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
                <span style={{ fontSize: '0.8rem', fontWeight: 750, color: vegOnly ? '#16a34a' : '#6e5e68' }}>
                  Veg Only
                </span>
              </div>

              <div style={{ fontSize: '0.78rem', color: '#6e5e68' }}>
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
                      border: isSelected ? '1px solid #8c5d77' : '1px solid rgba(199, 163, 184, 0.35)',
                      backgroundColor: isSelected ? '#8c5d77' : '#ffffff',
                      color: isSelected ? '#ffffff' : '#6e5e68',
                      fontWeight: 750,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      boxShadow: isSelected ? '0 3px 8px rgba(140, 93, 119, 0.25)' : 'none',
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
                border: '1px solid rgba(199, 163, 184, 0.25)',
                boxShadow: '0 2px 8px rgba(140, 93, 119, 0.04)'
              }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🔍</div>
                <h4 style={{ margin: '0 0 6px', color: '#21181f', fontWeight: 800 }}>No dishes found</h4>
                <p style={{ margin: 0, color: '#6e5e68', fontSize: '0.85rem' }}>
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
                    className="animate-fade"
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '16px',
                      padding: '16px',
                      border: '1px solid rgba(199, 163, 184, 0.25)',
                      boxShadow: '0 2px 8px rgba(140, 93, 119, 0.04)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px'
                    }}
                  >
                    {/* Left Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Veg / Non-Veg Indicator */}
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
                        <span style={{ fontSize: '0.72rem', color: '#968690', fontWeight: 700, textTransform: 'uppercase' }}>
                          {dish.category || 'Kitchen Special'}
                        </span>
                      </div>

                      {/* Dish Name */}
                      <h3 style={{
                        fontSize: '0.98rem',
                        fontWeight: 800,
                        color: '#21181f',
                        margin: '0 0 4px',
                        lineHeight: '1.3'
                      }}>
                        {dish.name}
                      </h3>

                      {/* Price in bold */}
                      <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#21181f' }}>
                        ₹{priceNum}/-
                      </div>

                      {/* Notes input preview if item is added */}
                      {qty > 0 && (
                        <input
                          type="text"
                          placeholder="Note for chef (less spicy, etc)..."
                          value={inCart?.notes || ''}
                          onChange={(e) => handleItemNoteChange(dish.id, e.target.value)}
                          style={{
                            width: '100%',
                            marginTop: '8px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid rgba(199, 163, 184, 0.35)',
                            fontSize: '0.75rem',
                            color: '#6e5e68',
                            outline: 'none',
                            backgroundColor: '#fef4f8'
                          }}
                        />
                      )}
                    </div>

                    {/* Right Action: Brand ADD Button or Stepper */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '90px' }}>
                      {qty === 0 ? (
                        <button
                          type="button"
                          onClick={() => handleAddToCart(dish)}
                          style={{
                            backgroundColor: '#ffffff',
                            color: '#8c5d77',
                            border: '1.5px solid #8c5d77',
                            borderRadius: '8px',
                            padding: '7px 22px',
                            fontWeight: 900,
                            fontSize: '0.9rem',
                            cursor: 'pointer',
                            boxShadow: '0 2px 6px rgba(140, 93, 119, 0.12)',
                            textTransform: 'uppercase',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          + ADD
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

      {/* ========================================================
          SCREEN 2: MY ORDERS (ROOM ORDER HISTORY)
         ======================================================== */}
      {activeTab === 'orders' && (
        <main style={{ maxWidth: '640px', margin: '0 auto', padding: '16px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 900, color: '#21181f', margin: 0 }}>
                My Room Orders
              </h2>
              <p style={{ fontSize: '0.8rem', color: '#6e5e68', margin: '2px 0 0' }}>
                Delivered directly to Room {selectedRoom}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('menu')}
              style={{
                backgroundColor: '#fef4f8',
                color: '#8c5d77',
                border: '1px solid rgba(199, 163, 184, 0.45)',
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
              border: '1px solid rgba(199, 163, 184, 0.25)',
              boxShadow: '0 2px 8px rgba(140, 93, 119, 0.04)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🛎️</div>
              <h3 style={{ margin: '0 0 6px', color: '#21181f', fontWeight: 800 }}>No Orders Placed Yet</h3>
              <p style={{ margin: '0 0 20px', color: '#6e5e68', fontSize: '0.85rem' }}>
                Browse our delicious menu and order food directly to your room!
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
                return (
                  <div
                    key={ord.orderNumber || idx}
                    className="animate-fade"
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '16px',
                      padding: '16px',
                      border: '1px solid rgba(199, 163, 184, 0.25)',
                      boxShadow: '0 2px 8px rgba(140, 93, 119, 0.04)'
                    }}
                  >
                    {/* Order Card Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(199, 163, 184, 0.2)', paddingBottom: '10px', marginBottom: '12px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.95rem', fontWeight: 900, color: '#21181f' }}>
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
                        <div style={{ fontSize: '0.78rem', color: '#6e5e68', marginTop: '2px' }}>
                          📅 {ord.placedDate || 'Today'} • ⏰ {ord.placedAt || 'Just Now'}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#8c5d77' }}>
                          ₹{totalRounded}/-
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#968690' }}>
                          Incl. 5% GST
                        </div>
                      </div>
                    </div>

                    {/* Items List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                      {(ord.items || []).map((it, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                          <span style={{ color: '#21181f', fontWeight: 600 }}>
                            {it.quantity}x {it.name}
                          </span>
                          <span style={{ color: '#6e5e68', fontWeight: 700 }}>
                            ₹{it.total || (it.price * it.quantity)}/-
                          </span>
                        </div>
                      ))}
                    </div>

                    {ord.notes && (
                      <div style={{ backgroundColor: '#fef4f8', padding: '6px 10px', borderRadius: '6px', fontSize: '0.78rem', color: '#8c5d77', marginBottom: '10px', border: '1px solid rgba(199, 163, 184, 0.3)' }}>
                        📝 Note: {ord.notes}
                      </div>
                    )}

                    {/* Bottom Status & Re-order */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed rgba(199, 163, 184, 0.3)', paddingTop: '10px' }}>
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
                        + Add More
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {/* ========================================================
          3. FLOATING CART PILL
         ======================================================== */}
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
            className="pulse-glow"
            onClick={() => setShowCartDrawer(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(135deg, #8c5d77 0%, #73465f 100%)',
              borderRadius: '16px',
              padding: '14px 20px',
              color: '#ffffff',
              boxShadow: '0 8px 24px rgba(140, 93, 119, 0.45)',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 800, opacity: 0.9 }}>
                {totalCount} ITEM{totalCount === 1 ? '' : 'S'} ADDED
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 900 }}>
                ₹{cartRoundedTotal}/- <span style={{ fontSize: '0.75rem', fontWeight: 600, opacity: 0.85 }}>(Incl. GST)</span>
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
              <span>View Cart</span>
              <span>🛒</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          4. CART REVIEW DRAWER
         ======================================================== */}
      {showCartDrawer && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          backdropFilter: 'blur(4px)'
        }}>
          <div
            className="animate-slide-up"
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(199, 163, 184, 0.25)', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#21181f', margin: 0 }}>Review Your Order</h3>
                <p style={{ fontSize: '0.8rem', color: '#6e5e68', margin: '2px 0 0' }}>Delivering to Room {selectedRoom}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCartDrawer(false)}
                style={{ background: '#faf3f7', border: '1px solid rgba(199, 163, 184, 0.35)', color: '#21181f', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontWeight: 800, fontSize: '1rem' }}
              >
                ✕
              </button>
            </div>

            {/* Items List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              {cartItems.map(it => (
                <div key={it.dish.id} style={{ padding: '12px', backgroundColor: '#fcf9fb', borderRadius: '12px', border: '1px solid rgba(199, 163, 184, 0.25)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div>
                      <div style={{ fontWeight: 800, color: '#21181f', fontSize: '0.92rem' }}>{it.dish.name}</div>
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
                      border: '1px solid rgba(199, 163, 184, 0.35)',
                      borderRadius: '6px',
                      color: '#6e5e68',
                      fontSize: '0.78rem',
                      outline: 'none'
                    }}
                  />
                </div>
              ))}
            </div>

            {/* General Order Notes */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 750, color: '#6e5e68', marginBottom: '4px' }}>
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
                  backgroundColor: '#fcf9fb',
                  border: '1px solid rgba(199, 163, 184, 0.35)',
                  borderRadius: '10px',
                  color: '#21181f',
                  fontSize: '0.85rem',
                  outline: 'none',
                  resize: 'none'
                }}
              />
            </div>

            {/* Bill Details */}
            <div style={{ backgroundColor: '#fcf9fb', borderRadius: '12px', padding: '14px', marginBottom: '18px', border: '1px solid rgba(199, 163, 184, 0.25)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#6e5e68', marginBottom: '6px' }}>
                <span>Item Total</span>
                <span>₹{Math.round(cartSubtotal)}/-</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#6e5e68', marginBottom: '8px' }}>
                <span>GST (5%)</span>
                <span>+ ₹{Math.round(cartGst)}/-</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 900, color: '#21181f', borderTop: '1px dashed rgba(199, 163, 184, 0.4)', paddingTop: '8px' }}>
                <span>Grand Total</span>
                <span style={{ color: '#8c5d77' }}>₹{cartRoundedTotal}/-</span>
              </div>
              <div style={{ fontSize: '0.76rem', color: '#16a34a', marginTop: '6px', fontWeight: 700 }}>
                ✓ No payment required now: Billed to your room stay checkout folio
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="button"
              onClick={handleSendOrder}
              disabled={isSubmitting}
              style={{
                width: '100%',
                padding: '14px',
                background: isSubmitting ? '#5f3a4e' : 'linear-gradient(135deg, #8c5d77 0%, #73465f 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '14px',
                fontWeight: 900,
                fontSize: '1rem',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 16px rgba(140, 93, 119, 0.4)'
              }}
            >
              {isSubmitting ? 'Transmitting to Kitchen...' : 'SEND ORDER TO KITCHEN 🛎️'}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          5. ORDER CONFIRMATION MODAL (EXACT USER SPEC)
             - Total Amount in round-off e.g. "263/-"
             - NO "Est Delivery :"
             - 2 BUTTONS: "Close" & "More Order"
         ======================================================== */}
      {lastOrder && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          zIndex: 110,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          backdropFilter: 'blur(4px)'
        }}>
          <div
            className="animate-fade"
            style={{
              backgroundColor: '#21181f',
              border: '1px solid rgba(199, 163, 184, 0.35)',
              borderRadius: '20px',
              padding: '24px 20px',
              maxWidth: '380px',
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)'
            }}
          >
            {/* Green Circle Checkmark */}
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: '#064e3b',
              border: '2px solid #10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: '2rem',
              color: '#ffffff'
            }}>
              ✓
            </div>

            <h3 style={{ fontSize: '1.35rem', fontWeight: 900, color: '#fcf9fb', margin: '0 0 6px' }}>
              Order Received!
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#c7a3b8', margin: '0 0 16px', lineHeight: '1.4' }}>
              Your order has been transmitted directly to our kitchen staff.
            </p>

            {/* Order Details Card */}
            <div style={{
              backgroundColor: '#160e15',
              borderRadius: '14px',
              padding: '14px 16px',
              marginBottom: '20px',
              textAlign: 'left',
              border: '1px solid rgba(199, 163, 184, 0.25)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: '#c7a3b8' }}>Order Token:</span>
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#fbd3e4' }}>{lastOrder.orderNumber}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: '#c7a3b8' }}>Delivery To:</span>
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#ffffff' }}>Room {selectedRoom}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', color: '#c7a3b8' }}>Total Amount:</span>
                <span style={{ fontSize: '1.05rem', fontWeight: 900, color: '#fbbf24' }}>
                  ₹{Math.round(lastOrder.grandTotal || lastOrder.subtotal || 0)}/-
                </span>
              </div>
            </div>

            {/* TWO BUTTONS: Close & More Order */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setLastOrder(null)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: '#3d2d3a',
                  color: '#fcf9fb',
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
                  boxShadow: '0 4px 12px rgba(140, 93, 119, 0.4)'
                }}
              >
                More Order 🍽️
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
