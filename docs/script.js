async function init() {
    try {
        const response = await fetch('data/stations.json');
        const stations = await response.json();
        const select = document.getElementById('station-select');

        stations.forEach(station => {
            const option = document.createElement('option');
            option.value = station.file;
            option.textContent = station.name;
            if (station.name === "Leeuwarden") option.selected = true;  // Set Leeuwarden as the default selected station
            select.appendChild(option);
        });

        // Load default station
        loadStation('leeuwarden.json');
    } catch (e) {
        console.error('[init] Error initializing stations:', e);
    }
}

const SUPABASE_URL = 'https://yxyyhgksenptvdvvpqvr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4eXloZ2tzZW5wdHZkdnZwcXZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTA4NjcsImV4cCI6MjA4ODk4Njg2N30.fKLtk_xSu-Tm8wzJZdcC5UD88Af-SXr0kjxpKn9lowg';
const SUPABASE_TABLE = 'subscriptions';
const PUBLIC_VAPID_KEY = 'BHRipgAwNL204yCr1YljpgyTUnUgK3bt8EAyf0k-QTb2iYRbFfI3l6WuO08UU8HcDD-REzJIn3B8ao6hVrDE4Ts';

const subscribeButton = document.getElementById('subscribe-button');
const unsubscribeButton = document.getElementById('unsubscribe-button');
const statusElement = document.getElementById('status');

let serviceWorkerRegistration;

function setStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    }
}

function isConfigReady() {
    const ready = ![
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        PUBLIC_VAPID_KEY,
    ].some((value) => value.startsWith('YOUR_') || value.includes('YOUR_PROJECT'));
    return ready;
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let index = 0; index < rawData.length; index += 1) {
        outputArray[index] = rawData.charCodeAt(index);
    }

    return outputArray;
}

function getApplicationServerKey() {
    if (PUBLIC_VAPID_KEY.startsWith('sb_publishable_')) {
        throw new Error('PUBLIC_VAPID_KEY is nu een Supabase publishable key. Vul hier de echte web-push VAPID public key in.');
    }

    if (!/^[A-Za-z0-9_-]+$/.test(PUBLIC_VAPID_KEY)) {
        throw new Error('PUBLIC_VAPID_KEY moet een base64url-gecodeerde VAPID public key zijn.');
    }

    const applicationServerKey = urlBase64ToUint8Array(PUBLIC_VAPID_KEY);

    if (applicationServerKey.length !== 65) {
        throw new Error('PUBLIC_VAPID_KEY is ongeldig. Voor web push verwacht de browser een P-256 public key van 65 bytes.');
    }

    return applicationServerKey;
}

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service workers worden niet ondersteund in deze browser. Wissel van browser of update naar een recentere versie om u te aboneren op hittestress updates.');
    }

    await navigator.serviceWorker.register('./sw.js');
    return navigator.serviceWorker.ready;
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        throw new Error('Notifications worden niet ondersteund in deze browser.');
    }

    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
        throw new Error('Notificatiepermissie is niet toegekend.');
    }
}

async function createPushSubscription(registration) {
    if (!('PushManager' in window)) {
        throw new Error('Push API wordt niet ondersteund in deze browser.');
    }

    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
        return existingSubscription;
    }

    return registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: getApplicationServerKey(),
    });
}

function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict`;
}

function getCookie(name) {
    return document.cookie.split('; ').reduce((acc, part) => {
        const [k, v] = part.split('=');
        return k === name ? decodeURIComponent(v) : acc;
    }, null);
}

function deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

async function saveSubscription(subscription) {
    const subscriptionData = subscription.toJSON();
    setCookie('subscription', JSON.stringify(subscriptionData), 365);

    // Check if endpoint already exists
    const checkResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=id&data->>'endpoint'=eq.${subscriptionData.endpoint}`,
        {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
        }
    );

    const existing = await checkResponse.json();
    if (existing.length > 0) {
        console.log('Subscription already exists, reusing row id:', existing[0].id);
        setCookie('supabase_row_id', existing[0].id, 365);
        return;
    }

    // Insert new row
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
        },
        body: JSON.stringify([{
            data: {
                endpoint: subscription.endpoint,
                subscription: subscriptionData,
                keys: subscriptionData.keys || null,
                saved_at: new Date().toISOString(),
            },
        }]),
    });

    if (!response.ok) {
        if (response.status === 409) {
            setStatus('Je bent al geabonneerd op notificaties.');
            return;
        }
        const errorBody = await response.text();
        throw new Error(`Supabase opslag mislukt: ${response.status} ${errorBody}`);
    }

    const rows = await response.json();
    setCookie('supabase_row_id', rows[0].id, 365);
    console.log('Saved new row id:', rows[0].id);
}

async function removeSubscriptionFromSupabase() {
    const id = getCookie('supabase_row_id');
    if (!id) throw new Error('Geen rij-id gevonden in cookie.');

    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${id}`, {
        method: 'DELETE',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            Prefer: 'return=minimal',
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Supabase verwijdering mislukt: ${response.status} ${errorBody}`);
    }

    deleteCookie('supabase_row_id');
}

async function subscribeToNotifications() {
    if (!isConfigReady()) {
        throw new Error('Vul eerst je Supabase- en VAPID-configuratie in bovenaan script.js in.');
    }

    setStatus('Service worker registreren...');
    serviceWorkerRegistration = serviceWorkerRegistration || await registerServiceWorker();

    setStatus('Notificatiepermissie aanvragen...');
    await requestNotificationPermission();

    setStatus('Push subscription aanmaken...');
    const subscription = await createPushSubscription(serviceWorkerRegistration);

    setStatus('Subscription naar Supabase sturen...');
    await saveSubscription(subscription);

    setStatus('Klaar. De browser is geabonneerd en de subscription staat in Supabase.');
}

async function unsubscribeFromNotifications() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service workers worden niet ondersteund in deze browser.');
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
        setStatus('Er is geen actieve subscription om te verwijderen.');
        return;
    }

    const endpoint = subscription.endpoint;
    setStatus('Subscription verwijderen uit de browser...');
    await subscription.unsubscribe();

    setStatus('Subscription verwijderen uit Supabase...');
    await removeSubscriptionFromSupabase();

    setStatus('Klaar. Deze browser is gedesubscribed en uit Supabase verwijderd.');
}

async function initNotifications() {
    try {
        serviceWorkerRegistration = await registerServiceWorker();
        setStatus('Service worker geregistreerd. Klik op de knop om te abonneren.');
    } catch (error) {
        setStatus(error.message);
        subscribeButton.disabled = true;
        console.error('[initNotifications] startup registration failed', error);
        return;
    }

    subscribeButton.addEventListener('click', async () => {
        subscribeButton.disabled = true;

        try {
            await subscribeToNotifications();
        } catch (error) {
            setStatus(error.message);
            console.error('[subscribe-button click] subscription failed', error);
        } finally {
            subscribeButton.disabled = false;
        }
    });
    unsubscribeButton.addEventListener('click', async () => {
        unsubscribeButton.disabled = true;

        try {
            await unsubscribeFromNotifications();
        } catch (error) {
            setStatus(error.message);
            console.error('[unsubscribe-button click] unsubscribe failed', error);
        } finally {
            unsubscribeButton.disabled = false;
        }
    });
}

async function loadStation(filename) {
    try {
        const response = await fetch(`data/${filename}`);
        const data = await response.json();
        updateUI(data);
    } catch (e) {
        console.error('[loadStation] Error loading station data:', e);
    }
}

function updateUI(data) {
    // Update status box
    const maxTHI = Math.max(...data.forecast.map(f => f.THI_In));
    const statusBox = document.getElementById('status-box');

    if (maxTHI < 68) {
        statusBox.className = 'status-box status-green';
        statusBox.textContent = 'Geen stress';
    } else if (maxTHI < 72) {
        statusBox.className = 'status-box status-orange';
        statusBox.textContent = 'Stress in aantocht';
    } else {
        statusBox.className = 'status-box status-red';
        statusBox.textContent = 'Stress!';
    }

    // Update Chart
    renderChart(data.forecast);

    // Update Table
    const tbody = document.querySelector('#forecast-table tbody');
    tbody.innerHTML = '';
    data.forecast.forEach(f => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${f.Tijd}</td>
            <td>${f.Temp_Out}</td>
            <td>${f.RH}</td>
            <td>${f.THI_Out}</td>
            <td>${f.THI_In}</td>
            <td>${f.Advies}</td>
        `;
        tbody.appendChild(tr);
    });

    // Update Buienradar
    const iframe = document.getElementById('buienradar-iframe');
    iframe.src = `https://gadgets.buienradar.nl/gadget/zoommap/?lat=${data.lat}&lng=${data.lon}&overname=2&zoom=8&naam=${data.station}&size=3&voor=0`;

    // Update Footer
    document.getElementById('last-updated').textContent = `Laatst bijgewerkt: ${data.updated_at}`;
}

function renderChart(forecast) {
    const container = document.getElementById('thi-chart');
    const W = 575, H = 200, ox = 50, oy = 10;
    const minY = 30, maxY = 85;
    const n = forecast.length;

    function yPos(v) { return oy + H - ((v - minY) / (maxY - minY)) * H; }
    function xPos(i) { return ox + (i / (n - 1)) * W; }

    const zones = [
        { y0: 30, y1: 68, fill: '#c8e6c9' },
        { y0: 68, y1: 72, fill: '#fff9c4' },
        { y0: 72, y1: 78, fill: '#ffe0b2' },
        { y0: 78, y1: 82, fill: '#ffcdd2' },
        { y0: 82, y1: 85, fill: '#ef9a9a' },
    ];

    function pts(vals) {
        return vals.map((v, i) => `${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ');
    }

    const thiIn = forecast.map(f => f.THI_In);
    const thiOut = forecast.map(f => f.THI_Out);
    const times = forecast.map(f => f.Tijd);

    const zoneRects = zones.map(z => {
        const top = yPos(z.y1), bot = yPos(z.y0);
        return `<rect x="${ox}" y="${top.toFixed(1)}" width="${W}" height="${(bot - top).toFixed(1)}" fill="${z.fill}" opacity="0.5" clip-path="url(#thi-cp)"/>`;
    }).join('');

    const gridLines = [30, 40, 50, 60, 68, 72, 78, 82].map(v => {
        const y = yPos(v).toFixed(1);
        return `<line x1="${ox}" x2="${ox + W}" y1="${y}" y2="${y}" stroke="#B4B2A9" stroke-width="0.5"/>
                <text x="${ox - 6}" y="${(yPos(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#5F5E5A">${v}</text>`;
    }).join('');

    const xLabels = times.map((t, i) => {
        const x = xPos(i).toFixed(1);
        return `<line x1="${x}" x2="${x}" y1="${oy + H}" y2="${oy + H + 4}" stroke="#B4B2A9" stroke-width="0.5"/>
            <text x="${x}" y="${oy + H + 6}" text-anchor="start" font-size="10" fill="#5F5E5A"
                  transform="rotate(90, ${x}, ${oy + H + 6})">${t}</text>`;
    }).join('');

    const dots = thiIn.map((v, i) =>
        `<circle cx="${xPos(i).toFixed(1)}" cy="${yPos(v).toFixed(1)}" r="4" fill="#2C2C2A" clip-path="url(#thi-cp)"/>`
    ).join('');

    container.innerHTML = `
    <svg viewBox="0 0 640 300" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">
      <defs><clipPath id="thi-cp"><rect x="${ox}" y="${oy}" width="${W}" height="${H}"/></clipPath></defs>
      ${zoneRects}
      ${gridLines}
      <polyline points="${pts(thiOut)}" fill="none" stroke="#378ADD" stroke-width="2.5" stroke-dasharray="6 4" stroke-linejoin="round" clip-path="url(#thi-cp)"/>
      <polyline points="${pts(thiIn)}"  fill="none" stroke="#2C2C2A" stroke-width="2.5" stroke-linejoin="round" clip-path="url(#thi-cp)"/>
      ${dots}
      ${xLabels}
      <rect x="${ox}" y="${oy}" width="${W}" height="${H}" fill="none" stroke="#B4B2A9" stroke-width="0.5"/>
    </svg>`;
}

function showPage(pageId) {
    document.getElementById('page-home').style.display = pageId === 'home' ? 'block' : 'none';
    document.getElementById('page-register').style.display = pageId === 'register' ? 'block' : 'none';
    document.getElementById('page-about').style.display = pageId === 'about' ? 'block' : 'none';
}

function handleRegister(event) {
    event.preventDefault();
    const name = event.target.name.value;
    document.getElementById('register-msg').innerHTML = `
        <div style="background: #d4edda; color: #155724; padding: 15px; border-radius: 5px; margin-top: 20px;">
            Bedankt voor je inschrijving, ${name}! Je ontvangt binnenkort een maatwerk alert.
        </div>
    `;
}

void initNotifications();
init();
