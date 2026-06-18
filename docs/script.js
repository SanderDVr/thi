async function init() {
    console.log('[init] starting station load');
    try {
        const response = await fetch('data/stations.json');
        console.log('[init] fetched data/stations.json', response.status);
        const stations = await response.json();
        const select = document.getElementById('station-select');
        console.log('[init] station count', stations.length, 'select found:', !!select);
        
        stations.forEach(station => {
            console.log('[init] adding station option', station.name, station.file);
            const option = document.createElement('option');
            option.value = station.file;
            option.textContent = station.name;
            if (station.name === "Leeuwarden") option.selected = true;
            select.appendChild(option);
        });

        // Load default station
        console.log('[init] loading default station leeuwarden.json');
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
const statusElement = document.getElementById('status');

let serviceWorkerRegistration;

function setStatus(message) {
    console.log('[setStatus]', message);
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
    console.log('[isConfigReady]', ready);
    return ready;
}

function urlBase64ToUint8Array(base64String) {
    console.log('[urlBase64ToUint8Array] input length', base64String.length);
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let index = 0; index < rawData.length; index += 1) {
        outputArray[index] = rawData.charCodeAt(index);
    }

    console.log('[urlBase64ToUint8Array] output length', outputArray.length);
    return outputArray;
}

function getApplicationServerKey() {
    console.log('[getApplicationServerKey] validating public key');
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

    console.log('[getApplicationServerKey] key valid');
    return applicationServerKey;
}

async function registerServiceWorker() {
    console.log('[registerServiceWorker] start');
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service workers worden niet ondersteund in deze browser.');
    }

    await navigator.serviceWorker.register('./sw.js');
    console.log('[registerServiceWorker] registered ./sw.js');
    return navigator.serviceWorker.ready;
}

async function requestNotificationPermission() {
    console.log('[requestNotificationPermission] start');
    if (!('Notification' in window)) {
        throw new Error('Notifications worden niet ondersteund in deze browser.');
    }

    const permission = await Notification.requestPermission();
    console.log('[requestNotificationPermission] result', permission);

    if (permission !== 'granted') {
        throw new Error('Notificatiepermissie is niet toegekend.');
    }
}

async function createPushSubscription(registration) {
    console.log('[createPushSubscription] start');
    if (!('PushManager' in window)) {
        throw new Error('Push API wordt niet ondersteund in deze browser.');
    }

    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
        console.log('[createPushSubscription] reusing existing subscription');
        return existingSubscription;
    }

    console.log('[createPushSubscription] creating new subscription');
    return registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: getApplicationServerKey(),
    });
}

async function saveSubscription(subscription) {
    console.log('[saveSubscription] start', subscription.endpoint);
    const subscriptionData = subscription.toJSON();
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
        },
        body: JSON.stringify([
            {
                data: {
                    endpoint: subscription.endpoint,
                    subscription: subscriptionData,
                    keys: subscriptionData.keys || null,
                    saved_at: new Date().toISOString(),
                },
            },
        ]),
    });

    console.log('[saveSubscription] response', response.status, response.ok);
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Supabase opslag mislukt: ${response.status} ${errorBody}`);
    }
}

async function subscribeToNotifications() {
    console.log('[subscribeToNotifications] start');
    if (!isConfigReady()) {
        throw new Error('Vul eerst je Supabase- en VAPID-configuratie in bovenaan script.js in.');
    }

    setStatus('Service worker registreren...');
    serviceWorkerRegistration = serviceWorkerRegistration || await registerServiceWorker();
    console.log('[subscribeToNotifications] service worker ready');

    setStatus('Notificatiepermissie aanvragen...');
    await requestNotificationPermission();
    console.log('[subscribeToNotifications] permission granted');

    setStatus('Push subscription aanmaken...');
    const subscription = await createPushSubscription(serviceWorkerRegistration);
    console.log('[subscribeToNotifications] subscription created', subscription.endpoint);

    setStatus('Subscription naar Supabase sturen...');
    await saveSubscription(subscription);

    setStatus('Klaar. De browser is geabonneerd en de subscription staat in Supabase.');
    console.log('[subscribeToNotifications] finished');
}

async function initNotifications() {
    console.log('[initNotifications] start');
    if (!subscribeButton || !statusElement) {
        console.log('[initNotifications] missing subscribeButton or statusElement');
        return;
    }

    try {
        serviceWorkerRegistration = await registerServiceWorker();
        setStatus('Service worker geregistreerd. Klik op de knop om te abonneren.');
        console.log('[initNotifications] service worker registered on startup');
    } catch (error) {
        setStatus(error.message);
        subscribeButton.disabled = true;
        console.error('[initNotifications] startup registration failed', error);
        return;
    }

    subscribeButton.addEventListener('click', async () => {
        console.log('[subscribe-button click] received');
        subscribeButton.disabled = true;

        try {
            await subscribeToNotifications();
        } catch (error) {
            setStatus(error.message);
            console.error('[subscribe-button click] subscription failed', error);
        } finally {
            console.log('[subscribe-button click] re-enabling button');
            subscribeButton.disabled = false;
        }
    });
}

async function loadStation(filename) {
    console.log('[loadStation] start', filename);
    try {
        const response = await fetch(`data/${filename}`);
        console.log('[loadStation] fetch status', response.status);
        const data = await response.json();
        console.log('[loadStation] loaded station', data.station, 'forecast items', data.forecast?.length);
        updateUI(data);
    } catch (e) {
        console.error('[loadStation] Error loading station data:', e);
    }
}

function updateUI(data) {
    console.log('[updateUI] start', data.station, data.updated_at);
    // Update status box
    const maxTHI = Math.max(...data.forecast.map(f => f.THI_In));
    const statusBox = document.getElementById('status-box');
    console.log('[updateUI] maxTHI', maxTHI, 'statusBox found:', !!statusBox);
    
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
    console.log('[updateUI] rendering chart');
    renderChart(data.forecast);

    // Update Table
    const tbody = document.querySelector('#forecast-table tbody');
    console.log('[updateUI] table body found:', !!tbody);
    tbody.innerHTML = '';
    data.forecast.forEach(f => {
        console.log('[updateUI] table row', f.Tijd, f.THI_In);
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
    console.log('[updateUI] updated buienradar iframe', iframe.src);

    // Update Footer
    document.getElementById('last-updated').textContent = `Laatst bijgewerkt: ${data.updated_at}`;
    console.log('[updateUI] finished');
}

function renderChart(forecast) {
    console.log('[renderChart] start', forecast.length);
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
        ]
    };

    Plotly.newPlot('thi-chart', [traceIn, traceOut], layout, {responsive: true});
    console.log('[renderChart] plot created');
}

function showPage(pageId) {
    console.log('[showPage] switching to', pageId);
    document.getElementById('page-home').style.display = pageId === 'home' ? 'block' : 'none';
    document.getElementById('page-register').style.display = pageId === 'register' ? 'block' : 'none';
    document.getElementById('page-about').style.display = pageId === 'about' ? 'block' : 'none';
}

function handleRegister(event) {
    console.log('[handleRegister] called');
    event.preventDefault();
    const name = event.target.name.value;
    console.log('[handleRegister] name', name);
    document.getElementById('register-msg').innerHTML = `
        <div style="background: #d4edda; color: #155724; padding: 15px; border-radius: 5px; margin-top: 20px;">
            Bedankt voor je inschrijving, ${name}! Je ontvangt binnenkort een maatwerk alert.
        </div>
    `;
}

console.log('[script] booting');
void initNotifications();
init();
