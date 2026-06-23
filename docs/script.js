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
    const times = forecast.map(f => f.Tijd);
    const thiIn = forecast.map(f => f.THI_In);
    const thiOut = forecast.map(f => f.THI_Out);

    const traceIn = {
        x: times,
        y: thiIn,
        name: 'THI Binnen',
        mode: 'lines+markers',
        line: { color: 'black' }
    };

    const traceOut = {
        x: times,
        y: thiOut,
        name: 'THI Buiten',
        mode: 'lines',
        line: { color: 'blue', dash: 'dash' }
    };

    const layout = {
        yaxis: { range: [30, 85], title: 'THI' },
        hovermode: 'x unified',
        legend: { orientation: 'h', y: -0.2 },
        margin: { t: 20, b: 50, l: 50, r: 20 },
        shapes: [
            { type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 68, fillcolor: 'lightgreen', opacity: 0.2, line: {width: 0}, layer: 'below' },
            { type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 68, y1: 72, fillcolor: 'yellow', opacity: 0.2, line: {width: 0}, layer: 'below' },
            { type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 72, y1: 78, fillcolor: 'orange', opacity: 0.2, line: {width: 0}, layer: 'below' },
            { type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 78, y1: 82, fillcolor: 'red', opacity: 0.2, line: {width: 0}, layer: 'below' },
            { type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 82, y1: 100, fillcolor: 'darkred', opacity: 0.2, line: {width: 0}, layer: 'below' }
        ],
        height: 600,
        // width: 800,
    };

    const config = {
        staticPlot: true,
        responsive: true,
        format: 'svg'
    }

    Plotly.newPlot('thi-chart', [traceIn, traceOut], layout, config);
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
