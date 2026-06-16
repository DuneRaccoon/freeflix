import libtorrent as lt
import time

magnet_link = "magnet:?xt=urn:btih:2385EB80D5F99EFD77DA16F2C7CEAE6CCF95B825&dn=History+of+the+World%3A+Part+I+%281981%29+%5B1080p%5D+%5BYTS.MX%5D&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969%2Fannounce&tr=udp%3A%2F%2F9.rarbg.to%3A2710%2Fannounce&tr=udp%3A%2F%2Fp4p.arenabg.ch%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.cyberia.is%3A6969%2Fannounce&tr=http%3A%2F%2Fp4p.arenabg.com%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337%2Fannounce"
params = {
    'save_path': './downloads',
    'storage_mode': lt.storage_mode_t.storage_mode_sparse,
}
session = lt.session()
session.listen_on(6881, 6891)
session.add_dht_router("router.bittorrent.com", 6881)
session.add_dht_router("router.utorrent.com", 6881)
session.add_dht_router("dht.transmissionbt.com", 6881)

settings = session.get_settings()
settings['enable_dht'] = True
settings['enable_lsd'] = True
settings['enable_upnp'] = True
settings['enable_natpmp'] = True
session.apply_settings(settings)

handle = lt.add_magnet_uri(session, magnet_link, params)

print("Downloading Metadata...")
while (not handle.has_metadata()):
    s = handle.status()
    print("Progress: %.2f%% | Peers: %d" % (s.progress * 100, s.num_peers))
    time.sleep(1)
print("Metadata received, starting download...")

ti = handle.get_torrent_info()
print("Torrent Title: ", ti.name())

while True:
    s = handle.status()
    print("Progress: %.2f%% | Peers: %d | Down: %.1f kB/s" %
          (s.progress * 100, s.num_peers, s.download_rate / 1000))
    if s.is_seeding:
        print("Download Complete!")
        break
    time.sleep(1)
