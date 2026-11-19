const state = {
  user: null,
  categories: [],
  cartCount: 0
};

const MARZER = [
  'Yerevan', 'Aragatsotn', 'Ararat', 'Armavir', 'Gegharkunik',
  'Kotayk', 'Lori', 'Shirak', 'Syunik', 'Tavush', 'Vayots Dzor'
];

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || 'Request failed';
    const err = new Error(msg);
    err.status = res.status;
    err.code = data.error && data.error.code;
    throw err;
  }
  return data;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAmd(val) {
  return `${Number(val).toLocaleString('en-US')} AMD`;
}

function navigate(path) {
  history.pushState({}, '', path);
  render();
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]');
  if (link) {
    e.preventDefault();
    navigate(link.getAttribute('href'));
  }
});

window.addEventListener('popstate', render);

document.getElementById('globalSearchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('globalSearchInput').value.trim();
  navigate(`/products?q=${encodeURIComponent(q)}`);
});

async function refreshSession() {
  const [meRes, catRes] = await Promise.all([api('/api/me'), api('/api/categories')]);
  state.user = meRes.user;
  state.categories = catRes.categories;
  if (state.user) {
    const cart = await api('/api/cart').catch(() => ({ total_items_count: 0 }));
    state.cartCount = cart.total_items_count || 0;
  } else {
    state.cartCount = 0;
  }
  renderHeader();
}

function renderHeader() {
  const catBar = document.getElementById('catBar');
  catBar.innerHTML = `<a href="/products" data-link>All Products</a>` +
    state.categories.map(c => `<a href="/products?category=${encodeURIComponent(c.slug)}" data-link>${escapeHtml(c.name)}</a>`).join('');

  const nav = document.getElementById('navActions');
  if (!state.user) {
    nav.innerHTML = `
      <a href="/login" data-link>Log in</a>
      <a href="/register" data-link>Register</a>
    `;
  } else {
    const sellerLink = state.user.store_name
      ? `<a href="/seller" data-link>Seller dashboard (${escapeHtml(state.user.store_name)})</a>`
      : `<a href="/seller/activate" data-link>Sell on Shuka</a>`;
    nav.innerHTML = `
      <a href="/orders" data-link>My orders</a>
      ${sellerLink}
      <a href="/cart" data-link>Cart (${state.cartCount})</a>
      <button id="logoutBtn">Log out (${escapeHtml(state.user.name)})</button>
    `;
    document.getElementById('logoutBtn').onclick = async () => {
      await api('/api/auth/logout', { method: 'POST' });
      await refreshSession();
      navigate('/');
    };
  }
}

function productCardHtml(p) {
  const img = p.main_image ? p.main_image.replace('_large.webp', '_thumb.webp') : '';
  return `
    <div class="card">
      <div>
        <a href="/products/${p.id}" data-link>
          <img src="${escapeHtml(img)}" alt="${escapeHtml(p.title)}" onerror="this.src='${escapeHtml(p.main_image || '')}'" />
        </a>
        <h3><a href="/products/${p.id}" data-link>${escapeHtml(p.title)}</a></h3>
        <div class="muted">${escapeHtml(p.seller_store_name || '')}</div>
      </div>
      <div style="margin-top:10px">
        <div class="price">${formatAmd(p.price_amd)}</div>
        <div class="muted">★ ${Number(p.rating_avg || 0).toFixed(1)} (${p.rating_count || 0})</div>
      </div>
    </div>
  `;
}

async function renderHome(app) {
  const data = await api('/api/products?sort=newest&page=1');
  app.innerHTML = `
    <div class="panel">
      <h2 style="margin-top:0">Browse Categories</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${state.categories.map(c => `<a class="btn" href="/products?category=${encodeURIComponent(c.slug)}" data-link>${escapeHtml(c.name)}</a>`).join('')}
      </div>
    </div>
    <h2>Newest Products</h2>
    <div class="grid">${data.items.map(productCardHtml).join('')}</div>
  `;
}

async function renderCatalog(app, searchParams) {
  const q = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const minPrice = searchParams.get('minPrice') || '';
  const maxPrice = searchParams.get('maxPrice') || '';
  const sort = searchParams.get('sort') || 'newest';
  const page = searchParams.get('page') || '1';

  document.getElementById('globalSearchInput').value = q;
  const qs = new URLSearchParams({ q, category, minPrice, maxPrice, sort, page }).toString();
  const data = await api(`/api/products?${qs}`);

  app.innerHTML = `
    <div class="panel">
      <form id="filterForm" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <div>
          <label class="muted">Category</label><br/>
          <select name="category">
            <option value="">All Categories</option>
            ${state.categories.map(c => `<option value="${escapeHtml(c.slug)}" ${category === c.slug ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="muted">Min Price (AMD)</label><br/>
          <input type="number" name="minPrice" value="${escapeHtml(minPrice)}" style="width:120px" />
        </div>
        <div>
          <label class="muted">Max Price (AMD)</label><br/>
          <input type="number" name="maxPrice" value="${escapeHtml(maxPrice)}" style="width:120px" />
        </div>
        <div>
          <label class="muted">Sort by</label><br/>
          <select name="sort">
            <option value="newest" ${sort === 'newest' ? 'selected' : ''}>Newest</option>
            <option value="price_asc" ${sort === 'price_asc' ? 'selected' : ''}>Price: Low to High</option>
            <option value="price_desc" ${sort === 'price_desc' ? 'selected' : ''}>Price: High to Low</option>
            <option value="rating" ${sort === 'rating' ? 'selected' : ''}>Highest Rating</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary">Apply</button>
      </form>
    </div>
    <p><strong>${data.total}</strong> result(s) found</p>
    ${data.items.length === 0
      ? `<div class="panel"><p>No products matched your filters.</p><a href="/products" class="btn" data-link>View all products</a></div>`
      : `<div class="grid">${data.items.map(productCardHtml).join('')}</div>`
    }
    <div style="margin-top:20px;display:flex;gap:8px">
      ${data.page > 1 ? `<button class="btn" id="prevPage">Previous</button>` : ''}
      <span style="padding:8px">Page ${data.page} of ${data.totalPages}</span>
      ${data.page < data.totalPages ? `<button class="btn" id="nextPage">Next</button>` : ''}
    </div>
  `;

  document.getElementById('filterForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (fd.get('category')) next.set('category', fd.get('category'));
    if (fd.get('minPrice')) next.set('minPrice', fd.get('minPrice'));
    if (fd.get('maxPrice')) next.set('maxPrice', fd.get('maxPrice'));
    if (fd.get('sort')) next.set('sort', fd.get('sort'));
    navigate(`/products?${next.toString()}`);
  };
  if (document.getElementById('prevPage')) {
    document.getElementById('prevPage').onclick = () => {
      const next = new URLSearchParams(searchParams);
      next.set('page', String(data.page - 1));
      navigate(`/products?${next.toString()}`);
    };
  }
  if (document.getElementById('nextPage')) {
    document.getElementById('nextPage').onclick = () => {
      const next = new URLSearchParams(searchParams);
      next.set('page', String(data.page + 1));
      navigate(`/products?${next.toString()}`);
    };
  }
}

async function renderProductDetail(app, id) {
  const { product, images, reviews } = await api(`/api/products/${id}`);
  const stockLabel = product.stock === 0
    ? '<span style="color:var(--danger);font-weight:700">Out of stock</span>'
    : product.stock <= 3
      ? `<span style="color:#d97706;font-weight:700">Only ${product.stock} left</span>`
      : '<span style="color:var(--success);font-weight:700">In stock</span>';

  app.innerHTML = `
    <div class="panel two-col">
      <div>
        <img id="mainProdImg" src="${escapeHtml(images[0]?.file_path || '')}" style="width:100%;max-height:420px;object-fit:contain;border-radius:8px;background:#f9fafb" />
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          ${images.map(im => `<img src="${escapeHtml(im.file_path)}" style="width:64px;height:64px;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid #ccc" onclick="document.getElementById('mainProdImg').src=this.src" />`).join('')}
        </div>
      </div>
      <div>
        <div class="muted">${escapeHtml(product.category_name)} • Sold by <strong>${escapeHtml(product.seller_store_name)}</strong></div>
        <h1 style="margin:8px 0">${escapeHtml(product.title)}</h1>
        <div class="muted">★ ${Number(product.rating_avg).toFixed(1)} (${product.rating_count} reviews)</div>
        <div class="price" style="font-size:1.6rem;margin:14px 0">${formatAmd(product.price_amd)}</div>
        <div style="margin-bottom:14px">${stockLabel}</div>
        <p style="line-height:1.5">${escapeHtml(product.description)}</p>
        <div id="prodMsg"></div>
        ${product.stock > 0 ? `
          <div style="display:flex;gap:10px;align-items:center;margin-top:16px">
            <input type="number" id="qtyInput" value="1" min="1" max="${product.stock}" style="width:80px;padding:8px" />
            <button class="btn btn-primary" id="addToCartBtn">Add to cart</button>
          </div>
        ` : ''}
      </div>
    </div>
    <div class="panel">
      <h3>Customer Reviews</h3>
      ${reviews.length === 0 ? '<p class="muted">No reviews yet.</p>' : reviews.map(r => `
        <div style="border-top:1px solid var(--border);padding:10px 0">
          <strong>${escapeHtml(r.buyer_name)}</strong> — <span>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
          <div class="muted">${new Date(r.created_at).toLocaleDateString()}</div>
          <p style="margin:6px 0 0">${escapeHtml(r.body)}</p>
        </div>
      `).join('')}
    </div>
  `;

  if (document.getElementById('addToCartBtn')) {
    document.getElementById('addToCartBtn').onclick = async () => {
      if (!state.user) return navigate('/login');
      const qty = Number(document.getElementById('qtyInput').value);
      try {
        const cart = await api(`/api/cart/items/${product.id}`, {
          method: 'PUT',
          body: JSON.stringify({ quantity: qty })
        });
        state.cartCount = cart.total_items_count;
        renderHeader();
        document.getElementById('prodMsg').innerHTML = `<div class="alert alert-ok">Added to cart! <a href="/cart" data-link>View Cart</a></div>`;
      } catch (err) {
        document.getElementById('prodMsg').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      }
    };
  }
}

async function renderCart(app) {
  if (!state.user) return navigate('/login');
  const cart = await api('/api/cart');
  state.cartCount = cart.total_items_count;
  renderHeader();

  if (cart.groups.length === 0) {
    app.innerHTML = `<div class="panel"><h2>Your Cart is Empty</h2><a href="/products" class="btn btn-primary" data-link>Continue Shopping</a></div>`;
    return;
  }

  app.innerHTML = `
    <h2>Shopping Cart</h2>
    <div id="cartErr"></div>
    ${cart.groups.map(g => `
      <div class="panel">
        <div class="flex-between" style="border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:10px">
          <strong>Seller: ${escapeHtml(g.seller_store_name)}</strong>
          <span>Subtotal: <strong>${formatAmd(g.subtotal_amd)}</strong></span>
        </div>
        ${g.items.map(it => `
          <div class="flex-between" style="padding:8px 0;border-bottom:1px solid #f3f4f6">
            <div>
              <a href="/products/${it.product_id}" data-link><strong>${escapeHtml(it.title)}</strong></a>
              <div class="muted">Price: ${formatAmd(it.current_price_amd)}</div>
              ${it.price_changed ? `<div class="alert alert-warn" style="margin:4px 0;padding:4px 8px">Price changed from ${formatAmd(it.price_when_added)} to ${formatAmd(it.current_price_amd)}. Update quantity to accept new price.</div>` : ''}
              ${it.out_of_stock ? `<div class="alert alert-error" style="margin:4px 0;padding:4px 8px">Sold out! Please remove this item.</div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="number" min="1" max="${it.stock}" value="${it.quantity}" data-pid="${it.product_id}" class="cartQtyInput" style="width:70px;padding:6px" />
              <button class="btn removeCartBtn" data-pid="${it.product_id}">Remove</button>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('')}
    <div class="panel flex-between">
      <div class="price" style="font-size:1.3rem">Grand Total: ${formatAmd(cart.grand_total_amd)}</div>
      <a href="/checkout" class="btn btn-primary" data-link>Proceed to checkout</a>
    </div>
  `;

  document.querySelectorAll('.cartQtyInput').forEach(inp => {
    inp.onchange = async () => {
      try {
        await api(`/api/cart/items/${inp.dataset.pid}`, {
          method: 'PUT',
          body: JSON.stringify({ quantity: Number(inp.value) })
        });
        renderCart(app);
      } catch (err) {
        document.getElementById('cartErr').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      }
    };
  });

  document.querySelectorAll('.removeCartBtn').forEach(btn => {
    btn.onclick = async () => {
      await api(`/api/cart/items/${btn.dataset.pid}`, { method: 'DELETE' });
      renderCart(app);
    };
  });
}

async function renderCheckout(app) {
  if (!state.user) return navigate('/login');
  const [cart, addrRes] = await Promise.all([api('/api/cart'), api('/api/orders/last-address')]);
  if (cart.groups.length === 0) return navigate('/cart');

  const prev = addrRes.address || {
    recipient: state.user.name,
    phone: state.user.phone,
    region: 'Yerevan',
    city: '',
    street: '',
    apartment: '',
    note: ''
  };
  const requestKey = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;

  app.innerHTML = `
    <h2>Checkout (Cash on Delivery)</h2>
    <div id="checkoutErr"></div>
    <div class="two-col">
      <form class="panel" id="checkoutForm">
        <h3>Delivery Address</h3>
        <div class="form-group"><label>Recipient Name</label><input name="recipient" value="${escapeHtml(prev.recipient)}" required /></div>
        <div class="form-group"><label>Phone</label><input name="phone" value="${escapeHtml(prev.phone)}" required /></div>
        <div class="form-group">
          <label>Region</label>
          <select name="region" required>
            ${MARZER.map(m => `<option value="${m}" ${prev.region === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>City or Village</label><input name="city" value="${escapeHtml(prev.city)}" required /></div>
        <div class="form-group"><label>Street & Building</label><input name="street" value="${escapeHtml(prev.street)}" required /></div>
        <div class="form-group"><label>Apartment</label><input name="apartment" value="${escapeHtml(prev.apartment)}" /></div>
        <div class="form-group"><label>Note for delivery</label><textarea name="note" rows="2">${escapeHtml(prev.note)}</textarea></div>
        <p><strong>Payment: cash on delivery</strong></p>
        <button type="submit" id="placeOrderBtn" class="btn btn-primary" style="width:100%">Place order (${formatAmd(cart.grand_total_amd)})</button>
      </form>
      <div class="panel">
        <h3>Order Summary</h3>
        ${cart.groups.map(g => `
          <div style="margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:10px">
            <strong>Seller: ${escapeHtml(g.seller_store_name)}</strong>
            ${g.items.map(it => `<div class="flex-between muted"><span>${escapeHtml(it.title)} × ${it.quantity}</span><span>${formatAmd(it.line_total_amd)}</span></div>`).join('')}
          </div>
        `).join('')}
        <div class="price">Total to pay on delivery: ${formatAmd(cart.grand_total_amd)}</div>
      </div>
    </div>
  `;

  document.getElementById('checkoutForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('placeOrderBtn');
    btn.disabled = true;
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    payload.request_key = requestKey;

    try {
      const { order } = await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
      state.cartCount = 0;
      renderHeader();
      navigate(`/orders/${order.id}?confirmed=1`);
    } catch (err) {
      btn.disabled = false;
      document.getElementById('checkoutErr').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  };
}

async function renderBuyerOrders(app) {
  if (!state.user) return navigate('/login');
  const { orders } = await api('/api/orders');
  app.innerHTML = `
    <h2>My Orders</h2>
    ${orders.length === 0 ? '<div class="panel">You have no orders yet.</div>' : orders.map(o => `
      <div class="panel flex-between">
        <div>
          <a href="/orders/${o.id}" data-link><strong>Order #${o.id}</strong></a>
          <div class="muted">${new Date(o.created_at).toLocaleString()} • ${escapeHtml(o.region)}, ${escapeHtml(o.city)}</div>
          <div style="margin-top:6px">
            ${o.seller_orders.map(so => `<span class="badge badge-${so.status}" style="margin-right:6px">${escapeHtml(so.seller_store_name)}: ${so.status}</span>`).join('')}
          </div>
        </div>
        <div style="text-align:right">
          <div class="price">${formatAmd(o.total_amd)}</div>
          <a href="/orders/${o.id}" class="btn" style="margin-top:6px" data-link>Details</a>
        </div>
      </div>
    `).join('')}
  `;
}

async function renderBuyerOrderDetail(app, id, isConfirmed) {
  if (!state.user) return navigate('/login');
  const { order } = await api(`/api/orders/${id}`);
  app.innerHTML = `
    ${isConfirmed ? `<div class="alert alert-ok">Order #${order.id} confirmed! Pay cash on delivery.</div>` : ''}
    <div class="panel">
      <div class="flex-between">
        <h2>Order #${order.id}</h2>
        <div class="price">Total: ${formatAmd(order.total_amd)}</div>
      </div>
      <p class="muted">Delivery to: <strong>${escapeHtml(order.recipient)}</strong> (${escapeHtml(order.phone)}) — ${escapeHtml(order.region)}, ${escapeHtml(order.city)}, ${escapeHtml(order.street)} ${escapeHtml(order.apartment)}</p>
      ${order.note ? `<p class="muted">Note: ${escapeHtml(order.note)}</p>` : ''}
    </div>
    <div id="orderDetailMsg"></div>
    ${order.seller_orders.map(so => `
      <div class="panel">
        <div class="flex-between">
          <div>
            <strong>Seller: ${escapeHtml(so.seller_store_name)}</strong>
            <span class="badge badge-${so.status}" style="margin-left:8px">${so.status}</span>
          </div>
          <div>
            ${(so.status === 'placed' || so.status === 'confirmed') ? `<button class="btn btn-danger cancelPartBtn" data-soid="${so.id}">Cancel part</button>` : ''}
          </div>
        </div>
        <div style="margin:12px 0">
          ${so.items.map(it => `
            <div class="flex-between" style="padding:6px 0;border-bottom:1px solid #f3f4f6">
              <span>${escapeHtml(it.title)} × ${it.quantity} (${formatAmd(it.unit_price_amd)} each)</span>
              <div>
                ${so.status === 'delivered' && !it.has_reviewed ? `<button class="btn btn-primary openReviewBtn" data-pid="${it.product_id}" data-title="${escapeHtml(it.title)}">Write a review</button>` : ''}
                ${it.has_reviewed ? `<span class="muted">Reviewed ✓</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <div class="muted" style="font-size:0.82rem">
          <strong>Status history:</strong>
          ${so.history.map(h => `${h.to_status} (${new Date(h.created_at).toLocaleString()})`).join(' → ')}
        </div>
      </div>
    `).join('')}
    <div id="reviewModalArea"></div>
  `;

  document.querySelectorAll('.cancelPartBtn').forEach(btn => {
    btn.onclick = async () => {
      try {
        await api(`/api/orders/${order.id}/sellers/${btn.dataset.soid}/cancel`, { method: 'POST' });
        renderBuyerOrderDetail(app, id, false);
      } catch (err) {
        document.getElementById('orderDetailMsg').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      }
    };
  });

  document.querySelectorAll('.openReviewBtn').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('reviewModalArea').innerHTML = `
        <form class="panel" id="reviewForm">
          <h3>Write a review for ${escapeHtml(btn.dataset.title)}</h3>
          <div class="form-group">
            <label>Rating (1-5)</label>
            <select name="rating"><option value="5">5 ★</option><option value="4">4 ★</option><option value="3">3 ★</option><option value="2">2 ★</option><option value="1">1 ★</option></select>
          </div>
          <div class="form-group"><label>Review</label><textarea name="body" rows="3" required></textarea></div>
          <button type="submit" class="btn btn-primary">Submit Review</button>
        </form>
      `;
      document.getElementById('reviewForm').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api(`/api/products/${btn.dataset.pid}/reviews`, {
            method: 'POST',
            body: JSON.stringify({ rating: Number(fd.get('rating')), body: fd.get('body') })
          });
          renderBuyerOrderDetail(app, id, false);
        } catch (err) {
          document.getElementById('orderDetailMsg').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
        }
      };
    };
  });
}

async function renderAuth(app, mode) {
  app.innerHTML = `
    <form class="panel" id="authForm" style="max-width:440px;margin:20px auto">
      <h2>${mode === 'login' ? 'Log in' : 'Create Account'}</h2>
      <div id="authErr"></div>
      ${mode === 'register' ? `
        <div class="form-group"><label>Full Name</label><input name="name" required /></div>
        <div class="form-group"><label>Phone</label><input name="phone" placeholder="+374..." required /></div>
      ` : ''}
      <div class="form-group"><label>Email</label><input type="email" name="email" required /></div>
      <div class="form-group"><label>Password</label><input type="password" name="password" required /></div>
      <button type="submit" class="btn btn-primary" style="width:100%">${mode === 'login' ? 'Log in' : 'Register'}</button>
    </form>
  `;
  document.getElementById('authForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
      await refreshSession();
      navigate('/');
    } catch (err) {
      document.getElementById('authErr').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  };
}

async function renderSellerActivate(app) {
  if (!state.user) return navigate('/login');
  app.innerHTML = `
    <form class="panel" id="activateForm" style="max-width:460px;margin:20px auto">
      <h2>Sell on Shuka</h2>
      <div id="actErr"></div>
      <div class="form-group"><label>Store Name</label><input name="store_name" required /></div>
      <div class="form-group"><label>Business Phone</label><input name="phone" value="${escapeHtml(state.user.phone)}" required /></div>
      <button type="submit" class="btn btn-primary" style="width:100%">Activate Seller Store</button>
    </form>
  `;
  document.getElementById('activateForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/seller/activate', { method: 'POST', body: JSON.stringify(payload) });
      await refreshSession();
      navigate('/seller');
    } catch (err) {
      document.getElementById('actErr').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  };
}

async function renderSellerDashboard(app, subPath) {
  if (!state.user || !state.user.store_name) return navigate('/seller/activate');

  if (subPath === '/seller/products/new' || subPath.startsWith('/seller/products/edit/')) {
    const editId = subPath.startsWith('/seller/products/edit/') ? subPath.split('/').pop() : null;
    let existing = { title: '', category_id: state.categories[0]?.id || 1, description: '', price_amd: '', stock: 1, is_published: 1 };
    let images = [];
    if (editId) {
      const data = await api(`/api/seller/products/${editId}`);
      existing = data.product;
      images = data.images;
    }

    app.innerHTML = `
      <div class="panel" style="max-width:640px;margin:0 auto">
        <h2>${editId ? 'Edit Product' : 'Add New Product'}</h2>
        <div id="prodFormErr"></div>
        <form id="sellerProdForm">
          <div class="form-group"><label>Title</label><input name="title" value="${escapeHtml(existing.title)}" required /></div>
          <div class="form-group">
            <label>Category</label>
            <select name="category_id">
              ${state.categories.map(c => `<option value="${c.id}" ${Number(existing.category_id) === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Description</label><textarea name="description" rows="3" required>${escapeHtml(existing.description)}</textarea></div>
          <div class="two-col">
            <div class="form-group"><label>Price (AMD)</label><input type="number" name="price_amd" min="1" value="${escapeHtml(existing.price_amd)}" required /></div>
            <div class="form-group"><label>Stock</label><input type="number" name="stock" min="0" value="${escapeHtml(existing.stock)}" required /></div>
          </div>
          <div class="form-group">
            <label>Images (up to 5 total)</label>
            <input type="file" id="prodImagesInput" accept="image/jpeg,image/png,image/webp" multiple />
          </div>
          ${images.length > 0 ? `
            <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
              ${images.map(im => `
                <div style="text-align:center">
                  <img src="${escapeHtml(im.file_path)}" style="width:70px;height:70px;object-fit:cover;display:block;border-radius:4px" />
                  <button type="button" class="btn delImgBtn" data-imgid="${im.id}" style="padding:2px 6px;font-size:0.75rem;margin-top:4px">Delete</button>
                </div>
              `).join('')}
            </div>
          ` : ''}
          <button type="submit" class="btn btn-primary">Save Product</button>
          <a href="/seller" class="btn" data-link>Back</a>
        </form>
      </div>
    `;

    document.querySelectorAll('.delImgBtn').forEach(btn => {
      btn.onclick = async () => {
        await api(`/api/seller/products/${editId}/images/${btn.dataset.imgid}`, { method: 'DELETE' });
        renderSellerDashboard(app, subPath);
      };
    });

    document.getElementById('sellerProdForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        title: fd.get('title'),
        category_id: Number(fd.get('category_id')),
        description: fd.get('description'),
        price_amd: Number(fd.get('price_amd')),
        stock: Number(fd.get('stock'))
      };
      try {
        let prodId = editId;
        if (editId) {
          await api(`/api/seller/products/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        } else {
          const created = await api('/api/seller/products', { method: 'POST', body: JSON.stringify(payload) });
          prodId = created.product.id;
        }
        const files = document.getElementById('prodImagesInput').files;
        if (files && files.length > 0) {
          const imgFd = new FormData();
          for (const f of files) imgFd.append('images', f);
          await api(`/api/seller/products/${prodId}/images`, { method: 'POST', body: imgFd });
        }
        navigate('/seller');
      } catch (err) {
        document.getElementById('prodFormErr').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      }
    };
    return;
  }

  if (subPath.startsWith('/seller/orders/')) {
    const soId = subPath.split('/').pop();
    const { order } = await api(`/api/seller/orders/${soId}`);
    const nextMoves = {
      placed: ['confirmed', 'cancelled'],
      confirmed: ['shipped', 'cancelled'],
      shipped: ['delivered'],
      delivered: [],
      cancelled: []
    }[order.status] || [];

    app.innerHTML = `
      <div class="panel">
        <div class="flex-between">
          <h2>Seller Order #${order.id} (Buyer Order #${order.order_id})</h2>
          <span class="badge badge-${order.status}">${order.status}</span>
        </div>
        <p><strong>Recipient:</strong> ${escapeHtml(order.recipient)} • <strong>Phone:</strong> ${escapeHtml(order.phone)}</p>
        <p><strong>Address:</strong> ${escapeHtml(order.region)}, ${escapeHtml(order.city)}, ${escapeHtml(order.street)} ${escapeHtml(order.apartment)}</p>
        ${order.note ? `<p><strong>Delivery Note:</strong> ${escapeHtml(order.note)}</p>` : ''}
        <p class="price">Cash to collect: ${formatAmd(order.subtotal_amd)}</p>
        <div id="sellerOrderErr"></div>
        <div style="display:flex;gap:10px;margin:14px 0">
          ${nextMoves.map(m => `<button class="btn ${m === 'cancelled' ? 'btn-danger' : 'btn-primary'} moveStatusBtn" data-to="${m}">Mark as ${m}</button>`).join('')}
          <a href="/seller" class="btn" data-link>Back to Dashboard</a>
        </div>
        <h4>Items</h4>
        ${order.items.map(it => `<div class="flex-between" style="padding:6px 0;border-bottom:1px solid #eee"><span>${escapeHtml(it.title)} × ${it.quantity}</span><span>${formatAmd(it.unit_price_amd * it.quantity)}</span></div>`).join('')}
        <h4 style="margin-top:16px">Status History</h4>
        <div class="muted">${order.history.map(h => `${h.to_status} (${new Date(h.created_at).toLocaleString()})`).join(' → ')}</div>
      </div>
    `;

    document.querySelectorAll('.moveStatusBtn').forEach(btn => {
      btn.onclick = async () => {
        try {
          await api(`/api/seller/orders/${order.id}/status`, {
            method: 'POST',
            body: JSON.stringify({ to: btn.dataset.to })
          });
          renderSellerDashboard(app, subPath);
        } catch (err) {
          document.getElementById('sellerOrderErr').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
        }
      };
    });
    return;
  }

  // Main Seller Overview + Orders + Products
  const [overview, prodRes, ordRes] = await Promise.all([
    api('/api/seller/overview'),
    api('/api/seller/products'),
    api('/api/seller/orders')
  ]);

  app.innerHTML = `
    <div class="flex-between" style="margin-bottom:14px">
      <h2>Seller Dashboard — ${escapeHtml(state.user.store_name)}</h2>
      <a href="/seller/products/new" class="btn btn-primary" data-link>+ Add Product</a>
    </div>
    <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="panel"><div class="muted">Orders to Confirm</div><div class="price" style="font-size:1.5rem">${overview.to_confirm}</div></div>
      <div class="panel"><div class="muted">Orders to Ship</div><div class="price" style="font-size:1.5rem">${overview.to_ship}</div></div>
      <div class="panel"><div class="muted">Delivered Revenue (30d)</div><div class="price" style="font-size:1.5rem">${formatAmd(overview.revenue_30d_amd)}</div></div>
    </div>
    <div class="panel">
      <h3>Incoming Orders</h3>
      ${ordRes.orders.length === 0 ? '<p class="muted">No incoming orders yet.</p>' : `
        <table>
          <thead><tr><th>ID</th><th>Recipient</th><th>Address</th><th>Cash</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${ordRes.orders.map(o => `
              <tr>
                <td>#${o.id}</td>
                <td>${escapeHtml(o.recipient)}<br/><span class="muted">${escapeHtml(o.phone)}</span></td>
                <td>${escapeHtml(o.region)}, ${escapeHtml(o.city)}</td>
                <td>${formatAmd(o.subtotal_amd)}</td>
                <td><span class="badge badge-${o.status}">${o.status}</span></td>
                <td><a href="/seller/orders/${o.id}" class="btn" data-link>Manage</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
    <div class="panel">
      <h3>My Products</h3>
      <table>
        <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Sold</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${prodRes.products.map(p => `
            <tr>
              <td>${escapeHtml(p.title)}</td>
              <td>${formatAmd(p.price_amd)}</td>
              <td>${p.stock}</td>
              <td>${p.units_sold}</td>
              <td>${p.is_published ? 'Published' : 'Unpublished'}</td>
              <td style="display:flex;gap:6px">
                <a href="/seller/products/edit/${p.id}" class="btn" data-link>Edit</a>
                <button class="btn togglePubBtn" data-pid="${p.id}" data-pub="${p.is_published ? 0 : 1}">${p.is_published ? 'Unpublish' : 'Publish'}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll('.togglePubBtn').forEach(btn => {
    btn.onclick = async () => {
      await api(`/api/seller/products/${btn.dataset.pid}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_published: Number(btn.dataset.pub) })
      });
      renderSellerDashboard(app, '/seller');
    };
  });
}

async function render() {
  const app = document.getElementById('app');
  const path = window.location.pathname;
  const searchParams = new URLSearchParams(window.location.search);

  try {
    if (path === '/') return await renderHome(app);
    if (path === '/products') return await renderCatalog(app, searchParams);
    if (path.startsWith('/products/')) return await renderProductDetail(app, path.split('/').pop());
    if (path === '/cart') return await renderCart(app);
    if (path === '/checkout') return await renderCheckout(app);
    if (path === '/orders') return await renderBuyerOrders(app);
    if (path.startsWith('/orders/')) return await renderBuyerOrderDetail(app, path.split('/').pop(), searchParams.get('confirmed') === '1');
    if (path === '/login') return await renderAuth(app, 'login');
    if (path === '/register') return await renderAuth(app, 'register');
    if (path === '/seller/activate') return await renderSellerActivate(app);
    if (path === '/seller' || path.startsWith('/seller/')) return await renderSellerDashboard(app, path);
    app.innerHTML = '<div class="panel"><h2>Page not found</h2></div>';
  } catch (err) {
    app.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

refreshSession().then(render);
