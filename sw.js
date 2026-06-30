// Aziz-Pro - Service Worker pour PWA
// Permet le fonctionnement hors ligne et le cache intelligent

const CACHE_NAME = 'aziz-pro-v4';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/sw.js'
];

// Installation du Service Worker
self.addEventListener('install', (event) => {
    console.log('[SW] Installation en cours...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Cache créé:', CACHE_NAME);
            return cache.addAll(STATIC_ASSETS).catch(err => {
                // Certains assets peuvent ne pas être disponibles immédiatement
                console.warn('[SW] Erreur cache assets statiques:', err);
            });
        })
    );
    self.skipWaiting(); // Force l'activation immédiate
});

// Activation du Service Worker
self.addEventListener('activate', (event) => {
    console.log('[SW] Activation...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((cacheName) => cacheName !== CACHE_NAME)
                    .map((cacheName) => {
                        console.log('[SW] Suppression ancien cache:', cacheName);
                        return caches.delete(cacheName);
                    })
            );
        })
    );
    self.clients.claim(); // Prend contrôle de tous les clients
});

// Interception des requêtes (Fetch)
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const { method, url } = request;

    // Ignorer les requêtes non-GET
    if (method !== 'GET') {
        return;
    }

    // Ignorer les requêtes de domaines externes (Google CDN, etc.)
    if (!url.startsWith(self.location.origin)) {
        return;
    }

    // Stratégie: Cache-first pour les assets statiques
    if (url.includes('.css') || url.includes('.js') || url.includes('.svg') || url.includes('fonts')) {
        return event.respondWith(
            caches.match(request).then((cachedResponse) => {
                if (cachedResponse) {
                    console.log('[SW] Cache hit:', url);
                    return cachedResponse;
                }

                // Pas en cache, essayer le réseau
                return fetch(request).then((networkResponse) => {
                    // Mettre en cache la réponse réussie
                    if (networkResponse && networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseToCache);
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    console.warn('[SW] Fetch échoué (hors ligne):', url);
                    return new Response('Hors ligne', { status: 503 });
                });
            })
        );
    }

    // Stratégie: Network-first pour les requêtes API
    if (url.includes('/api') || url.includes('supabase') || url.includes('googleapis')) {
        return event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    if (!networkResponse || networkResponse.status !== 200) {
                        return caches.match(request);
                    }

                    // Mettre en cache les réponses réussies
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });

                    return networkResponse;
                })
                .catch(() => {
                    console.log('[SW] Requête réseau échouée, utilisant cache:', url);
                    return caches.match(request).then((cachedResponse) => {
                        if (cachedResponse) {
                            return cachedResponse;
                        }
                        // Réponse par défaut offline
                        return new Response(
                            JSON.stringify({ 
                                error: 'Offline', 
                                message: 'Mode hors ligne - données locales utilisées' 
                            }),
                            { 
                                status: 503, 
                                headers: { 'Content-Type': 'application/json' } 
                            }
                        );
                    });
                })
        );
    }

    // Défaut: Network-first
    event.respondWith(
        fetch(request)
            .then((response) => response)
            .catch(() => {
                return caches.match(request);
            })
    );
});

// Synchronisation en arrière-plan
self.addEventListener('sync', (event) => {
    console.log('[SW] Background sync:', event.tag);
    if (event.tag === 'sync-cloud-data') {
        event.waitUntil(syncCloudData());
    }
});

// Notifications push
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Aziz-Pro';
    const options = {
        body: data.message || 'Mise à jour disponible',
        icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect fill="%232563eb" width="64" height="64" rx="14"/><path fill="%23fbbf24" d="M14 26h36l-3 22a4 4 0 0 1-4 3.5H21a4 4 0 0 1-4-3.5L14 26z"/></svg>',
        badge: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect fill="%232563eb" width="64" height="64" rx="14"/></svg>',
        tag: 'aziz-pro-notification',
        requireInteraction: false,
        actions: [
            { action: 'open', title: 'Ouvrir' },
            { action: 'close', title: 'Fermer' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Gestion des clics sur notifications
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'open') {
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then((clientList) => {
                // Si un onglet existe, le focuser
                for (let client of clientList) {
                    if (client.url === '/' && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Sinon ouvrir un nouvel onglet
                if (clients.openWindow) {
                    return clients.openWindow('/');
                }
            })
        );
    }
});

// Fonction de synchronisation cloud (stub)
async function syncCloudData() {
    console.log('[SW] Sync cloud en cours...');
    // Cette fonction serait appelée pour synchroniser les données
    // avec le cloud lors d'une reconnexion
    return true;
}

// Message depuis le client
self.addEventListener('message', (event) => {
    console.log('[SW] Message reçu:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.delete(CACHE_NAME).then(() => {
            event.ports[0].postMessage({ success: true });
        });
    }
});

// Log d'activité
console.log('[SW] Service Worker chargé et prêt');
